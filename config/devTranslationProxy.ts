import type {IncomingMessage,ServerResponse} from 'node:http'
import type {Plugin} from 'vite'
import {AUTO_LIMITS,boundedJson,validateBatch} from '../src/features/translation/automatic/protocol.ts'
import {validateAvailableResult} from '../src/features/translation/automatic/availableResult.ts'
import {TRANSLATION_WEBSITE_ORIGIN} from './translation.ts'

export const DEV_TRANSLATION_PATH='/__dev/translate'
class RequestFailure extends Error{
  readonly status:number
  constructor(status:number,message:string){super(message);this.status=status}
}
function readRequest(request:IncomingMessage):Promise<unknown>{
  return new Promise((resolve,reject)=>{
    let size=0,settled=false;const chunks:Buffer[]=[]
    request.on('data',(chunk:Buffer)=>{
      if(settled)return
      size+=chunk.length
      if(size>AUTO_LIMITS.requestBytes){settled=true;chunks.length=0;reject(new RequestFailure(413,'请求过大。'));return}
      chunks.push(chunk)
    })
    request.on('end',()=>{if(settled)return;settled=true;try{resolve(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))))}catch{reject(new RequestFailure(400,'翻译请求JSON无效。'))}})
    request.on('error',()=>{if(!settled){settled=true;reject(new RequestFailure(400,'无法读取翻译请求。'))}})
    request.on('aborted',()=>{if(!settled){settled=true;reject(new RequestFailure(400,'翻译请求已取消。'))}})
  })
}

/** User-authorized development relay. Loopback + exact local Origin only; never a Pages asset. */
export function createDevTranslationHandler(endpoint:string,localOrigin:string,fetcher:typeof fetch=fetch,onForward?:(segments:number)=>void){
  const local=new URL(localOrigin),upstream=new URL(endpoint)
  if(local.protocol!=='http:'||local.hostname!=='127.0.0.1'||upstream.protocol!=='https:'||upstream.username||upstream.password||upstream.search||upstream.hash)throw new Error('开发翻译转发地址无效。')
  return async(request:IncomingMessage,response:ServerResponse)=>{
    const send=(status:number,body:unknown)=>{if(!response.destroyed){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(body))}}
    if(request.url!==DEV_TRANSLATION_PATH){send(404,{error:'接口不存在。'});return}
    if(!['127.0.0.1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress??'')||request.headers.host!==local.host||request.headers.origin!==local.origin){send(403,{error:'开发翻译仅允许当前本机页面调用。'});return}
    if(request.method==='OPTIONS'){
      const controller=new AbortController(),cancel=()=>controller.abort()
      const timeout=setTimeout(cancel,5000);response.on('close',cancel)
      try{
        const result=await fetcher(upstream.href,{method:'OPTIONS',credentials:'omit',redirect:'error',headers:{Origin:TRANSLATION_WEBSITE_ORIGIN,'Access-Control-Request-Method':'POST'},signal:controller.signal})
        await result.body?.cancel()
        if(result.status===204&&result.headers.get('Access-Control-Allow-Origin')===TRANSLATION_WEBSITE_ORIGIN){response.writeHead(204,{'Cache-Control':'no-store'});response.end()}
        else send([403,429,503].includes(result.status)?result.status:502,{error:'连接检查未通过，未调用AI。'})
      }catch{send(502,{code:'NETWORK_ERROR',error:'连接检查失败，未调用AI。'})}
      finally{clearTimeout(timeout);response.off('close',cancel)}
      return
    }
    if(request.method!=='POST'){send(405,{error:'仅支持POST。'});return}
    if(!request.headers['content-type']?.startsWith('application/json')){send(415,{error:'仅接受JSON。'});return}
    if(Number(request.headers['content-length'])>AUTO_LIMITS.requestBytes){send(413,{error:'请求过大。'});return}
    const controller=new AbortController(),disconnect=()=>{if(!response.writableEnded)controller.abort()}
    response.on('close',disconnect)
    const timeout=setTimeout(()=>controller.abort(),60000)
    try{
      let batch
      try{batch=validateBatch(await readRequest(request))}catch(error){send(error instanceof RequestFailure?error.status:400,{error:'翻译请求格式错误或超出限制。'});return}
      if(controller.signal.aborted)return
      onForward?.(batch.segments.length)
      const result=await fetcher(upstream.href,{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json',Origin:TRANSLATION_WEBSITE_ORIGIN},body:JSON.stringify(batch),signal:controller.signal})
      let body:unknown
      try{body=await boundedJson(result.body,result.ok?AUTO_LIMITS.outputBytes:2048)}catch(error){
        if(!controller.signal.aborted&&result.ok){send(502,{error:'上游成功响应未通过完整JSON校验。',code:error instanceof SyntaxError?'MODEL_JSON_INVALID':'MODEL_OUTPUT_INVALID'});return}
        throw error
      }
      const retry=result.headers.get('Retry-After')
      if(retry&&/^\d{1,5}$/.test(retry))response.setHeader('Retry-After',retry)
      if(result.ok){try{body=validateAvailableResult(body,batch)}catch{send(502,{error:'上游成功响应未通过句组严格对应校验。',code:'MODEL_ALIGNMENT_INVALID'});return}}
      send(result.status,body)
    }catch{if(!response.destroyed)send(controller.signal.aborted?504:502,{code:controller.signal.aborted?'REQUEST_TIMEOUT':'NETWORK_ERROR',error:controller.signal.aborted?'开发翻译请求超时，可重试。':'本机转发无法连接云端，请检查网络或Worker状态。'})}
    finally{clearTimeout(timeout);response.off('close',disconnect)}
  }
}

export function devTranslationProxy(endpoint:string):Plugin{
  return {name:'loopback-only-translation',apply:'serve',configureServer(server){
    let requests=0
    server.middlewares.use((request,response,next)=>{
      if(request.url?.split('?')[0]!==DEV_TRANSLATION_PATH){next();return}
      const address=server.httpServer?.address()
      if(!address||typeof address==='string'){response.writeHead(503).end();return}
      void createDevTranslationHandler(endpoint,`http://127.0.0.1:${address.port}`,fetch,segments=>server.config.logger.info(`[local translation] request #${++requests}: ${segments} segments (no text logged)`))(request,response)
    })
  }}
}
