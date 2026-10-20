import test from 'node:test'
import assert from 'node:assert/strict'
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb'
import {translateChapter} from '../src/features/translation/automatic/engine.ts'
import {requestTranslation} from '../src/features/translation/automatic/client.ts'
import {validateAvailableResult} from '../src/features/translation/automatic/availableResult.ts'
import {MODEL} from '../src/features/translation/automatic/protocol.ts'
import {AUTO_POLICY} from '../src/features/translation/automatic/scheduler.ts'
import {TranslationRequestError} from '../src/features/translation/automatic/errors.ts'
import {createTranslationTemplate} from '../src/features/translation/package.ts'
import {readChapterTranslation,saveChapterTranslation} from '../src/features/translation/storage.ts'
import worker from '../worker/translation.ts'
// Explicit deterministic model doubles. These prove skipping/identity/storage,
// not real model translation quality or a guaranteed cloud coverage percentage.
const options=extra=>({endpoint:'https://skip.example/translate',signal:new AbortController().signal,paragraph:0,offset:0,onProgress:()=>{},onUpdate:()=>{},schedule:async()=>{},networkRecovery:{probe:async()=>false,delay:async()=>{}},...extra})
const fixture=(n,id='skip-test')=>({id,title:'原创一次处理测试',source:'txt',chapters:[{id:'c',title:'第一章',order:0,paragraphs:Array.from({length:n},(_,i)=>`第${i+1}封信放在桌上。`)}]})
const answer=batch=>({version:1,model:MODEL,translations:batch.segments.map(s=>({id:s.id,text:`Letter ${s.text.match(/\d+/)?.[0]??1} lay on the table.`})),glossary:batch.glossary})
async function device(action){const before=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();try{await action()}finally{globalThis.indexedDB=before}}
const batch={version:1,segments:[{id:'a',text:'雨停了。'},{id:'b',text:'门开了。'},{id:'c',text:'她笑了。'}],context:'',glossary:{}}
const result={version:1,model:MODEL,translations:[{id:'a',text:'The rain stopped.'},{id:'b',text:'The door opened.'},{id:'c',text:'She smiled.'}],glossary:{}}

