import test from 'node:test'
import assert from 'node:assert/strict'
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb'
import {translateChapter,missingSegments} from '../src/features/translation/automatic/engine.ts'
import {MODEL} from '../src/features/translation/automatic/protocol.ts'
import {TranslationRequestError} from '../src/features/translation/automatic/errors.ts'
import {AUTO_POLICY,createTranslationScheduler,abortableDelay} from '../src/features/translation/automatic/scheduler.ts'
import {readChapterTranslation,exportCachedTranslations} from '../src/features/translation/storage.ts'
import {validateChapterTranslation,validateTranslationPackage} from '../src/features/translation/package.ts'
const sources=['她推开了窗户。','“你还好吗？”他问。','她把信放在桌上。','雨终于停了。','门外传来了脚步声。','她转过身，轻轻点头。']
const targets=['She opened the window.','“Are you all right?” he asked.','She placed the letter on the table.','The rain had finally stopped.','Footsteps sounded outside the door.','She turned and nodded gently.']
const book={schemaVersion:1,id:'recovery-test',title:'原创建模替身测试',source:'txt',chapters:[{id:'r',title:'第一章',order:0,paragraphs:sources}]}
// Explicit model doubles, not evidence of actual literary translation quality.
const answer=batch=>({version:1,model:MODEL,translations:batch.segments.map(s=>({id:s.id,text:targets[sources.indexOf(s.text)]??'An English test sentence.'})),glossary:batch.glossary})
const options=extra=>({endpoint:'https://recovery.example/translate',signal:new AbortController().signal,paragraph:0,offset:0,onUpdate:()=>{},onProgress:()=>{},schedule:async()=>{},networkRecovery:{probe:async()=>false,delay:async()=>{}},...extra})
async function device(action){const saved=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();try{await action()}finally{globalThis.indexedDB=saved}}
const bad=code=>new TranslationRequestError(code,'fixed test error',502)
test('坏JSON批次只调用一次，直接标记跳过并继续后文，不拆批重试且原文不变',()=>device(async()=>{
 const calls=[],progress=[];const before=JSON.stringify(book)
 const value=await translateChapter(book,0,options({request:async(_url,batch)=>{
  calls.push(batch.segments.map(s=>s.text))
  if(batch.segments.some(s=>s.text===sources[0]))throw bad('MODEL_JSON_INVALID')
  return answer(batch)
 },onProgress:p=>progress.push(p)}))
 assert.equal(calls.flat().length,sources.length);assert.equal(new Set(calls.flat()).size,sources.length)
 assert.equal(value.status,'partial');assert.equal(value.segments.length,5);assert.equal(value.failures.length,1)
 assert.equal(value.failures[0].attempts,1);assert.equal(progress.at(-1).pending,0);assert.equal(progress.at(-1).skipped,1)
 assert.equal(progress.at(-1).processedPercent,100);assert.ok(progress.at(-1).percent<100)
 assert.equal(JSON.stringify(book),before)
}))
test('顽固单句失败保留中文和具体范围，继续其余句组；刷新不自动重复失败，手动仅补缺口',()=>device(async()=>{
 let calls=0
 const value=await translateChapter(book,0,options({request:async(_url,batch)=>{
  calls++;if(batch.segments.some(s=>s.text===sources[1]))throw bad('MODEL_JSON_INVALID')
  return answer(batch)
 }}))
 assert.equal(value.status,'partial');assert.equal(value.segments.length,5);assert.equal(value.failures.length,1)
 assert.equal(value.failures[0].source.paragraph,1);assert.equal(value.failures[0].code,'MODEL_JSON_INVALID');assert.equal(value.failures[0].attempts,1)
 const restored=await readChapterTranslation(book,book.chapters[0]);assert.deepEqual(restored.failures,value.failures)
 const cachedSources=new Set(value.segments.map(s=>s.sourceText)),count=calls
 await translateChapter(book,0,options({request:async()=>{throw new Error('known failure must not auto-loop')}}));assert.equal(calls,count)
 const sent=[]
 const complete=await translateChapter(book,0,options({retryFailures:true,request:async(_url,batch)=>{sent.push(...batch.segments);return answer(batch)}}))
 assert.equal(sent.length,1);assert.equal(sent[0].text,sources[1]);assert.ok(sent.every(s=>!cachedSources.has(s.text)))
 assert.equal(complete.status,'complete');assert.equal(complete.failures,undefined)
}))
test('截断/对应错误不重发；返回同批有效独立ID则保存，错ID仍跳过',()=>device(async()=>{
 const sent=[]
 const value=await translateChapter(book,0,options({request:async(_url,batch)=>{
  sent.push(...batch.segments.map(s=>s.text))
  if(batch.segments.some(s=>s.text===sources[2]))return {...answer(batch),translations:answer(batch).translations.map(t=>batch.segments.find(s=>s.id===t.id).text===sources[2]?{...t,id:'wrong'}:t)}
  return answer(batch)
 }}))
 assert.equal(sent.length,6);assert.equal(new Set(sent).size,6)
 assert.equal(value.segments.length,5);assert.equal(value.failures[0].code,'MODEL_ALIGNMENT_INVALID')
 assert.equal(value.failures[0].source.paragraph,2);assert.ok(!value.segments.some(s=>s.targetText==='Wrong alignment.'))
}))
test('连续大量格式失败也不触发恢复停章，每个源范围只发一次，继续后文',()=>device(async()=>{
 const events=[];let calls=0
 const b={...book,id:'bounded-recovery',chapters:[{...book.chapters[0],paragraphs:[sources[0],sources[2],sources[4],...Array.from({length:12},()=>sources[3]),sources[0],sources[2],sources[4]]}]}
 const value=await translateChapter(b,0,options({request:async(_url,batch)=>{
  calls++;if(!batch.segments.some(s=>s.text===sources[3]))return answer(batch)
  throw bad('MODEL_JSON_INVALID')
 },onProgress:p=>events.push(p)}))
 assert.equal(calls,6);assert.equal(events.at(-1).requests,calls)
 const cached=await readChapterTranslation(b,b.chapters[0]);assert.equal(cached.segments.length,6);assert.ok(cached.failures.length>0)
 assert.equal(value.status,'partial');assert.ok(cached.segments.some(s=>s.source.paragraph===17))
 assert.equal(events.at(-1).remaining,12)
}))
test('单句截断和译名错误均直接跳过不重试，固定诊断可刷新保存；未知诊断不得导入',()=>device(async()=>{
 for(const [code,reason]of [['MODEL_OUTPUT_INVALID','TOKEN_LIMIT'],['MODEL_GLOSSARY_INVALID','NAME_SPELLING']]){
  const b={...book,id:`single-${code}`,chapters:[{...book.chapters[0],paragraphs:[sources[1]]}]};let calls=0
  const value=await translateChapter(b,0,options({request:async()=>{calls++;throw new TranslationRequestError(code,'fixed diagnostic',502,0,reason)}}))
  assert.equal(calls,1);assert.equal(value.failures[0].attempts,1);assert.equal(value.failures[0].reason,reason)
  assert.deepEqual((await readChapterTranslation(b,b.chapters[0])).failures,value.failures)
  const bad=structuredClone(value);bad.failures[0].reason='PRIVATE_STORY'
  await assert.rejects(validateChapterTranslation(bad,b,0),/诊断无效/)
 }
}))
test('429/503/网络/鉴权和存储失败安全停止；不盲目重试，429有冷却下限',()=>device(async()=>{
 for(const [status,code]of [[429,'HTTP_429'],[503,'HTTP_503'],[0,'NETWORK_ERROR'],[403,'HTTP_403']]){
  let calls=0;const b={...book,id:`fatal-${status}`}
  await assert.rejects(translateChapter(b,0,options({request:async()=>{calls++;throw new TranslationRequestError(code,'stop',status,60)}})),error=>error.code===code)
  assert.equal(calls,1);assert.equal(await readChapterTranslation(b,b.chapters[0]),undefined)
 }
 const put=IDBObjectStore.prototype.put;let calls=0
 try{
  IDBObjectStore.prototype.put=function(){throw new DOMException('full','QuotaExceededError')}
  await assert.rejects(translateChapter(book,0,options({request:async(_url,batch)=>{calls++;return answer(batch)}})),error=>error.name==='QuotaExceededError')
  assert.equal(calls,1)
 }finally{IDBObjectStore.prototype.put=put}
}))
test('超长源句记录为不可安全翻译，跳过它并继续后面的正常句子',()=>device(async()=>{
 const b={...book,id:'long-and-short',chapters:[{id:'r',title:'长句',paragraphs:['文'.repeat(3001),sources[0]]}]};let sent=[]
 const value=await translateChapter(b,0,options({request:async(_url,batch)=>{sent.push(...batch.segments);return answer(batch)}}))
 assert.equal(value.segments.length,1);assert.equal(value.failures[0].code,'SOURCE_TOO_LONG');assert.equal(value.failures[0].attempts,0)
 assert.equal(sent.length,1);assert.equal(sent[0].text,sources[0])
}))
test('失败元数据经原文范围校验，可导出恢复且不升级数据库；拒绝未知错误和成功范围重叠',()=>device(async()=>{
 const value=await translateChapter(book,0,options({request:async(_url,batch)=>{if(batch.segments.some(s=>s.text===sources[1]))throw bad('MODEL_JSON_INVALID');return answer(batch)}}))
 const exported=await exportCachedTranslations(book)
 assert.deepEqual((await validateTranslationPackage(JSON.parse(JSON.stringify(exported)),book)).chapters[0].failures,value.failures)
 for(const modify of [f=>f.code='<script>bad</script>',f=>f.source.paragraph=10000,f=>f.source={...value.segments[0].source}]){
  const badValue=structuredClone(value);modify(badValue.failures[0]);await assert.rejects(validateChapterTranslation(badValue,book,0),/失败记录/)
 }
}))
test('调度器将并发/重试调用串行限速，刷新延续时刻；冷却和取消不绕过间隔',async()=>{
 let time=1000;const waited=[],store=new Map(),storage={getItem:key=>store.get(key)??null,setItem:(k,v)=>store.set(k,v)}
 const delay=async(ms,signal)=>{assert.equal(signal.aborted,false);waited.push(ms);time+=ms}
 const gate=createTranslationScheduler(()=>time,delay,storage),signal=new AbortController().signal
 await Promise.all(Array.from({length:4},()=>gate.start('https://clock.example',signal)))
 assert.deepEqual(waited,[6100,6100,6100])
 const refreshed=createTranslationScheduler(()=>time,delay,storage);await refreshed.start('https://clock.example',signal);assert.equal(waited.at(-1),6100)
 refreshed.defer('https://clock.example',1);await refreshed.start('https://clock.example',signal);assert.equal(waited.at(-1),60000)
 const c=new AbortController();c.abort();await assert.rejects(refreshed.start('https://clock.example',c.signal),{name:'AbortError'})
 const c2=new AbortController(),pending=abortableDelay(10000,c2.signal);c2.abort();await assert.rejects(pending,{name:'AbortError'})
})

