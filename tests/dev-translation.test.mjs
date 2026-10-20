import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer,request as httpRequest} from 'node:http'
import {createDevTranslationHandler,DEV_TRANSLATION_PATH} from '../config/devTranslationProxy.ts'
import {TRANSLATION_WEBSITE_ORIGIN} from '../config/translation.ts'
import {MODEL} from '../src/features/translation/automatic/protocol.ts'

const endpoint='https://cijing-translation.220719tt.workers.dev/translate'
const batch={version:1,segments:[{id:'a',text:'雨停了。'}],context:'清晨。',glossary:{}}
const result={version:1,model:MODEL,translations:[{id:'a',text:'The rain had stopped.'}],glossary:{}}
async function local(action,upstream){
 let handler;const server=createServer((request,response)=>void handler(request,response))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const origin=`http://127.0.0.1:${server.address().port}`
 handler=createDevTranslationHandler(endpoint,origin,upstream)
 try{await action(origin)}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
}
const post=(origin,body=batch,headers={})=>fetch(origin+DEV_TRANSLATION_PATH,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)})
test('开发转发仅允许本机同源、固定路径和合法批次；坏请求不接触AI',async()=>{
 let calls=0
 await local(async origin=>{
  for(const wrong of ['https://evil.example','http://127.0.0.1:1',''])assert.equal((await post(origin,batch,{Origin:wrong})).status,403)
  assert.equal((await fetch(origin+'/other',{headers:{Origin:origin}})).status,404)
  assert.equal((await fetch(origin+DEV_TRANSLATION_PATH,{headers:{Origin:origin}})).status,405)
  assert.equal((await post(origin,batch,{'Content-Type':'text/plain'})).status,415)
  assert.equal((await post(origin,{segments:batch.segments,context:'',glossary:{}})).status,400)
  assert.equal((await post(origin,{...batch,context:'文'.repeat(40000)})).status,413)
  assert.equal((await fetch(origin+DEV_TRANSLATION_PATH+'?target=https://evil.example',{method:'POST',headers:{Origin:origin}})).status,404)
  const hostStatus=await new Promise((resolve,reject)=>{
   const req=httpRequest(origin+DEV_TRANSLATION_PATH,{method:'POST',headers:{Host:'evil.example',Origin:origin,'Content-Type':'application/json'}},response=>{response.resume();resolve(response.statusCode)});req.on('error',reject);req.end(JSON.stringify(batch))
  });assert.equal(hostStatus,403);assert.equal(calls,0)
 },async()=>{calls++;return Response.json(result)})
 assert.throws(()=>createDevTranslationHandler(endpoint,'http://0.0.0.0:5194'))
 assert.throws(()=>createDevTranslationHandler('http://evil.example','http://127.0.0.1:5194'))
})
test('本机请求按原协议转发到固定Worker，结果校验且不转发cookie/客户端伪造来源',async()=>{
 let calls=0
 await local(async origin=>{
  const response=await post(origin,{...batch,model:'evil',url:'https://evil.example'},{Cookie:'private=test'})
  assert.equal(response.status,200);assert.deepEqual(await response.json(),result)
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Access-Control-Allow-Origin'),null)
 },async(url,options)=>{
  calls++;assert.equal(url,endpoint);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit')
  assert.deepEqual(options.headers,{'Content-Type':'application/json',Origin:TRANSLATION_WEBSITE_ORIGIN})
  assert.deepEqual(JSON.parse(options.body),batch)
  return Response.json(result)
 });assert.equal(calls,1)
})
test('限流与额度错误原样返回且转发不重试；无效英文绝不伪装成功',async()=>{
 for(const status of [429,503]){
  let calls=0
  await local(async origin=>{const response=await post(origin);assert.equal(response.status,status);assert.equal(response.headers.get('Retry-After'),'60')},async()=>{calls++;return Response.json({error:'暂不可用'},{status,headers:{'Retry-After':'60'}})})
  assert.equal(calls,1)
 }
 await local(async origin=>{assert.equal((await post(origin)).status,502)},async()=>Response.json({...result,translations:[{id:'a',text:'雨停了。'}]}))
})
test('开发转发保留上游200响应的JSON/对应错误分类，使前端可以有限拆批恢复而非通用502中止',async()=>{
 for(const [upstream,code]of [[()=>new Response('{broken'),'MODEL_JSON_INVALID'],[()=>Response.json({...result,translations:[{id:'wrong',text:'The rain stopped.'}]}),'MODEL_ALIGNMENT_INVALID']]){
  let calls=0
  await local(async origin=>{const response=await post(origin);assert.equal(response.status,502);assert.equal((await response.json()).code,code)},async()=>{calls++;return upstream()})
  assert.equal(calls,1)
 }
})
test('本机到云端连接失败保留固定NETWORK_ERROR，不伪装成模型格式错让整章继续发请求',async()=>{
 let calls=0
 await local(async origin=>{
  const response=await post(origin);assert.equal(response.status,502)
  const body=await response.json();assert.equal(body.code,'NETWORK_ERROR');assert.ok(!JSON.stringify(body).includes('PRIVATE_DETAIL'))
 },async()=>{calls++;throw new TypeError('PRIVATE_DETAIL')})
 assert.equal(calls,1)
})
test('开发连接探测仅转发固定Worker OPTIONS，来源校验保留，不发正文或计入AI请求',async()=>{
 let probes=0
 await local(async origin=>{
  assert.equal((await fetch(origin+DEV_TRANSLATION_PATH,{method:'OPTIONS',headers:{Origin:'https://evil.example'}})).status,403)
  const response=await fetch(origin+DEV_TRANSLATION_PATH,{method:'OPTIONS',headers:{Origin:origin}})
  assert.equal(response.status,204);assert.equal(await response.text(),'')
 },async(url,o)=>{probes++;assert.equal(url,endpoint);assert.equal(o.method,'OPTIONS');assert.equal(o.body,undefined);assert.equal(o.headers.Origin,TRANSLATION_WEBSITE_ORIGIN);return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':TRANSLATION_WEBSITE_ORIGIN}})})
 assert.equal(probes,1)
})
test('上游未允许正式来源时连接探测不得假报恢复',async()=>{
 await local(async origin=>{const response=await fetch(origin+DEV_TRANSLATION_PATH,{method:'OPTIONS',headers:{Origin:origin}});assert.equal(response.status,502)},async()=>new Response(null,{status:204}))
})