test('完整JSON中按唯一ID逐项校验；乱序有效项保留，中文/错ID/重复ID不猜测对应',()=>{
 const partial=validateAvailableResult({...result,translations:[result.translations[2],{id:'b',text:'门开了。'},result.translations[0],{id:'unknown',text:'An unrelated sentence.'}]},batch)
 assert.deepEqual(partial.translations,[result.translations[0],result.translations[2]])
 const duplicate=validateAvailableResult({...result,translations:[result.translations[0],result.translations[0],result.translations[1]]},batch)
 assert.deepEqual(duplicate.translations,[result.translations[1]])
 assert.throws(()=>validateAvailableResult({...result,model:'wrong'},batch))
 assert.throws(()=>validateAvailableResult({...result,translations:[]},batch))
 assert.throws(()=>validateAvailableResult({...result,glossary:{不存在的人:'Invented'}},batch))
 const named={...batch,segments:[{id:'a',text:'林澈推开窗。'}],glossary:{林澈:'Lin Che'}}
 assert.throws(()=>validateAvailableResult({...result,translations:[{id:'a',text:'Other Name opened the window.'}],glossary:named.glossary},named),/译名/)
})
test('HTTP层一次请求：坏JSON/旧Worker502不解析半截英文；有效部分响应不加调用',async()=>{
 for(const response of [()=>new Response('{"translations":[{"id":"a","text":"The rain stopped."}'),()=>Response.json({code:'MODEL_JSON_INVALID',error:'private story'},{status:502})]){
  let calls=0
  await assert.rejects(requestTranslation('https://skip.example',batch,new AbortController().signal,async()=>{calls++;return response()}),e=>e.code==='MODEL_JSON_INVALID')
  assert.equal(calls,1)
 }
 let calls=0
 const partial=await requestTranslation('https://skip.example',batch,new AbortController().signal,async()=>{calls++;return Response.json({...result,translations:[result.translations[0]]})})
 assert.equal(calls,1);assert.equal(partial.translations.length,1)
})
test('整章一次处理：旧缓存保留，失败批次不重发，独立成功立即保存，最终成功+跳过=全章',()=>device(async()=>{
 const book=fixture(30),seed=(await createTranslationTemplate(book)).chapters[0]
 seed.segments=seed.segments.slice(0,6);seed.segments.forEach((s,i)=>s.targetText=`Letter ${i+1} lay on the table.`)
 const old=await saveChapterTranslation(book,0,seed),sent=[],updates=[],events=[]
 const value=await translateChapter(book,0,options({onUpdate:t=>updates.push(t.segments.length),onProgress:p=>events.push(p),request:async(_url,b)=>{
  for(const s of b.segments){assert.ok(!old.segments.some(old=>old.sourceText===s.text));assert.ok(!sent.includes(s.text));sent.push(s.text)}
  if(b.segments[0].text==='第10封信放在桌上。')throw new TranslationRequestError('MODEL_JSON_INVALID','fixed',502)
  const r=answer(b)
  if(b.segments[0].text==='第19封信放在桌上。')r.translations=r.translations.slice(0,1)
  return r
 }}))
 assert.equal(sent.length,24);assert.equal(events.at(-1).requests,8)
 assert.equal(value.segments.length,25);assert.equal(value.failures.length,5)
 assert.ok(value.failures.every(f=>f.attempts===1));assert.equal(events.at(-1).pending,0)
 assert.equal(events.at(-1).processedPercent,100);assert.equal(events.at(-1).skipped,5)
 assert.ok(events.at(-1).percent>=80&&events.at(-1).percent<100)
 assert.ok(updates.includes(16));assert.deepEqual(value.segments.slice(0,6),old.segments)
 assert.deepEqual(await readChapterTranslation(book,book.chapters[0]),value)
 // Reload/re-entry cannot resubmit successful OR skipped ranges.
 await translateChapter(book,0,options({request:async()=>{throw new Error('automatic repeat forbidden')}}))
 const manual=[]
 const complete=await translateChapter(book,0,options({retryFailures:true,request:async(_url,b)=>{manual.push(...b.segments);return answer(b)}}))
 assert.equal(manual.length,5);assert.ok(manual.every(s=>value.failures.some(f=>book.chapters[0].paragraphs[f.source.paragraph]===s.text)))
 assert.equal(complete.status,'complete');assert.equal(complete.segments.length,30)
}))
test('超过旧12次恢复限制的连续失败直接跳过，仍请求最后正常段落，零重复调用',()=>device(async()=>{
 const book=fixture(48,'many-skips'),sent=[],events=[]
 const value=await translateChapter(book,0,options({onProgress:p=>events.push(p),request:async(_url,b)=>{
  sent.push(...b.segments.map(s=>s.text));if(b.segments.some(s=>Number(s.text.match(/\d+/)[0])<=45))throw new TranslationRequestError('MODEL_JSON_INVALID','fixed',502)
  return answer(b)
 }}))
 assert.equal(sent.length,48);assert.equal(new Set(sent).size,48);assert.equal(events.at(-1).requests,16)
 assert.equal(value.segments.length,3);assert.equal(value.failures.length,45);assert.equal(events.at(-1).pending,0);assert.equal(events.at(-1).processedPercent,100)
}))
test('普通502/504跳过并继续，不将网络中断或客户端超时当格式失败',()=>device(async()=>{
 for(const code of ['HTTP_502','HTTP_504']){
  const book=fixture(6,code);let calls=0
  const value=await translateChapter(book,0,options({request:async(_url,b)=>{calls++;if(calls===1)throw new TranslationRequestError(code,'fixed');return answer(b)}}))
  assert.equal(calls,2);assert.equal(value.failures.length,3);assert.equal(value.segments.length,3)
 }
}))
test('总调用上限安全暂停，未处理范围仍待翻译，不伪装为已跳过',()=>device(async()=>{
 const limit=AUTO_POLICY.maxRequests;AUTO_POLICY.maxRequests=1
 try{
  const events=[];let calls=0;const book=fixture(9,'budget')
  await assert.rejects(translateChapter(book,0,options({onProgress:p=>events.push(p),request:async(_url,b)=>{calls++;return answer(b)}})),e=>e.code==='REQUEST_BUDGET_PAUSED')
  const value=await readChapterTranslation(book,book.chapters[0])
  assert.equal(calls,1);assert.equal(value.segments.length,3);assert.equal(value.failures,undefined)
  assert.equal(events.at(-1).pending,6);assert.equal(events.at(-1).skipped,0)
 }finally{AUTO_POLICY.maxRequests=limit}
}))
test('同批成功先提交；随后跳过记录存储失败也不会丢失已确认译文',()=>device(async()=>{
 const put=IDBObjectStore.prototype.put;let writes=0
 IDBObjectStore.prototype.put=function(...args){if(++writes===2)throw new DOMException('full','QuotaExceededError');return put.apply(this,args)}
 const book=fixture(3,'commit-first')
 try{
  await assert.rejects(translateChapter(book,0,options({request:async(_url,b)=>({...answer(b),translations:answer(b).translations.slice(0,1)})})),e=>e.name==='QuotaExceededError')
 }finally{IDBObjectStore.prototype.put=put}
 const saved=await readChapterTranslation(book,book.chapters[0]);assert.equal(saved.segments.length,1);assert.equal(saved.segments[0].source.paragraph,0)
}))
test('待确认Worker修订：一次AI调用保留完整JSON内通过校验的独立项；坏JSON和截断仍全拒绝',async()=>{
 const req=()=>new Request('https://worker.example/translate',{method:'POST',headers:{Origin:'https://reader.example','CF-Connecting-IP':'192.0.2.1','Content-Type':'application/json'},body:JSON.stringify(batch)})
 const environment=run=>({AI:{run},PER_IP:{limit:async()=>({success:true})},GLOBAL:{limit:async()=>({success:true})},ALLOWED_ORIGINS:'https://reader.example',TRANSLATION_ENABLED:'true'})
 let calls=0
 const response=await worker.fetch(req(),environment(async()=>{calls++;return {response:JSON.stringify({...result,translations:[result.translations[0],{id:'b',text:'门开了。'},result.translations[2]]})}}))
 assert.equal(calls,1);assert.equal(response.status,200);assert.deepEqual((await response.json()).translations,[result.translations[0],result.translations[2]])
 for(const raw of [{response:'{"translations":broken'},{response:JSON.stringify(result),finish_reason:'length'}])assert.equal((await worker.fetch(req(),environment(async()=>raw))).status,502)
})
test('客户端保留转发NETWORK_ERROR类别，引擎停止网络故障而不标记所有后文失败',()=>device(async()=>{
 let calls=0
 const book=fixture(9,'relay-offline')
 await assert.rejects(translateChapter(book,0,options({request:(url,b,s)=>requestTranslation(url,b,s,async()=>{calls++;return Response.json({code:'NETWORK_ERROR'},{status:502})})})),e=>e.code==='NETWORK_ERROR')
 assert.equal(calls,1);assert.equal(await readChapterTranslation(book,book.chapters[0]),undefined)
}))
