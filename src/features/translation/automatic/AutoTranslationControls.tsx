import {useState} from 'react'
import type {useAutoTranslation} from './useAutoTranslation'
import {failureReasons,modelOutputReasons} from './errors'
export function AutoTranslationControls({auto}:{auto:ReturnType<typeof useAutoTranslation>}){
  const [visible,setVisible]=useState(50)
  return <section className="auto-translation-controls" aria-label="自动翻译">
    <p role="status" className="english-notice">{auto.status}</p>
    {(auto.state==='running'||auto.progress.total>0)&&<>
      <progress max="100" value={auto.progress.percent} aria-label="本章翻译进度"/>
      <p className="micro">已缓存 {auto.progress.percent}% 原文内容；不是当前英语显示比例。{auto.state==='running'?'页面可继续阅读，离开章节会停止后续请求。':'已有译文可离线使用。'}</p>
      <p className="micro" role="status">已缓存 {auto.progress.succeeded??0} 个句组 · 尚无译文 {auto.progress.remaining??((auto.progress.failed??0)+(auto.progress.pending??0))} 个（已跳过 {auto.progress.skipped??auto.progress.failed??0} 个、待处理 {auto.progress.pending??0} 个）。本次调用 {auto.progress.requests??0}{auto.progress.requestLimit?` / ${auto.progress.requestLimit}`:''} 次。</p>
      <p className="micro" role="status">本章已处理 {auto.progress.processedPercent??0}% · 成功缓存 {auto.progress.succeeded??0} 个 · 已跳过 {auto.progress.skipped??auto.progress.failed??0} 个 · 待处理 {auto.progress.pending??0} 个。译文覆盖率 {auto.progress.percent}%（按对应原文内容计算，含先前缓存）。</p>
    </>}
    {(auto.progress.modelFailures??0)>0&&<p className="micro" role="status">本次请求异常／部分结果未通过校验 {auto.progress.modelFailures} 次，最近：{auto.progress.lastModelError}{auto.progress.lastModelReason?`（${modelOutputReasons[auto.progress.lastModelReason]}）`:''}。未确认的句组已跳过，不自动重试或拆批重发；其他句组继续。</p>}
    {auto.state==='running'&&auto.progress.stage==='waiting'&&<p className="micro" role="status">正在等待安全调用间隔或限流冷却（约 {auto.progress.waitSeconds} 秒）；成功缓存不会重复请求。</p>}
    {auto.state==='running'&&auto.progress.stage==='reconnecting'&&<p className="micro" role="status">连接中断，正在有限恢复（连接探测 {auto.progress.networkProbes??0} / 3，恢复重试 {auto.progress.networkRetries??0} / 2）。探测不调用 AI，成功缓存与未完成队列均保留；仍可暂停。</p>}
    {auto.failures.length>0&&<details><summary>查看 {auto.failures.length} 个已跳过句组（保留中文）</summary>
      <ol>{auto.failures.slice(0,visible).map(f=><li key={`${f.source.paragraph}:${f.source.start}:${f.source.end}`}>
        第 {f.source.paragraph+1} 段，原文位置 {f.source.start}–{f.source.end}：{failureReasons[f.code]}{f.reason?` ${modelOutputReasons[f.reason]}。`:''}（{f.code}，直接尝试 {f.attempts} 次）
      </li>)}</ol>
      {auto.failures.length>visible&&<button className="text-button" onClick={()=>setVisible(n=>n+50)}>查看更多失败记录</button>}
    </details>}
    {auto.state==='running'&&<button className="text-button" onClick={()=>void auto.stop()}>暂停翻译</button>}
    {auto.endpoint&&!auto.consent&&!auto.cached&&<button className="primary-button" onClick={auto.enable}>允许云翻译并开始本章</button>}
    {auto.endpoint&&auto.consent&&['error','paused'].includes(auto.state)&&!auto.cached&&<>
      {(auto.progress.pending??0)>0&&<button className="primary-button" onClick={auto.skipAndContinue}>继续翻译本章</button>}
    </>}
    {auto.endpoint&&auto.consent&&auto.state!=='running'&&!auto.cached&&auto.failures.length>0&&<button className="text-button" onClick={auto.retry}>重试翻译本章</button>}
    {auto.failures.length>0&&<p className="micro">跳过内容不影响继续阅读，也不会自动重新请求；只有主动点击「重试翻译本章」才补翻这些缺口。</p>}
    {auto.consent&&<button className="text-button" onClick={auto.revoke}>关闭自动云翻译</button>}
  </section>
}
