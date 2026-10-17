import test from 'node:test'
import assert from 'node:assert/strict'
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb'
import worker from '../worker/translation.ts'
import {MODEL,AUTO_VERSION,AUTO_LIMITS,validateBatch,validateBatchResult,translationEndpoint} from '../src/features/translation/automatic/protocol.ts'
import {requestTranslation} from '../src/features/translation/automatic/client.ts'
import {translateChapter,missingSegments} from '../src/features/translation/automatic/engine.ts'
import {readChapterTranslation,saveChapterTranslation,deleteChapterTranslation,deleteBookTranslations} from '../src/features/translation/storage.ts'
import {validateChapterTranslation,createTranslationTemplate,translationCoverage} from '../src/features/translation/package.ts'
import {buildBilingualDisplay} from '../src/features/translation/display.ts'
import {buildDisplayText} from '../src/features/replacement/displayText.ts'
import {chapterText} from '../src/features/reading/readingPosition.ts'
// Explicit model doubles for protocol/control-flow tests; these are not AI-quality evidence.
const origin='https://reader.example',sources=['林澈推开了窗。','雨已经停了。','他把信递给姐姐。','“我会回来。”他说。','她点了点头。','屋外传来了脚步声。','月光落在桌上。','他们终于松了一口气。','一辆马车停在门前。','黎明快到了。']
const targets=['Lin Che opened the window.','The rain had stopped.','He handed the letter to his elder sister.','“I will return,” he said.','She nodded.','Footsteps sounded outside.','Moonlight fell across the table.','At last they breathed a sigh of relief.','A carriage stopped outside the door.','Dawn was approaching.']
const book={schemaVersion:1,id:'never-translated',title:'原创协议验证',source:'txt',author:'test',importedAt:'now',chapters:[{id:'a',title:'第一章',order:0,paragraphs:sources},{id:'b',title:'第二章',order:1,paragraphs:['林澈推开了窗。']}]}
const batch={version:1,segments:[{id:'a',text:sources[0]}],context:sources.join(''),glossary:{}}
const allowed={limit:async()=>({success:true})}
function env(ai){return {AI:{run:ai},PER_IP:allowed,GLOBAL:allowed,ALLOWED_ORIGINS:origin,TRANSLATION_ENABLED:'true'}}
const req=(body=batch,extra={})=>new Request('https://translate.example/translate',{method:'POST',headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.1','Content-Type':'application/json',...extra},body:JSON.stringify(body)})
const answer=request=>({translations:request.segments.map(s=>({id:s.id,text:targets[sources.indexOf(s.text)]??'An original English test sentence.'})),glossary:request.glossary?.林澈||request.context.includes('林澈')||request.segments.some(s=>s.text.includes('林澈'))?{林澈:'Lin Che'}:{}})
async function device(action){const before=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();try{await action()}finally{globalThis.indexedDB=before}}
function transport(onCall=()=>{}){
 return async(endpoint,batch,signal)=>requestTranslation(endpoint,batch,signal,async(url,init)=>{
  return worker.fetch(new Request(url,{...init,headers:{...init.headers,Origin:origin,'CF-Connecting-IP':'192.0.2.1'}}),env(async(model,input)=>{assert.equal(model,MODEL);const payload=JSON.parse(input.messages[1].content);await onCall(payload);return {response:JSON.stringify(answer(payload))}}))
 })
}
const options=extra=>({endpoint:'https://translate.example/translate',signal:new AbortController().signal,paragraph:0,offset:0,onUpdate:()=>{},onProgress:()=>{},...extra})
test('公开服务地址仅HTTPS且不携带密钥参数，空配置不伪装可用',()=>{
 assert.equal(translationEndpoint(''),'');assert.equal(translationEndpoint('https://test.workers.dev/translate'),'https://test.workers.dev/translate')
 for(const value of ['http://evil.example','https://user:secret@test.example/translate','https://test.example/?key=secret','https://test.example/#key'])assert.throws(()=>translationEndpoint(value))
 assert.equal(translationEndpoint('http://127.0.0.1:9000/translate',true),'http://127.0.0.1:9000/translate')
})
test('Worker精确来源/CORS/开关/方法检查，不合规调用不触及模型',async()=>{
 let calls=0;const e=env(async()=>{calls++})
 assert.equal((await worker.fetch(req(batch,{Origin:'https://evil.example'}),e)).status,403)
 assert.equal((await worker.fetch(req(),{...e,TRANSLATION_ENABLED:'false'})).status,503)
 assert.equal((await worker.fetch(new Request('https://translate.example/translate',{method:'OPTIONS',headers:{Origin:origin}}),e)).status,204)
 const bad=await worker.fetch(new Request('https://translate.example/translate',{headers:{Origin:origin}}),e);assert.equal(bad.status,405)
 assert.equal(calls,0)
})
test('Worker限流失败、配额失败、请求超限明确返回且不泄漏模型异常',async()=>{
 const e=env(async()=>{throw new Error('PRIVATE_INTERNAL_DETAIL')})
 assert.equal((await worker.fetch(req(),{...e,PER_IP:{limit:async()=>({success:false})}})).status,429)
 const quota=await worker.fetch(req(),e);assert.equal(quota.status,503);assert.ok(!(await quota.text()).includes('PRIVATE_INTERNAL_DETAIL'))
 assert.equal((await worker.fetch(req({...batch,context:'a'.repeat(AUTO_LIMITS.context+1)}),e)).status,400)
 assert.equal((await worker.fetch(req(batch,{'Content-Length':String(AUTO_LIMITS.requestBytes+1)}),e)).status,413)
})
test('Worker真实协议返回需完整ID、自然英文文本、术语一致，拒绝截断与冒充中文',async()=>{
 const valid=await worker.fetch(req(),env(async()=>({response:JSON.stringify(answer(batch))})));assert.equal(valid.status,200);assert.equal(valid.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(valid.headers.get('Cache-Control'),'no-store')
 for(const output of [{translations:[],glossary:{}},{translations:[{id:'wrong',text:targets[0]}],glossary:{}},{translations:[{id:'a',text:sources[0]}],glossary:{}}]){
  assert.equal((await worker.fetch(req(),env(async()=>({response:JSON.stringify(output)})))).status,502)
 }
 assert.equal((await worker.fetch(req(),env(async()=>({choices:[{finish_reason:'length',message:{content:JSON.stringify(answer(batch))}}]})))).status,502)
 const g={...batch,glossary:{林澈:'Lin Che'}}
 assert.throws(()=>validateBatchResult({version:1,model:MODEL,translations:[{id:'a',text:targets[0]}],glossary:{林澈:'Other Name'}},g),/译名/)
})
test('从无译文的新中文章自动完成，60/80/100复用缓存，刷新读取零新请求',()=>device(async()=>{
 let calls=0;const progress=[],before=JSON.stringify(book)
 const result=await translateChapter(book,0,options({request:transport(()=>calls++),onProgress:p=>progress.push(p.percent)}))
 assert.equal(result.status,'complete');assert.equal(result.segments.length,missingSegments(book,0,undefined).length);assert.equal(progress.at(-1),100);assert.equal(result.glossary.林澈,'Lin Che')
 assert.ok(calls>=2);const count=calls
 for(const level of [60,80,100]){
  const cached=await readChapterTranslation(book,book.chapters[0]),ch=book.chapters[0]
  const display=buildBilingualDisplay(ch,buildDisplayText(chapterText(ch),[],{concentration:level,seed:'auto'}),cached,level,'auto')
  assert.ok(Math.abs(display.coveredPercent-level)<=7);if(level===100)assert.ok(!/[\u3400-\u9fff]/u.test(display.model.text))
  await translateChapter(book,0,options({request:transport(()=>calls++)}))
 }
 assert.equal(calls,count);assert.equal(JSON.stringify(book),before);assert.equal(await readChapterTranslation(book,book.chapters[1]),undefined)
}))
test('优先当前阅读段落，批次含邻近上下文和既有人物译名，未整本发出',()=>device(async()=>{
 const payloads=[];await translateChapter(book,0,options({paragraph:8,request:transport(p=>payloads.push(p))}))
 assert.equal(payloads[0].segments[0].text,sources[8]);assert.ok(payloads[0].context.includes(sources[8]));assert.ok(payloads.slice(1).every(p=>p.glossary.林澈==='Lin Che'))
 const next=[];await translateChapter(book,1,options({request:transport(p=>next.push(p))}));assert.equal(next[0].glossary.林澈,'Lin Che')
}))
test('批次失败保留已保存部分，重试只补缺少范围，不假报100',()=>device(async()=>{
 let attempts=0
 await assert.rejects(translateChapter(book,0,options({request:transport(()=>{if(++attempts===2)throw new Error('temporary')})})),/服务|模型/)
 const partial=await readChapterTranslation(book,book.chapters[0]);assert.equal(partial.status,'partial');const old=new Set(partial.segments.map(s=>s.sourceText))
 const sent=[];const complete=await translateChapter(book,0,options({request:transport(p=>sent.push(...p.segments))}))
 assert.equal(complete.status,'complete');assert.ok(sent.every(s=>!old.has(s.text)))
 assert.equal(translationCoverage({paragraphs:['文'.repeat(1000)]},[{sourceText:'文'.repeat(999)}]).percent,99)
}))
test('取消/离章不写入未完成批次；同章并发调用串行复用，无重复扣费',()=>device(async()=>{
 const control=new AbortController();let calls=0
 await assert.rejects(translateChapter(book,0,options({signal:control.signal,request:async()=>{control.abort();return answer(batch)}})),{name:'AbortError'})
 assert.equal(await readChapterTranslation(book,book.chapters[0]),undefined)
 await Promise.all([translateChapter(book,0,options({request:transport(()=>calls++)})),translateChapter(book,0,options({request:transport(()=>calls++)}))])
 assert.equal(calls,2)
}))
test('删除单章或全书缓存不触及原书/学习库；重读需重新翻译',()=>device(async()=>{
 const {saveBook,listBooks}=await import('../src/shared/storage/books.ts'),{setFavorite,listFavorites}=await import('../src/features/vocabulary/storage.ts')
 await saveBook(book);await setFavorite({id:'moon',word:'moon',translation:'月亮',phonetic:''},true)
 await translateChapter(book,0,options({request:transport()}));await translateChapter(book,1,options({request:transport()}))
 await deleteChapterTranslation(book.id,book.chapters[0].id);assert.equal(await readChapterTranslation(book,book.chapters[0]),undefined);assert.ok(await readChapterTranslation(book,book.chapters[1]))
 await deleteBookTranslations(book.id);assert.equal(await readChapterTranslation(book,book.chapters[1]),undefined);assert.equal((await listBooks()).length,1);assert.equal((await listFavorites()).length,1)
}))
test('既有人工partial范围原样保留，补译不重叠；术语随现有备份/导出格式往返',()=>device(async()=>{
 const template=(await createTranslationTemplate(book,[0])).chapters[0];template.segments=template.segments.slice(0,1);template.segments[0].targetText=targets[0];template.glossary={林澈:'Lin Che'}
 await saveChapterTranslation(book,0,template);assert.equal(missingSegments(book,0,template).length,10)
 const result=await translateChapter(book,0,options({request:transport()}));assert.equal(result.segments[0].targetText,targets[0]);assert.equal(result.status,'complete')
 const restored=await validateChapterTranslation(JSON.parse(JSON.stringify(result)),book,0);assert.equal(restored.glossary.林澈,'Lin Che');assert.equal(restored.identity.provider,'mixed-user-cloudflare')
}))
test('超长单句明确停止，空/重复批次及术语污染拒绝，普通数字保持正确',async()=>{
 await device(async()=>{const b={...book,id:'long',chapters:[{id:'long',title:'长句',order:0,paragraphs:['文'.repeat(AUTO_LIMITS.singleSource+1)]}]};await assert.rejects(translateChapter(b,0,options({request:transport()})),/单句/);assert.equal(await readChapterTranslation(b,b.chapters[0]),undefined)})
 assert.throws(()=>validateBatch({...batch,segments:[batch.segments[0],batch.segments[0]]}),/重复/)
 assert.throws(()=>validateBatch({...batch,glossary:JSON.parse('{"__proto__":"bad"}')}))
 const numeric={...batch,segments:[{id:'num',text:'2026'}]}
 assert.ok(validateBatchResult({version:1,model:MODEL,translations:[{id:'num',text:'2026'}],glossary:{}},numeric))
})
test('React自动触发：一次授权后高档自动翻译，换档不重译；取消和删缓存后不会自行重启',()=>device(async()=>{
 const {JSDOM}=await import('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:origin}),saved={}
 for(const key of ['window','document','navigator','localStorage','IS_REACT_ACT_ENVIRONMENT'])saved[key]=Object.getOwnPropertyDescriptor(globalThis,key)
 Object.defineProperties(globalThis,{window:{configurable:true,value:dom.window},document:{configurable:true,value:dom.window.document},navigator:{configurable:true,value:dom.window.navigator},localStorage:{configurable:true,value:dom.window.localStorage},IS_REACT_ACT_ENVIRONMENT:{configurable:true,value:true}})
 const priorFetch=globalThis.fetch;let calls=0,api,translation
 globalThis.fetch=async(url,init)=>worker.fetch(new Request(url,{...init,headers:{...init.headers,Origin:origin,'CF-Connecting-IP':'192.0.2.1'}}),env(async(model,input)=>{calls++;return {response:JSON.stringify(answer(JSON.parse(input.messages[1].content)))}}))
 const React=await import('react'),{createRoot}=await import('react-dom/client'),{useAutoTranslation}=await import('../src/features/translation/automatic/useAutoTranslation.ts')
 let root=createRoot(document.getElementById('root'))
 function Harness(){const [value,setValue]=React.useState();translation=value;api=useAutoTranslation({serviceUrl:'https://translate.example/translate',book,index:0,high:true,loading:false,error:'',translation:value,onUpdate:setValue,paragraph:0,offset:0});return React.createElement('p',null,api.state)}
 const settle=async predicate=>{for(let i=0;i<100&&!predicate();i++)await React.act(async()=>{await new Promise(resolve=>setTimeout(resolve,5))});assert.ok(predicate())}
 try{
  await React.act(async()=>{root.render(React.createElement(React.StrictMode,null,React.createElement(Harness)))})
  assert.equal(calls,0);assert.equal(api.consent,false)
  await React.act(async()=>api.enable());await settle(()=>api.state==='complete');assert.equal(translation.status,'complete');assert.equal(calls,2)
  await React.act(async()=>api.retry());await settle(()=>api.state==='complete');assert.equal(calls,2)
  await React.act(async()=>{await api.stop();await deleteChapterTranslation(book.id,book.chapters[0].id)})
  await settle(()=>api.state==='paused');assert.equal(await readChapterTranslation(book,book.chapters[0]),undefined);assert.equal(calls,2)
  await React.act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await React.act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Harness))));await settle(()=>api.state==='complete');assert.equal(calls,4)
 }finally{await React.act(async()=>root.unmount());globalThis.fetch=priorFetch;dom.window.close();for(const [key,descriptor]of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
}))
test('其他标签页在推理期间写入译文，自动任务不覆盖，重新读取后复用',()=>device(async()=>{
 const manual=(await createTranslationTemplate(book,[0])).chapters[0]
 for(const segment of manual.segments)segment.targetText='A separately reviewed English sentence.'
 let once=false
 await assert.rejects(translateChapter(book,0,options({request:transport(async()=>{if(!once){once=true;await saveChapterTranslation(book,0,manual)}})})),/其他页面/)
 const cached=await readChapterTranslation(book,book.chapters[0]);assert.equal(cached.status,'complete');assert.ok(cached.segments.every(s=>s.targetText==='A separately reviewed English sentence.'))
 let calls=0;await translateChapter(book,0,options({request:transport(()=>calls++)}));assert.equal(calls,0)
}))
test('模型无思考前缀/已解析JSON均可校验，未闭合或截断内容不能保存',async()=>{
 for(const response of ['<think>\n\n</think>\n'+JSON.stringify(answer(batch)),answer(batch)])assert.equal((await worker.fetch(req(),env(async()=>({response})))).status,200)
 assert.equal((await worker.fetch(req(),env(async()=>({response:'<think>unfinished'})))).status,502)
})
test('中等长句单独请求，不与其他句子拼批；不机械切碎原始句子',()=>device(async()=>{
 const text='她继续走向远方，'.repeat(150)+'终于回到了家。',b={...book,id:'long-valid',chapters:[{id:'long-valid',title:'长句',order:0,paragraphs:[text,'雨已经停了。']}]},sent=[]
 const result=await translateChapter(b,0,options({request:transport(p=>sent.push(p))}))
 assert.equal(result.status,'complete');const long=sent.find(p=>p.segments.some(s=>s.text===text));assert.equal(long.segments.length,1)
}))

test('自动翻译批次保存遇到容量不足会失败，已保存部分保留，重试不重复翻译',()=>device(async()=>{
 const put=IDBObjectStore.prototype.put;let count=0
 IDBObjectStore.prototype.put=function(value,...args){if(this.name==='chapters'&&value.bookId===book.id&&++count===2)throw new DOMException('full','QuotaExceededError');return put.call(this,value,...args)}
 try{await assert.rejects(translateChapter(book,0,options({request:transport()})),{name:'QuotaExceededError'})}finally{IDBObjectStore.prototype.put=put}
 const saved=await readChapterTranslation(book,book.chapters[0]);assert.equal(saved.status,'partial');const old=new Set(saved.segments.map(s=>s.sourceText)),sent=[]
 await translateChapter(book,0,options({request:transport(p=>sent.push(...p.segments))}));assert.ok(sent.every(s=>!old.has(s.text)))
}))