test('仅发送本批及上下文实际出现的人名，保留全部既有术语而不让无关名字撑大JSON',()=>device(async()=>{
 const {createTranslationTemplate}=await import('../src/features/translation/package.ts'),{saveChapterTranslation}=await import('../src/features/translation/storage.ts')
 const b={...book,id:'relevant-glossary',chapters:[{...book.chapters[0],paragraphs:['林澈推开窗户。',...sources.slice(0,3)]}]}
 const seed=(await createTranslationTemplate(b)).chapters[0]
 seed.segments=seed.segments.slice(0,1);seed.segments[0].targetText='Lin Che opened the window.'
 seed.glossary={林澈:'Lin Che',张伟:'Zhang Wei',沈明:'Shen Ming'}
 await saveChapterTranslation(b,0,seed)
 let calls=0
 const result=await translateChapter(b,0,options({request:async(_url,batch)=>{calls++;const story=batch.context+batch.segments.map(s=>s.text).join('');assert.deepEqual(batch.glossary,story.includes('林澈')?{林澈:'Lin Che'}:{});return answer(batch)}}))
 assert.ok(calls>=1);assert.equal(result.glossary.张伟,'Zhang Wei');assert.equal(result.glossary.林澈,'Lin Che');assert.equal(result.status,'complete')
}))

