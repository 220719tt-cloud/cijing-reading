import {useEffect,useMemo,useRef,useState} from 'react'
import type {Book} from '../../../shared/types/book'
import type {ChapterTranslation} from '../types'
import {translationEndpoint} from './protocol.ts'
import {translationError} from '../storage.ts'
import {translateChapter,missingSegments,overlapsFailure} from './engine.ts'
import type {AutoProgress,AutoOptions} from './engine.ts'
import {translationCoverage} from '../package.ts'
export function useAutoTranslation({book,index,high,loading,error,translation,onUpdate,paragraph,offset,serviceUrl,onReload,schedule}:{schedule?:AutoOptions['schedule'];onReload?:()=>void;serviceUrl?:string;book:Book;index:number;high:boolean;loading:boolean;error:string;translation:ChapterTranslation|undefined;onUpdate:(value:ChapterTranslation)=>void;paragraph:number;offset:number}){
  let endpoint='',configurationError=''
  try{
    const configured=serviceUrl??(import.meta.env?.DEV&&import.meta.env?.VITE_TRANSLATION_DEV_RELAY?`${window.location.origin}/__dev/translate`:import.meta.env?.VITE_TRANSLATION_API_URL)
    endpoint=translationEndpoint(configured,import.meta.env?.DEV)
  }catch{configurationError='翻译服务地址配置错误，请联系网站管理员。'}
  const key=endpoint?`cijing-cloud-consent:${new URL(endpoint).origin}`:''
  const [consent,setConsent]=useState(()=>{try{return !!key&&localStorage.getItem(key)==='allowed'}catch{return false}})
  const [state,setState]=useState<'idle'|'running'|'error'|'complete'|'finished'|'paused'>('idle'),[message,setMessage]=useState('')
  const [progress,setProgress]=useState<AutoProgress>({done:0,total:0,percent:0}),[revision,setRevision]=useState(0),[paused,setPaused]=useState(false),[retryFailed,setRetryFailed]=useState(false)
  const controller=useRef<AbortController|null>(null),job=useRef<Promise<unknown>>(Promise.resolve()),actionVersion=useRef(0),current=useRef({paragraph,offset,onUpdate,translation,onReload})
  current.current={paragraph,offset,onUpdate,translation,onReload}
  useEffect(()=>{actionVersion.current++;setPaused(false);setRetryFailed(false);setState('idle');setMessage('');setProgress({done:0,total:0,percent:0});return()=>{actionVersion.current++}},[book.id,index,high])
  useEffect(()=>{
    if(!high||loading||error||!endpoint||!consent||paused)return
    const control=new AbortController();controller.current=control;let active=true
    if(current.current.translation?.status==='complete'){setState('complete');setMessage('本章直接使用已缓存译文，无需重新翻译。');return()=>{active=false;control.abort()}}
    setState('running');setMessage('正在翻译当前章节；未完成范围仍可阅读原文。')
    const task=translateChapter(book,index,{endpoint,signal:control.signal,retryFailures:retryFailed,schedule,paragraph:current.current.paragraph,offset:current.current.offset,onUpdate:value=>{if(active)current.current.onUpdate(value)},onProgress:value=>{if(active)setProgress(value)}})
    job.current=task
    void task.then(value=>{if(active){const partial=value?.status==='partial';setState(partial?'finished':'complete');setMessage(partial?`本章自动处理结束：成功缓存 ${value.segments.length} 个句组，跳过 ${value.failures?.length??0} 个，译文覆盖率 ${translationCoverage(book.chapters[index],value.segments).percent}%。跳过内容保留中文，不自动重试；成功缓存不会重发。`:value?'本章译文已保存，切换浓度无需重新翻译。':'本章没有需要翻译的文字，原有图片照常显示。')}}).catch(reason=>{if(active&&!control.signal.aborted){setState('error');setMessage(translationError(reason))}})
    return()=>{active=false;control.abort()}
  },[book,index,high,loading,error,endpoint,consent,paused,revision,retryFailed,schedule])
  async function stop(){const version=++actionVersion.current;setPaused(true);controller.current?.abort();await job.current.catch(()=>{});if(version!==actionVersion.current)return;setState('paused');setMessage('翻译已暂停，已保存的译文仍可使用；继续时只补齐缺少的内容。')}
  function enable(){actionVersion.current++;try{localStorage.setItem(key,'allowed')}catch{/* Consent remains valid only in this tab. */}setPaused(false);setConsent(true);setRevision(value=>value+1)}
  function revoke(){try{localStorage.removeItem(key)}catch{/* In-memory opt-out still applies. */}setConsent(false);void stop()}
  function retry(){actionVersion.current++;current.current.onReload?.();setRetryFailed(true);setPaused(false);setRevision(n=>n+1)}
  function skipAndContinue(){actionVersion.current++;current.current.onReload?.();setRetryFailed(false);setPaused(false);setRevision(n=>n+1)}
  const cached=!loading&&!error&&translation?.status==='complete'
  const cachedProgress=useMemo(()=>{
    if(loading||error||!translation)return undefined
    const value=translationCoverage(book.chapters[index],translation.segments)
    const missing=missingSegments(book,index,translation)
    const pending=missing.filter(s=>!translation.failures?.some(f=>overlapsFailure(s.source,f))).length,skipped=missing.length-pending,processed=translation.segments.length+skipped
    return {done:value.covered,total:value.total,percent:value.percent,succeeded:translation.segments.length,remaining:missing.length,failed:translation.failures?.length??0,pending,skipped,processed,processedPercent:pending?Math.min(99,Math.round(processed/Math.max(1,translation.segments.length+missing.length)*100)):100}
  },[loading,error,book,index,translation])
  const status=error?`译文缓存读取失败：${error} 可重试读取，或在译文管理中删除损坏缓存。`:cached?'本章译文已完整缓存，可离线阅读；切换浓度无需再次翻译或授权。':!endpoint?(configurationError||'尚未配置自动翻译服务，请管理员按部署说明设置Worker地址。'):!consent?'自动翻译需要把当前章节及必要上下文发送给Cloudflare；原书与译文缓存仍保存在本机。':message
  return {endpoint,consent,cached,state:error&&high?'error' as const:cached&&!paused?'complete' as const:state,progress:{...progress,...cachedProgress},failures:translation?.failures??[],status,enable,revoke,retry,skipAndContinue,stop}
}
