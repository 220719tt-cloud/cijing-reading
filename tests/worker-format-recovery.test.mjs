import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/translation.ts'
import {MODEL,boundedJson} from '../src/features/translation/automatic/protocol.ts'
import {checkedModelOutput} from '../worker/modelOutput.ts'
import {IDBFactory} from 'fake-indexeddb'
import {translateChapter} from '../src/features/translation/automatic/engine.ts'
import {requestTranslation} from '../src/features/translation/automatic/client.ts'
import {createTranslationTemplate} from '../src/features/translation/package.ts'
import {saveChapterTranslation} from '../src/features/translation/storage.ts'
const segment={id:'s0',text:'“你准备好了吗？”林澈问。'}
const batch={version:1,segments:[segment],context:'他们在门口等待。',glossary:{林澈:'Lin Che'}}
const text='“Are you ready?” Lin Che asked. “The file is at C:\\Books.”'
const env=run=>({AI:{run},PER_IP:{limit:async()=>({success:true})},GLOBAL:{limit:async()=>({success:true})},ALLOWED_ORIGINS:'https://reader.example',TRANSLATION_ENABLED:'true'})
const request=value=>new Request('https://worker.example/translate',{method:'POST',headers:{Origin:'https://reader.example','CF-Connecting-IP':'192.0.2.1','Content-Type':'application/json'},body:JSON.stringify(value)})
test('显式ignoreBOM:false兼容Cloudflare编辑器类型并安全接受UTF-8 BOM，仍拒绝坏字节和超限',async()=>{
 const bytes=new TextEncoder().encode('\uFEFF{"version":1}')
 assert.deepEqual(await boundedJson(new Response(bytes).body,100),{version:1})
 await assert.rejects(boundedJson(new Response(Uint8Array.of(0xff)).body,100))
 await assert.rejects(boundedJson(new Response(bytes).body,2),/过大/)
})
test('前端仅接收固定模型诊断，未知诊断或私人错误正文不进入UI',async()=>{
 for(const reason of ['TOKEN_LIMIT','EXTRA_OUTPUT','TARGET_VALIDATION','NAME_SPELLING','PRIVATE_STORY']){
  await assert.rejects(requestTranslation('https://worker.example/translate',batch,new AbortController().signal,async()=>Response.json({code:'MODEL_ALIGNMENT_INVALID',reason,error:'PRIVATE_STORY'},{status:502})),error=>error.code==='MODEL_ALIGNMENT_INVALID'&&error.reason===(reason==='PRIVATE_STORY'?undefined:reason)&&!error.message.includes('PRIVATE_STORY'))
 }
})
test('单句纯英文输出由服务端安全封装JSON，普通对话引号和反斜杠不再要求模型转义',async()=>{
 let calls=0
 const response=await worker.fetch(request(batch),env(async(model,input)=>{
  calls++;assert.equal(model,MODEL);assert.ok(input.messages[0].content.includes('No JSON'))
  assert.equal(JSON.parse(input.messages[1].content).requiredOutputShape,undefined)
  assert.equal(input.temperature,.1);assert.equal(input.max_tokens,1024)
  return {response:text}
 }))
 assert.equal(calls,1);assert.equal(response.status,200)
 assert.deepEqual(await response.json(),{version:1,model:MODEL,translations:[{id:'s0',text}],glossary:batch.glossary})
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://reader.example')
})
test('不会从坏JSON修补或编造译文，单句仍拒绝中文/说明文字/截断/错误名字/未闭合思考',()=>{
 const cases=[
  [{response:'{"translations":[{"id":"s0","text":"bad "quote"'} ,'MODEL_JSON_INVALID'],
  [{response:segment.text},'MODEL_ALIGNMENT_INVALID'],
  [{response:'Translation: PRIVATE_STORY'},'MODEL_ALIGNMENT_INVALID'],
  [{response:'Here is the English translation: Lin Che asked.'},'MODEL_ALIGNMENT_INVALID'],
  [{response:'Lin Che asked.\n"glossary": {}'},'MODEL_ALIGNMENT_INVALID'],
  [{response:'<think>PRIVATE_STORY'},'MODEL_OUTPUT_INVALID'],
  [{response:'“Are you ready? Lin Che asked.'},'MODEL_OUTPUT_INVALID'],
  [{response:'“Are you ready?” Other Name asked.'},'MODEL_GLOSSARY_INVALID'],
  [{choices:[{finish_reason:'length',message:{content:text}}]},'MODEL_OUTPUT_INVALID'],
  [{response:text,finish_reason:'length'},'MODEL_OUTPUT_INVALID'],
 ]
 for(const [output,code]of cases)assert.throws(()=>checkedModelOutput(output,batch),e=>e.code===code&&!e.message.includes('PRIVATE_STORY'))
})
test('多句继续校验完整ID集合，不猜测顺序映射；只接受完整JSON包裹，不抓取半截译文',async()=>{
 const multi={...batch,segments:[segment,{id:'s1',text:'雨停了。'}]}
 const output={translations:[{id:'s0',text},{id:'s1',text:'The rain had stopped.'}],glossary:batch.glossary}
 const ok=await worker.fetch(request(multi),env(async(_model,input)=>{
  assert.ok(JSON.parse(input.messages[1].content).requiredOutputShape)
  return {response:'<think></think>\n```json\n'+JSON.stringify(output)+'\n```'}
 }))
 assert.equal(ok.status,200)
 for(const raw of [text,JSON.stringify({...output,translations:[output.translations[0]]}),JSON.stringify({...output,translations:[output.translations[0],output.translations[0]]}),JSON.stringify({...output,translations:[{id:'wrong',text},output.translations[1]]})])assert.throws(()=>checkedModelOutput({response:raw},multi))
})
test('不兼容输出只返回固定诊断，不泄漏私有文本；Worker不暗中重试或取消限流',async()=>{
 let calls=0
 const invalid=await worker.fetch(request(batch),env(async()=>{calls++;return {response:'{"PRIVATE_STORY":bad}'}}))
 const error=await invalid.json();assert.equal(invalid.status,502);assert.equal(error.reason,'INVALID_JSON');assert.ok(!JSON.stringify(error).includes('PRIVATE_STORY'));assert.equal(calls,1)
 const limited=await worker.fetch(request(batch),{...env(async()=>{calls++}),GLOBAL:{limit:async()=>({success:false})}})
 assert.equal(limited.status,429);assert.equal(calls,1)
})
test('首次对话单独请求，坏JSON批次直接跳过，不拆批重发，已有译文保持不变',async()=>{
 const saved=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory()
 try{
  const paragraphs=['雨停了。','她打开窗户。','“早上好！”她说。','他放下信。','她点点头。','门开了。']
  const targets=['The rain stopped.','She opened the window.','“Good morning!” she said.','He put down the letter.','She nodded.','The door opened.']
  const book={id:'single-text-recovery',title:'原创格式测试',source:'epub',chapters:[{id:'r',title:'测试章',order:0,paragraphs}]}
  const seed=(await createTranslationTemplate(book)).chapters[0];seed.segments=seed.segments.slice(0,1);seed.segments[0].targetText=targets[0]
  const old=await saveChapterTranslation(book,0,seed),snapshots=[],calls=[]
  const value=await translateChapter(book,0,{endpoint:'https://worker.example/translate',signal:new AbortController().signal,paragraph:0,offset:0,onUpdate:t=>snapshots.push(t.segments.length),onProgress:()=>{},schedule:async()=>{},request:(url,batch,signal)=>requestTranslation(url,batch,signal,async(_url,init)=>{
   const reply=await worker.fetch(request(JSON.parse(init.body)),env(async(_model,input)=>{
    const payload=JSON.parse(input.messages[1].content);calls.push(payload.segments.map(s=>s.text))
    assert.ok(payload.segments.every(s=>s.text!==paragraphs[0]))
    if(payload.segments.length>1)return {response:'{"translations": broken'}
    return {response:targets[paragraphs.indexOf(payload.segments[0].text)]}
   }))
   return reply
  })})
  assert.equal(value.status,'partial');assert.deepEqual(value.segments[0],old.segments[0]);assert.equal(value.segments.length,3);assert.equal(value.failures.length,3)
  for(const segment of value.segments)assert.equal(segment.targetText,targets[segment.source.paragraph])
  assert.ok(snapshots.includes(2)&&snapshots.includes(3));assert.equal(calls.filter(c=>c.length===1).length,2);assert.equal(calls.length,3);assert.equal(new Set(calls.flat()).size,calls.flat().length)
 }finally{globalThis.indexedDB=saved}
})
test('生成的worker.js无需其他文件，可直接作为Cloudflare ES模块执行并保留安全检查',async()=>{
 const {readFile}=await import('node:fs/promises'),bundle=await readFile(new URL('../worker/worker.js',import.meta.url),'utf8')
 assert.equal(/^\s*import\s/m.test(bundle),false)
 const bundled=(await import('../worker/worker.js')).default
 const result=await bundled.fetch(request(batch),env(async()=>({response:text})))
 assert.equal(result.status,200);assert.equal((await result.json()).translations[0].text,text)
 assert.equal((await bundled.fetch(new Request('https://worker.example/translate',{method:'POST',headers:{Origin:'https://evil.example'}}),env(async()=>{throw new Error('must not run')}))).status,403)
})
test('在线编辑器单文件与当前源码一致，避免给用户过期的worker.js',async()=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{fileURLToPath}=await import('node:url')
 const {stdout}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/build_worker_editor.mjs',import.meta.url)),'--check'])
 assert.ok(stdout.includes('matches source'))
})
