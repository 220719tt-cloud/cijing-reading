import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {IDBFactory} from 'fake-indexeddb'
import {translateChapter,missingSegments} from '../src/features/translation/automatic/engine.ts'
import {MODEL} from '../src/features/translation/automatic/protocol.ts'
import {TranslationRequestError} from '../src/features/translation/automatic/errors.ts'
import {probeTranslationConnection,NETWORK_POLICY} from '../src/features/translation/automatic/networkRecovery.ts'
import {readChapterTranslation,saveChapterTranslation} from '../src/features/translation/storage.ts'
import {createTranslationTemplate} from '../src/features/translation/package.ts'
// Deterministic response doubles validate recovery/cache, never real AI quality.
const fixture=()=>({schemaVersion:1,id:crypto.randomUUID(),title:'原创网络恢复测试',source:'txt',chapters:[{id:'c',title:'正文',order:0,paragraphs:Array.from({length:9},(_,i)=>`第${i+1}封信放在桌上。`)}]})
const answer=b=>({version:1,model:MODEL,translations:b.segments.map(s=>({id:s.id,text:`Letter ${s.text.match(/\d+/)[0]} lay on the table.`})),glossary:b.glossary})
const options=extra=>({endpoint:'https://network.example/translate',signal:new AbortController().signal,paragraph:0,offset:0,onUpdate(){},onProgress(){},schedule:async()=>{},networkRecovery:{probe:async()=>true,delay:async()=>{}},...extra})
async function device(action){const old=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();try{await action()}finally{globalThis.indexedDB=old}}
async function seed(book,n=3){const c=(await createTranslationTemplate(book)).chapters[0];c.segments=c.segments.slice(0,n);for(const s of c.segments)s.targetText=`Letter ${s.source.paragraph+1} lay on the table.`;return saveChapterTranslation(book,0,c)}
const network=()=>new TranslationRequestError('NETWORK_ERROR','reset')

