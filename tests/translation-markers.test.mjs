import test from 'node:test'
import assert from 'node:assert/strict'
import {IDBFactory} from 'fake-indexeddb'
import {translateSectionMarker,validNeutralTarget,sectionMarkerRanges} from '../src/features/translation/neutral.ts'
import {createTranslationTemplate,validateChapterTranslation,validateTranslationPackage} from '../src/features/translation/package.ts'
import {translateChapter} from '../src/features/translation/automatic/engine.ts'
import {readChapterTranslation,saveChapterTranslation,exportCachedTranslations} from '../src/features/translation/storage.ts'
import {buildBilingualDisplay} from '../src/features/translation/display.ts'
import {buildDisplayText} from '../src/features/replacement/displayText.ts'
import {sourceCoverage} from '../src/features/translation/coverage.ts'
import {MODEL,validateBatchResult} from '../src/features/translation/automatic/protocol.ts'

const pairs=[['（七）','（7）'],['（八）','（8）'],['\n\n\n\n\n\n（七）\n','\n\n\n\n\n\n（7）\n'],['\r\n( 十一 )\r\n','\r\n( 11 )\r\n'],['【两百零三】','【203】'],['[一千零一十]','[1010]'],['（九千九百九十九）','（9999）'],['（〇）','（0）']]
test('独立分节编号确定性转换，保留空白/括号；拒绝正文、姓名、错误数词和嵌入编号',()=>{
 for(const [source,target]of pairs){assert.equal(translateSectionMarker(source),target);assert.equal(validNeutralTarget(source,target),true)}
 for(const source of ['七岁。','（七个孩子）','王七','她喊：“七！”','（七）她走了。','她走进（七）号房。','（十十）','（一百二）','（一万）','（七]','（七）\n（八）','（一零）','（零零）','七','（<script>七</script>）'])assert.equal(translateSectionMarker(source),undefined,source)
 assert.equal(validNeutralTarget('（七）','（8）'),false)
 assert.equal(validNeutralTarget('（七）','（七）'),false)
 assert.equal(validNeutralTarget('她走了。','7'),false)
 assert.equal(validNeutralTarget('（七）','（7）\n<script>bad</script>'),false)
 assert.equal(validNeutralTarget('12。','12。'),true)
})
test('编号只在独立行不计入英文覆盖，普通叙事中的中文数字仍是正文',()=>{
 const source='她七岁。\n\n（七）\n她走了。\n[八]\n她住在（七）号房。'
 assert.deepEqual(sectionMarkerRanges(source).map(r=>source.slice(r.start,r.end)),['（七）','[八]'])
 const chapter={paragraphs:[source]},count=sourceCoverage(chapter)
 assert.equal(count.total,(source.match(/\p{L}/gu)??[]).length-2)
 for(const range of sectionMarkerRanges(source))assert.equal(count.weight(range.start,range.end),0)
 assert.ok(count.weight(0,5)>0)
})

