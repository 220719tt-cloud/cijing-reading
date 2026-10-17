import type {useAutoTranslation} from './useAutoTranslation'
export function AutoTranslationControls({auto}:{auto:ReturnType<typeof useAutoTranslation>}){
  return <section className="auto-translation-controls" aria-label="自动翻译">
    <p role="status" className="english-notice">{auto.status}</p>
    {auto.state==='running'&&<><progress max="100" value={auto.progress.percent} aria-label="本章翻译进度"/><p className="micro">已缓存 {auto.progress.percent}% 原文内容；不是当前英语显示比例。页面可继续阅读，离开章节会停止后续请求。</p><button className="text-button" onClick={()=>void auto.stop()}>停止翻译</button></>}
    {auto.endpoint&&!auto.consent&&<button className="primary-button" onClick={auto.enable}>允许云翻译并开始本章</button>}
    {auto.endpoint&&auto.consent&&['error','paused'].includes(auto.state)&&<button className="primary-button" onClick={auto.retry}>重试／继续翻译本章</button>}
    {auto.consent&&<button className="text-button" onClick={auto.revoke}>关闭自动云翻译</button>}
  </section>
}
