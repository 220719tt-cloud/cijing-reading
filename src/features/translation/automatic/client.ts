import type {BatchRequest,BatchResult} from './protocol'
import {AUTO_LIMITS,boundedJson,validateBatchResult} from './protocol.ts'
export async function requestTranslation(endpoint:string,batch:BatchRequest,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<BatchResult>{
  if(new TextEncoder().encode(JSON.stringify(batch)).length>AUTO_LIMITS.requestBytes)throw new Error('请求内容过大，请缩小人物术语表或章节批次。')
  const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true})
  if(signal.aborted)controller.abort()
  const timeout=setTimeout(()=>controller.abort(),65000)
  try{
    const response=await fetcher(endpoint,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify(batch),signal:controller.signal})
    if(!response.ok){const messages:Record<number,string>={400:'翻译段落超出服务限制。',403:'服务未允许此网站，请检查Worker的ALLOWED_ORIGINS。',429:'翻译请求过于频繁，请一分钟后重试。',502:'模型译文不完整，请重试。',503:'服务未启用、暂不可用或免费额度不足，请稍后重试。'};throw new Error(messages[response.status]??`翻译服务错误（${response.status}）。`)}
    return validateBatchResult(await boundedJson(response.body,AUTO_LIMITS.outputBytes),batch)
  }catch(error){if(signal.aborted)throw new DOMException('翻译已停止。','AbortError');if(controller.signal.aborted)throw new Error('翻译请求超时，已保存部分保留，可重试。');if(error instanceof TypeError)throw new Error('无法连接翻译服务，请检查网络、服务地址和CORS设置。');throw error}
  finally{clearTimeout(timeout);signal.removeEventListener('abort',abort)}
}