test('中断后只重试未完成批次；旧成功不发送，未处理不记跳过，恢复后继续全章',()=>device(async()=>{
 const b=fixture(),before=JSON.stringify(b),old=await seed(b),calls=[],progress=[];let probes=0
 const value=await translateChapter(b,0,options({onProgress:p=>progress.push(p),networkRecovery:{probe:async()=>{probes++;return true},delay:async()=>{}},request:async(_u,batch)=>{calls.push(batch);if(calls.length===1)throw network();return answer(batch)}}))
 assert.equal(calls.length,3);assert.equal(probes,1);assert.equal(value.status,'complete');assert.equal(value.failures,undefined)
 assert.ok(calls.every(c=>c.segments.every(s=>!old.segments.some(x=>x.sourceText===s.text))))
 assert.deepEqual(calls[0],calls[1]);assert.deepEqual(value.segments.slice(0,3),old.segments)
 assert.ok(progress.some(p=>p.stage==='reconnecting'&&p.pending===6&&p.skipped===0));assert.equal(progress.at(-1).networkRetries,1)
 assert.equal(JSON.stringify(b),before);assert.deepEqual(await readChapterTranslation(b,b.chapters[0]),value)
}))
test('完全断网只发一次翻译、最多三次非AI探测，然后暂停；刷新重开保留队列和缓存',()=>device(async()=>{
 const b=fixture(),old=await seed(b);let posts=0,probes=0;const events=[]
 await assert.rejects(translateChapter(b,0,options({onProgress:p=>events.push(p),networkRecovery:{probe:async()=>{probes++;return false},delay:async()=>{}},request:async()=>{posts++;throw network()}})),e=>e.code==='NETWORK_ERROR')
 assert.equal(posts,1);assert.equal(probes,3);assert.equal(events.at(-1).pending,6);assert.equal(events.at(-1).skipped,0)
 assert.deepEqual(await readChapterTranslation(b,b.chapters[0]),old)
 const sent=[];const value=await translateChapter(b,0,options({request:async(_u,batch)=>{sent.push(...batch.segments);return answer(batch)}}))
 assert.equal(value.status,'complete');assert.equal(sent.length,6);assert.ok(sent.every(s=>!old.segments.some(x=>x.sourceText===s.text)))
}))
test('探测成功也不无限发模型：整章最多两次额外重试，不把后文标记跳过',()=>device(async()=>{
 const b=fixture();let posts=0,probes=0
 await assert.rejects(translateChapter(b,0,options({networkRecovery:{probe:async()=>{probes++;return true},delay:async()=>{}},request:async()=>{posts++;throw network()}})),e=>e.code==='NETWORK_ERROR')
 assert.equal(posts,1+NETWORK_POLICY.retries);assert.equal(probes,2);assert.equal(await readChapterTranslation(b,b.chapters[0]),undefined)
}))
test('恢复额度跨批次共用；普通模型错误仍只跳过一次，不启动网络重试',()=>device(async()=>{
 const b=fixture(),calls=[];let probes=0
 await assert.rejects(translateChapter(b,0,options({networkRecovery:{probe:async()=>{probes++;return true},delay:async()=>{}},request:async(_u,batch)=>{calls.push(batch);if([1,3,5].includes(calls.length))throw network();return answer(batch)}})),e=>e.code==='NETWORK_ERROR')
 assert.equal(calls.length,5);assert.equal(probes,2);const saved=await readChapterTranslation(b,b.chapters[0]);assert.equal(saved.segments.length,6);assert.equal(saved.failures,undefined)
 let modelCalls=0;const c=fixture()
 const value=await translateChapter(c,0,options({networkRecovery:{probe:async()=>{throw new Error('model failure must not probe')},delay:async()=>{}},request:async(_u,batch)=>{if(++modelCalls===1)throw new TranslationRequestError('MODEL_JSON_INVALID','bad',502);return answer(batch)}}))
 assert.equal(modelCalls,3);assert.equal(value.failures.length,3);assert.equal(value.segments.length,6)
}))
test('超时属于传输恢复；鉴权、限流和额度错误立即暂停，不探测、不自动重发',()=>device(async()=>{
 for(const code of ['REQUEST_TIMEOUT','HTTP_403','HTTP_429','HTTP_503']){
  const b=fixture();let calls=0,probes=0
  const task=translateChapter(b,0,options({networkRecovery:{probe:async()=>{probes++;return true},delay:async()=>{}},request:async(_u,batch)=>{if(++calls===1)throw new TranslationRequestError(code,'fixed');return answer(batch)}}))
  if(code==='REQUEST_TIMEOUT'){assert.equal((await task).status,'complete');assert.equal(calls,4);assert.equal(probes,1)}
  else{await assert.rejects(task,e=>e.code===code);assert.equal(calls,1);assert.equal(probes,0)}
 }
}))
test('恢复期间另一个标签已写成功缓存，重新读取后不再请求这些内容',()=>device(async()=>{
 const b=fixture();let calls=0;await seed(b)
 const value=await translateChapter(b,0,options({networkRecovery:{delay:async()=>{},probe:async()=>{const t=(await createTranslationTemplate(b)).chapters[0];for(const s of t.segments)s.targetText=`Letter ${s.source.paragraph+1} lay on the table.`;await saveChapterTranslation(b,0,t);return true}},request:async()=>{calls++;throw network()}}))
 assert.equal(calls,1);assert.equal(value.status,'complete');assert.equal(value.segments.length,9)
}))
test('等待恢复期间暂停或离章会取消恢复，不再发送模型请求，保留已缓存',()=>device(async()=>{
 const b=fixture(),old=await seed(b),controller=new AbortController();let calls=0,probes=0
 await assert.rejects(translateChapter(b,0,options({signal:controller.signal,networkRecovery:{delay:async()=>controller.abort(),probe:async()=>{probes++;return true}},request:async()=>{calls++;throw network()}})),e=>e.name==='AbortError')
 assert.equal(calls,1);assert.equal(probes,0);assert.deepEqual(await readChapterTranslation(b,b.chapters[0]),old)
}))
test('连接探测只发OPTIONS、不要正文/凭据；204以外不伪装恢复，403/429/503暂停',async()=>{
 let calls=0;const signal=new AbortController().signal
 assert.equal(await probeTranslationConnection('https://network.example',signal,async(_u,o)=>{calls++;assert.equal(o.method,'OPTIONS');assert.equal(o.body,undefined);assert.equal(o.credentials,'omit');return new Response(null,{status:204})}),true)
 assert.equal(calls,1)
 assert.equal(await probeTranslationConnection('https://network.example',signal,async()=>new Response('html')),false)
 for(const status of [403,429,503])await assert.rejects(probeTranslationConnection('https://network.example',signal,async()=>new Response('',{status})),e=>e.code===`HTTP_${status}`)
})
test('真实本地TCP断开后经OPTIONS恢复：只请求未缓存批次，不依赖真实云端AI',()=>device(async()=>{
 const b=fixture();await seed(b);let posts=0,probes=0
 const server=createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){probes++;res.writeHead(204).end();return}
  let text='';for await(const chunk of req)text+=chunk
  posts++;if(posts===1){res.destroy();return}
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(answer(JSON.parse(text))))
 })
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 try{const value=await translateChapter(b,0,options({endpoint:`http://127.0.0.1:${server.address().port}`,request:undefined,networkRecovery:{delay:async()=>{}}}));assert.equal(value.status,'complete');assert.equal(posts,3);assert.equal(probes,1)}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
}))
test('转发超时保持REQUEST_TIMEOUT分类，不被504普通模型跳过策略吞掉',async()=>{
 const {requestTranslation}=await import('../src/features/translation/automatic/client.ts')
 const b={version:1,segments:[{id:'a',text:'雨停了。'}],context:'',glossary:{}}
 await assert.rejects(requestTranslation('https://network.example',b,new AbortController().signal,async()=>Response.json({code:'REQUEST_TIMEOUT'},{status:504})),e=>e.code==='REQUEST_TIMEOUT')
})
test('恢复探测遭到403后立即停止，不重发或把剩余内容标成跳过',()=>device(async()=>{
 const b=fixture(),old=await seed(b);let posts=0
 await assert.rejects(translateChapter(b,0,options({networkRecovery:{delay:async()=>{},probe:async()=>{throw new TranslationRequestError('HTTP_403','blocked',403)}},request:async()=>{posts++;throw network()}})),e=>e.code==='HTTP_403')
 assert.equal(posts,1);assert.deepEqual(await readChapterTranslation(b,b.chapters[0]),old)
}))
test('探测超时与预先取消有界结束，不发送翻译或泄漏后台计时器',async()=>{
 const old=NETWORK_POLICY.probeTimeout;NETWORK_POLICY.probeTimeout=5
 try{
  const controller=new AbortController()
  assert.equal(await probeTranslationConnection('https://network.example',controller.signal,async(_u,o)=>new Promise((_resolve,reject)=>o.signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')),{once:true}))),false)
  controller.abort();let calls=0
  await assert.rejects(probeTranslationConnection('https://network.example',controller.signal,async()=>{calls++;return new Response(null,{status:204})}),e=>e.name==='AbortError')
  assert.equal(calls,0)
 }finally{NETWORK_POLICY.probeTimeout=old}
})