const options={endpoint:'https://markers.example/translate',paragraph:0,offset:0,schedule:async()=>{},onProgress:()=>{},onUpdate:()=>{},retryFailures:true}
async function device(action){const saved=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();try{await action()}finally{globalThis.indexedDB=saved}}
test('TXT/EPUB已存437句组原样保留，只补两个失败编号，零云调用；刷新/导出恢复/六档显示保持对应',()=>device(async()=>{
 for(const source of ['txt','epub']){
  const paragraphs=[Array.from({length:437},(_,i)=>`她放下第${i+1}封信。`).join('\n')+'\n\n（七）\n\n（八）\n']
  const chapter={id:'chapter',title:'测试章',order:0,paragraphs,...(source==='epub'?{blocks:[{kind:'paragraph',text:paragraphs[0]}]}:{})}
  const book={schemaVersion:1,id:`marker-${source}`,title:'原创测试',source,chapters:[chapter]}
  const seed=(await createTranslationTemplate(book)).chapters[0]
  const missing=seed.segments.splice(437)
  assert.equal(missing.length,2)
  seed.segments.forEach((s,i)=>s.targetText=`She put down letter ${i+1}.`)
  seed.failures=missing.map(s=>({source:s.source,code:'MODEL_ALIGNMENT_INVALID',attempts:2,failedAt:'2026-10-18T00:00:00.000Z'}))
  const previous=await saveChapterTranslation(book,0,seed)
  const original=JSON.stringify(book),old=JSON.stringify(previous.segments),progress=[]
  const complete=await translateChapter(book,0,{...options,signal:new AbortController().signal,onProgress:p=>progress.push(p),request:async()=>{throw new Error('已缓存正文与独立编号均不得发出云请求')}})
  assert.equal(complete.status,'complete');assert.equal(complete.segments.length,439);assert.equal(complete.failures,undefined)
  assert.equal(JSON.stringify(complete.segments.slice(0,437)),old)
  assert.deepEqual(complete.segments.slice(437).map(s=>s.targetText.trim()),['（7）','（8）'])
  assert.equal(progress.at(-1).requests,0);assert.equal(progress.at(-1).failed,0);assert.equal(progress.at(-1).percent,100)
  assert.equal(JSON.stringify(book),original)
  const cached=await readChapterTranslation(book,chapter)
  assert.deepEqual(cached,complete)
  const exported=await exportCachedTranslations(book)
  assert.deepEqual((await validateTranslationPackage(JSON.parse(JSON.stringify(exported)),book)).chapters[0],complete)
  for(const level of [0,20,40,60,80,100]){
   const baseline=buildDisplayText(paragraphs[0],[],{concentration:0,seed:'marker'})
   const display=buildBilingualDisplay(chapter,baseline,cached,level,'marker')
   assert.equal(display.complete,true)
   assert.equal(display.model.runs.map(r=>paragraphs[0].slice(r.sourceStart,r.sourceEnd)).join(''),paragraphs[0])
   assert.ok(Math.abs(display.coveredPercent-level)<=.5)
   if(!level)assert.equal(display.model.text,paragraphs[0])
   else{assert.ok(display.model.text.includes('（7）'));assert.ok(display.model.text.includes('（8）'))}
   if(level===100)assert.equal(/[\u3400-\u9fff]/u.test(display.model.text),false)
  }
  const refreshed=await translateChapter(book,0,{...options,signal:new AbortController().signal,request:async()=>{throw new Error('刷新不能重发成功内容')}})
  assert.deepEqual(refreshed,complete)
 }
}))
test('本地缓存仅允许精确数字转换；错误数字和冒充编号的中文仍拒绝，云端严格校验不放宽',()=>device(async()=>{
 const book={id:'invalid-marker',chapters:[{id:'m',title:'编号',paragraphs:['（七）','她七岁。']}]}
 const template=(await createTranslationTemplate(book)).chapters[0]
 template.segments[1].targetText='She was seven years old.'
 template.segments[0].targetText='（7）'
 assert.equal((await validateChapterTranslation(template,book,0)).status,'complete')
 for(const target of ['（8）','（七）','7','（7）额外中文']){
  const bad=structuredClone(template);bad.segments[0].targetText=target
  await assert.rejects(validateChapterTranslation(bad,book,0),/没有可用英文/)
 }
 const prose=structuredClone(template);prose.segments[1].targetText='7'
 await assert.rejects(validateChapterTranslation(prose,book,0),/没有可用英文/)
 const request={version:1,segments:[{id:'s0',text:'她七岁。'}],context:'',glossary:{}}
 for(const translation of [{id:'s0',text:'7'},{id:'wrong-id',text:'She was seven years old.'},{id:'s0',text:'她七岁。'}])assert.throws(()=>validateBatchResult({version:1,model:MODEL,translations:[translation],glossary:{}},request))
}))