test('React部分失败不假报完成；失败数量可刷新恢复，手动重试经历缓存重读仍只补失败句',()=>device(async()=>{
 const {JSDOM}=await import('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://recovery-ui.example'}),saved={}
 for(const key of ['window','document','navigator','localStorage','IS_REACT_ACT_ENVIRONMENT'])saved[key]=Object.getOwnPropertyDescriptor(globalThis,key)
 Object.defineProperties(globalThis,{window:{configurable:true,value:dom.window},document:{configurable:true,value:dom.window.document},navigator:{configurable:true,value:dom.window.navigator},localStorage:{configurable:true,value:dom.window.localStorage},IS_REACT_ACT_ENVIRONMENT:{configurable:true,value:true}})
 const originalFetch=globalThis.fetch;let api,poison=true,calls=0;const payloads=[]
 globalThis.fetch=async(_url,init)=>{const batch=JSON.parse(init.body);calls++;payloads.push(batch);return poison&&batch.segments.some(s=>s.text===sources[1])?new Response(JSON.stringify({code:'MODEL_JSON_INVALID'}),{status:502}):new Response(JSON.stringify(answer(batch)),{status:200})}
 const React=await import('react'),{createRoot}=await import('react-dom/client'),{useAutoTranslation}=await import('../src/features/translation/automatic/useAutoTranslation.ts')
 const noWait=async()=>{};let root=createRoot(document.getElementById('root'))
 function Harness(){
  const [value,setValue]=React.useState(),[loading,setLoading]=React.useState(false),[reload,setReload]=React.useState(0)
  React.useEffect(()=>{let active=true;setLoading(true);readChapterTranslation(book,book.chapters[0]).then(t=>{if(active)setValue(t)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[reload])
  api=useAutoTranslation({schedule:noWait,serviceUrl:'https://recovery-ui.example/translate',book,index:0,high:true,loading,error:'',translation:value,onUpdate:setValue,onReload:()=>setReload(n=>n+1),paragraph:0,offset:0})
  return React.createElement('p',null,api.status)
 }
 const settle=async(predicate)=>{for(let i=0;i<150&&!predicate();i++)await React.act(async()=>{await new Promise(r=>setTimeout(r,5))});assert.ok(predicate())}
 try{
  await React.act(async()=>root.render(React.createElement(Harness)))
  await React.act(async()=>api.enable());await settle(()=>api.state==='finished'&&api.progress.failed===1)
  assert.match(api.status,/处理结束/);assert.equal(api.progress.pending,0);assert.equal(api.progress.processedPercent,100);assert.equal(api.cached,false);assert.equal(api.progress.succeeded,5);assert.equal(api.progress.remaining,1);assert.ok(api.progress.percent<100);assert.equal(api.failures[0].code,'MODEL_JSON_INVALID')
  const before=calls
  await React.act(async()=>root.unmount());root=createRoot(document.getElementById('root'))
  await React.act(async()=>root.render(React.createElement(Harness)));await settle(()=>api.state==='finished'&&api.progress.failed===1);assert.equal(calls,before)
  poison=false;await React.act(async()=>api.retry());await settle(()=>api.state==='complete')
  assert.equal(calls,before+1);assert.equal(payloads.at(-1).segments.length,1);assert.equal(payloads.at(-1).segments[0].text,sources[1]);assert.equal(api.progress.failed,0);assert.equal(api.progress.remaining,0);assert.equal(api.progress.percent,100)
 }finally{await React.act(async()=>root.unmount());globalThis.fetch=originalFetch;dom.window.close();for(const [key,descriptor]of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
}))

test('请求使用短ID并严格映射回原文ID；手动重试优先单独处理已失败范围',()=>device(async()=>{
 const {saveChapterTranslation}=await import('../src/features/translation/storage.ts'),{createTranslationTemplate}=await import('../src/features/translation/package.ts')
 const seed=(await createTranslationTemplate(book)).chapters[0];seed.segments=[]
 seed.failures=[{source:{paragraph:4,start:0,end:sources[4].length},code:'MODEL_JSON_INVALID',attempts:2,failedAt:new Date().toISOString()}]
 await saveChapterTranslation(book,0,seed)
 const sent=[]
 const value=await translateChapter(book,0,options({retryFailures:true,request:async(_url,batch)=>{sent.push(batch);assert.deepEqual(batch.segments.map(s=>s.id),batch.segments.map((_,i)=>`s${i}`));return answer(batch)}}))
 assert.equal(sent[0].segments.length,1);assert.equal(sent[0].segments[0].text,sources[4])
 assert.equal(value.status,'complete');assert.equal(value.failures,undefined)
 for(const s of value.segments){assert.ok(s.id.startsWith('auto-p'));assert.equal(s.sourceText,sources[s.source.paragraph]);assert.equal(s.targetText,targets[s.source.paragraph])}
}))
test('单句对齐拒绝直接跳过，保留其他成功缓存，不自动再次调用',()=>device(async()=>{
 const b={...book,id:'compact-single',chapters:[{...book.chapters[0],paragraphs:['前文'.repeat(300),sources[1],'后文'.repeat(300)]}]}
 const {createTranslationTemplate}=await import('../src/features/translation/package.ts'),{saveChapterTranslation}=await import('../src/features/translation/storage.ts')
 const seed=(await createTranslationTemplate(b)).chapters[0];seed.segments=seed.segments.filter(s=>s.source.paragraph!==1)
 for(const s of seed.segments)s.targetText='Previously saved test narration.'
 await saveChapterTranslation(b,0,seed)
 const contexts=[]
 const value=await translateChapter(b,0,options({paragraph:1,request:async(_url,batch)=>{
  contexts.push(batch.context);if(contexts.length===1)throw bad('MODEL_ALIGNMENT_INVALID');return answer(batch)
 }}))
 assert.equal(contexts.length,1);assert.ok(!contexts[0].includes(sources[1]));assert.equal(value.status,'partial');assert.equal(value.segments.length,2);assert.equal(value.failures.length,1)
}))
