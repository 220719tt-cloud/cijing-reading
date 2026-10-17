import {useEffect,useRef,useState} from 'react'
import type {Book} from '../../../shared/types/book'
import type {ChapterTranslation} from '../types'
import {translationEndpoint} from './protocol.ts'
import {translationError} from '../storage.ts'
import {translateChapter} from './engine.ts'
import type {AutoProgress} from './engine.ts'
export function useAutoTranslation({book,index,high,loading,error,translation,onUpdate,paragraph,offset,serviceUrl,onReload}:{onReload?:()=>void;serviceUrl?:string;book:Book;index:number;high:boolean;loading:boolean;error:string;translation:ChapterTranslation|undefined;onUpdate:(value:ChapterTranslation)=>void;paragraph:number;offset:number}){
  let endpoint='',configurationError=''
  try{endpoint=translationEndpoint(serviceUrl??import.meta.env?.VITE_TRANSLATION_API_URL,import.meta.env?.DEV)}catch{configurationError='翻译服务地址配置错误，请联系网站管理员。'}
  const key=endpoint?`cijing-cloud-consent:${new URL(endpoint).origin}`:''
  const [consent,setConsent]=useState(()=>{try{return !!key&&localStorage.getItem(key)==='allowed'}catch{return false}})
  const [state,setState]=useState<'idle'|'running'|'error'|'complete'|'paused'>('idle'),[message,setMessage]=useState('')
  const [progress,setProgress]=useState<AutoProgress>({done:0,total:0,percent:0}),[revision,setRevision]=useState(0),[paused,setPaused]=useState(false)
  const controller=useRef<AbortController|null>(null),job=useRef<Promise<unknown>>(Promise.resolve()),current=useRef({paragraph,offset,onUpdate,translation,onReload})
  current.current={paragraph,offset,onUpdate,translation,onReload}
  useEffect(()=>{setPaused(false);setState('idle');setMessage('');setProgress({done:0,total:0,percent:0})},[book.id,index,high])
  useEffect(()=>{
    if(!high||loading||error||!endpoint||!consent||paused)return
    const control=new AbortController();controller.current=control;let active=true
    if(current.current.translation?.status==='complete'){setState('complete');setMessage('本章直接使用已缓存译文，无需重新翻译。');return()=>{active=false;control.abort()}}
    setState('running');setMessage('正在翻译当前章节；未完成范围仍可阅读原文。')
    const task=translateChapter(book,index,{endpoint,signal:control.signal,paragraph:current.current.paragraph,offset:current.current.offset,onUpdate:value=>{if(active)current.current.onUpdate(value)},onProgress:value=>{if(active)setProgress(value)}})
    job.current=task
    void task.then(()=>{if(active){setState('complete');setMessage('本章译文已保存，切换浓度无需重新翻译。')}}).catch(reason=>{if(active&&!control.signal.aborted){setState('error');setMessage(translationError(reason))}})
    return()=>{active=false;control.abort()}
  },[book,index,high,loading,error,endpoint,consent,paused,revision])
  async function stop(){setPaused(true);controller.current?.abort();await job.current.catch(()=>{});setState('paused');setMessage('自动翻译已停止，已保存的译文仍可使用。')}
  function enable(){try{localStorage.setItem(key,'allowed')}catch{/* Consent remains valid only in this tab. */}setConsent(true)}
  function revoke(){try{localStorage.removeItem(key)}catch{/* In-memory opt-out still applies. */}setConsent(false);void stop()}
  function retry(){current.current.onReload?.();setPaused(false);setRevision(n=>n+1)}
  const status=error?`译文缓存读取失败：${error} 可重试读取，或在译文管理中删除损坏缓存。`:!endpoint?(configurationError||'尚未配置自动翻译服务，请管理员按部署说明设置Worker地址。'):!consent?'自动翻译需要把当前章节及必要上下文发送给Cloudflare；原书与译文缓存仍保存在本机。':message
  return {endpoint,consent,state:error&&high?'error' as const:state,progress,status,enable,revoke,retry,stop}
}
