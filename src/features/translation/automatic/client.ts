import type {BatchRequest,BatchResult} from './protocol'
import {AUTO_LIMITS,boundedJson} from './protocol.ts'
import {validateAvailableResult} from './availableResult.ts'
import {checkedModelReason,modelErrors,modelOutputReasons,TranslationRequestError} from './errors.ts'

/** Exactly ONE wire request. A failed source is never automatically requested again. */
export async function requestTranslation(endpoint:string,batch:BatchRequest,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<BatchResult>{
  if(new TextEncoder().encode(JSON.stringify(batch)).length>AUTO_LIMITS.requestBytes)throw new TranslationRequestError('REQUEST_TOO_LARGE','请求内容过大，请缩小人物术语表或章节批次。')
  const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true})
  if(signal.aborted)controller.abort()
  const timeout=setTimeout(()=>controller.abort(),65000)
  try{
    if(controller.signal.aborted)throw new DOMException('翻译已停止。','AbortError')
    const response=await fetcher(endpoint,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify(batch),signal:controller.signal})
    if(!response.ok){
      if(response.status===502||response.status===504){
        let code:unknown,reason:string|undefined
        try{const body=await boundedJson(response.body,2048);if(body&&typeof body==='object'&&!Array.isArray(body)){code=(body as Record<string,unknown>).code;reason=checkedModelReason((body as Record<string,unknown>).reason)}}catch{/* Old Workers retain a generic error. */}
        if(code==='REQUEST_TIMEOUT')throw new TranslationRequestError('REQUEST_TIMEOUT','本机转发请求超时，未确认的内容仍待翻译。',response.status)
        if(code==='NETWORK_ERROR')throw new TranslationRequestError('NETWORK_ERROR','本机转发暂时无法连接云端，任务已暂停；成功缓存与跳过记录保留。',502)
        if(typeof code==='string'&&Object.hasOwn(modelErrors,code))throw new TranslationRequestError(code,`翻译失败：${modelErrors[code]}${reason?modelOutputReasons[reason]+'。':''}已保存部分保留。（${code}）`,502,0,reason)
      }
      const messages:Record<number,string>={400:'翻译段落超出服务限制。',403:'服务未允许此网站，请检查Worker的ALLOWED_ORIGINS。',429:'翻译请求过于频繁，已停止自动请求；请冷却后继续。',502:'模型译文不完整，请重试。',503:'服务未启用、暂不可用或免费额度不足，请稍后重试。',504:'翻译请求超时，已保存部分保留。'}
      const seconds=Number(response.headers.get('Retry-After'))
      throw new TranslationRequestError(`HTTP_${response.status}`,messages[response.status]??`翻译服务错误（${response.status}）。`,response.status,response.status===429?Math.min(3600,Math.max(60,Number.isFinite(seconds)?seconds:60)):0)
    }
    let decoded:unknown
    try{decoded=await boundedJson(response.body,AUTO_LIMITS.outputBytes)}catch(error){
      if(controller.signal.aborted)throw error
      throw new TranslationRequestError(error instanceof SyntaxError?'MODEL_JSON_INVALID':'MODEL_OUTPUT_INVALID','响应 JSON 损坏、过大或不完整，未保存此批译文。')
    }
    try{return validateAvailableResult(decoded,batch)}catch{throw new TranslationRequestError('MODEL_ALIGNMENT_INVALID',modelErrors.MODEL_ALIGNMENT_INVALID)}
  }catch(error){
    if(signal.aborted)throw new DOMException('翻译已停止。','AbortError')
    if(controller.signal.aborted)throw new TranslationRequestError('REQUEST_TIMEOUT','翻译请求超时，已保存部分保留，可重试。')
    if(error instanceof TypeError)throw new TranslationRequestError('NETWORK_ERROR','无法连接翻译服务，请检查网络、服务地址和CORS设置。')
    throw error
  }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort)}
}
