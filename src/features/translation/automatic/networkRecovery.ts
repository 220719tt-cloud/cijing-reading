import {TranslationRequestError} from './errors.ts'
import {abortableDelay} from './scheduler.ts'

// Shared across the whole chapter pass, never reset for each failed batch.
export const NETWORK_POLICY={retries:2,probeDelays:[3000,8000,15000],probeTimeout:5000}
export const transportFailure=(error:unknown):error is TranslationRequestError=>error instanceof TranslationRequestError&&['NETWORK_ERROR','REQUEST_TIMEOUT'].includes(error.code)

/** The existing OPTIONS route returns before rate limiting or AI inference. */
export async function probeTranslationConnection(endpoint:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<boolean>{
  const controller=new AbortController(),cancel=()=>controller.abort()
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)controller.abort()
  const timeout=setTimeout(cancel,NETWORK_POLICY.probeTimeout)
  try{
    if(signal.aborted)throw new DOMException('翻译已停止。','AbortError')
    const response=await fetcher(endpoint,{method:'OPTIONS',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal})
    await response.body?.cancel()
    if(signal.aborted)throw new DOMException('翻译已停止。','AbortError')
    if(controller.signal.aborted)return false
    if([403,429,503].includes(response.status))throw new TranslationRequestError(`HTTP_${response.status}`,'连接检查被服务拒绝或服务暂不可用，已暂停；未完成内容和成功缓存均保留。',response.status)
    return response.status===204
  }catch(error){
    if(signal.aborted)throw new DOMException('翻译已停止。','AbortError')
    if(error instanceof TranslationRequestError)throw error
    return false
  }finally{clearTimeout(timeout);signal.removeEventListener('abort',cancel)}
}
export interface NetworkRecoveryOptions {
  probe?:typeof probeTranslationConnection
  delay?:typeof abortableDelay
}
export function createNetworkRecovery(endpoint:string,signal:AbortSignal,options:NetworkRecoveryOptions={}){
  let probes=0,retries=0
  return {
    get retries(){return retries},
    get probes(){return probes},
    async recover(onWait:(ms:number)=>void){
      if(retries>=NETWORK_POLICY.retries)return false
      while(probes<NETWORK_POLICY.probeDelays.length){
        const delay=NETWORK_POLICY.probeDelays[probes++];onWait(delay)
        await (options.delay??abortableDelay)(delay,signal)
        if(signal.aborted)throw new DOMException('翻译已停止。','AbortError')
        if(await (options.probe??probeTranslationConnection)(endpoint,signal)){retries++;return true}
      }
      return false
    },
  }
}
