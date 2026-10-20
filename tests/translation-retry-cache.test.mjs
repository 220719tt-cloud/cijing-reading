import test from 'node:test'
import assert from 'node:assert/strict'
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb'
import {translateChapter,missingSegments} from '../src/features/translation/automatic/engine.ts'
import {MODEL} from '../src/features/translation/automatic/protocol.ts'
import {TranslationRequestError} from '../src/features/translation/automatic/errors.ts'
import {createTranslationTemplate} from '../src/features/translation/package.ts'
import {saveChapterTranslation,readChapterTranslation} from '../src/features/translation/storage.ts'

async function device(action){const saved=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();try{await action()}finally{globalThis.indexedDB=saved}}
async function fixture(source='epub'){
 const paragraphs=Array.from({length:371},(_,i)=>`她放下第${i+1}封信。`)
 const chapter={id:'c',title:'原创测试章',order:0,paragraphs,...(source==='epub'?{blocks:paragraphs.map(text=>({kind:'paragraph',text}))}:{})}
 const book={id:`retry-354-${source}`,title:'原创缓存测试',source,chapters:[chapter]}
 const missing=new Set(Array.from({length:17},(_,i)=>i*21+1))
 const seed=(await createTranslationTemplate(book)).chapters[0]
 seed.failures=seed.segments.filter(s=>missing.has(s.source.paragraph)).map(s=>({source:s.source,code:'MODEL_ALIGNMENT_INVALID',attempts:1,failedAt:'2026-10-18T00:00:00.000Z'}))
 seed.segments=seed.segments.filter(s=>!missing.has(s.source.paragraph))
 for(const segment of seed.segments)segment.targetText=`She put down letter ${segment.source.paragraph+1}.`
 const cached=await saveChapterTranslation(book,0,seed)
 return {book,chapter,cached,missing:new Set(missingSegments(book,0,cached).map(s=>s.sourceText))}
}
function unchanged(value,old){const byID=new Map(value.segments.map(s=>[s.id,s]));for(const segment of old.segments)assert.deepEqual(byID.get(segment.id),segment)}
const options=extra=>({endpoint:'https://retry-cache.example/translate',signal:new AbortController().signal,paragraph:0,offset:0,retryFailures:true,schedule:async()=>{},onProgress:()=>{},onUpdate:()=>{},...extra})
function response(batch){return {version:1,model:MODEL,translations:batch.segments.map(s=>({id:s.id,text:`She put down letter ${s.text.match(/\d+/)[0]}.`})),glossary:{}}}

test('354已缓存+17失败：TXT/EPUB重试只发送17个缺口，无clear/delete，成功数实时递增且旧译文逐字段不变',()=>device(async()=>{
 for(const source of ['txt','epub']){
  const {book,chapter,cached,missing}=await fixture(source),sent=[],progress=[],before=JSON.stringify(book)
  const clear=IDBObjectStore.prototype.clear,remove=IDBObjectStore.prototype.delete
  IDBObjectStore.prototype.clear=IDBObjectStore.prototype.delete=function(){throw new Error('重试禁止清空或删除缓存')}
  try{
   const value=await translateChapter(book,0,options({onProgress:p=>progress.push(p),onUpdate:t=>unchanged(t,cached),request:async(_url,batch)=>{
    for(const s of batch.segments){assert.ok(missing.has(s.text));assert.ok(!sent.includes(s.text));sent.push(s.text)}
    return response(batch)
   }}))
   assert.equal(sent.length,17);assert.deepEqual(new Set(sent),missing)
   assert.equal(value.segments.length,371);assert.equal(value.status,'complete');assert.equal(value.failures,undefined);unchanged(value,cached)
   assert.equal(progress[0].succeeded,354);assert.equal(progress[0].remaining,17)
   assert.equal(progress.at(-1).succeeded,371);assert.equal(progress.at(-1).remaining,0);assert.equal(progress.at(-1).requests,17)
   for(let i=0;i<progress.length;i++){const p=progress[i];assert.equal(p.succeeded+p.remaining,371);if(i)assert.ok(p.succeeded>=progress[i-1].succeeded)}
   assert.equal(JSON.stringify(book),before)
   assert.deepEqual(await readChapterTranslation(book,chapter),value)
   const restored=await translateChapter(book,0,options({request:async()=>{throw new Error('刷新后成功译文不允许重复请求')}}))
   assert.deepEqual(restored,value)
  }finally{IDBObjectStore.prototype.clear=clear;IDBObjectStore.prototype.delete=remove}
 }
}))
test('中途关闭/取消后每个成功批次已持久保存，重新读取仅补余下13个，不重发先前358个',()=>device(async()=>{
 const {book,chapter,cached,missing}=await fixture(),signal=new AbortController(),sent=[]
 const request=async(_url,batch)=>{for(const s of batch.segments){assert.ok(missing.has(s.text));assert.ok(!sent.includes(s.text));sent.push(s.text)}return response(batch)}
 await assert.rejects(translateChapter(book,0,options({signal:signal.signal,request,onUpdate:t=>{unchanged(t,cached);if(t.segments.length===358)signal.abort()}})),{name:'AbortError'})
 const restored=await readChapterTranslation(book,chapter)
 assert.equal(restored.segments.length,358);assert.equal(missingSegments(book,0,restored).length,13);unchanged(restored,cached)
 const value=await translateChapter(book,0,options({request,onUpdate:t=>unchanged(t,restored)}))
 assert.equal(value.status,'complete');assert.equal(sent.length,17);assert.equal(new Set(sent).size,17);unchanged(value,cached)
}))
test('重试遇到429只发一次并保留354个成功缓存，连续点击的串行任务不会重复翻译已保存句组',()=>device(async()=>{
 const {book,chapter,cached}=await fixture();let rateCalls=0
 await assert.rejects(translateChapter(book,0,options({request:async()=>{rateCalls++;throw new TranslationRequestError('HTTP_429','rate limit',429,60)}})),e=>e.code==='HTTP_429')
 assert.equal(rateCalls,1);assert.deepEqual(await readChapterTranslation(book,chapter),cached)
 const sent=[];const request=async(_url,batch)=>{sent.push(...batch.segments.map(s=>s.text));return response(batch)}
 const [first,second]=await Promise.all([translateChapter(book,0,options({request})),translateChapter(book,0,options({request}))])
 assert.equal(sent.length,17);assert.equal(new Set(sent).size,17);assert.equal(second.status,'complete');assert.deepEqual(second,first);unchanged(first,cached)
}))
