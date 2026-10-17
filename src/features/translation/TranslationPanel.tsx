import { useEffect, useRef, useState } from 'react'
import type { Book } from '../../shared/types/book'
import type { TranslationPackage } from './types'
import { createTranslationTemplate, parseTranslationFile, translationBlob, translationCoverage } from './package'
import { exportCachedTranslations, saveTranslationPackage, translationError } from './storage'
function prepareDownload(value:TranslationPackage,name:string) {
  return {url:URL.createObjectURL(translationBlob(value)),name:name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,140)+'.json'}
}
export function TranslationPanel({book,chapterIndex,onClose,onSaved}:{book:Book;chapterIndex:number;onClose:()=>void;onSaved:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),generation=useRef(0)
  const [scope,setScope]=useState<'chapter'|'book'>('chapter')
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [draft,setDraft]=useState<TranslationPackage|null>(null)
  const [prepared,setPrepared]=useState<{url:string;name:string}|null>(null)
  useEffect(()=>()=>{if(prepared)setTimeout(()=>URL.revokeObjectURL(prepared.url),30000)},[prepared])
  useEffect(()=>{dialog.current?.showModal();return()=>{generation.current++}},[])
  async function exportFile(template:boolean) {
    setBusy(true);setError('');setNotice('');setPrepared(null)
    try {
      const indices=scope==='chapter'?[chapterIndex]:book.chapters.map((_,i)=>i)
      const value=template?await createTranslationTemplate(book,indices):await exportCachedTranslations(book,indices)
      setPrepared(prepareDownload(value,`${book.title}-${scope==='chapter'?`第${chapterIndex+1}章`:'全书'}-${template?'原文模板':'英文译文'}`))
      setNotice(template?'原文模板已准备，请点击下载链接保存。填写 targetText 后再导入，不要修改原文、范围或校验值。':'译文文件已准备，请点击下载链接保存；部分译文保留 partial 状态。')
    } catch(error){setError(translationError(error))} finally{setBusy(false)}
  }
  async function choose(file:File|undefined) {
    const token=++generation.current;setDraft(null);setError('');setNotice('');setPrepared(null)
    if(!file) return
    setBusy(true)
    try {const value=await parseTranslationFile(file,book);if(token===generation.current)setDraft(value)}
    catch(error){if(token===generation.current)setError(translationError(error))}
    finally{if(token===generation.current)setBusy(false)}
  }
  async function save() {
    if(!draft||busy) return
    setBusy(true);setError('')
    try {await saveTranslationPackage(book,draft);setNotice(`已保存 ${draft.chapters.length} 个章节的译文。原文没有修改。`);setDraft(null);onSaved()}
    catch(error){setError(translationError(error))} finally{setBusy(false)}
  }
  return <dialog ref={dialog} className="import-dialog translation-dialog" aria-labelledby="translation-title" onCancel={event=>{event.preventDefault();if(!busy)onClose()}}>
    <div className="section-heading"><h2 id="translation-title">译文管理</h2><button className="text-button" disabled={busy} onClick={onClose}>完成</button></div>
    <p className="muted">{book.title} · 本地英文译文，与小说原文分开保存。不连接翻译服务，也不会上传小说。</p>
    <label className="field-label">导出范围<select value={scope} disabled={busy} onChange={event=>setScope(event.target.value as 'chapter'|'book')}><option value="chapter">当前章节 · {book.chapters[chapterIndex].title}</option><option value="book">整本小说</option></select></label>
    <div className="translation-actions"><button className="primary-button" disabled={busy} onClick={()=>void exportFile(true)}>导出原文模板</button><button className="primary-button" disabled={busy} onClick={()=>void exportFile(false)}>导出已存译文</button></div>
    {prepared&&<p><a className="primary-button translation-download" href={prepared.url} download={prepared.name}>下载 JSON：{prepared.name}</a></p>}
    <label className="field-label">导入英文译文 JSON<input type="file" accept=".json,application/json" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void choose(file)}}/></label>
    <p className="micro">最大 20 MB。按章节、段落和原文范围校验；保存会替换包中涉及章节的旧译文，未涉及章节保持不变。建议先导出旧译文留存。</p>
    {busy&&<p role="status">正在处理本地译文…</p>}
    {draft&&<section className="translation-preview" aria-label="译文导入预览"><h3>确认对应关系</h3>{draft.chapters.map(item=>{const coverage=translationCoverage(book.chapters[item.chapterIndex],item.segments);return <p key={item.chapterIndex}>第 {item.chapterIndex+1} 章 · {item.chapterTitle}：{item.segments.length} 个句组，原文覆盖 {coverage.percent}% · {coverage.complete?'完整':'部分译文'}</p>})}<p>英文预览：{draft.chapters.flatMap(item=>item.segments)[0]?.targetText.slice(0,400)}</p><button className="primary-button" disabled={busy} onClick={()=>void save()}>保存译文到本机</button></section>}
    {notice&&<p role="status" className="english-notice">{notice}</p>}
    {error&&<p role="alert" className="error-message">{error}</p>}
    <p className="micro">校验能确认位置和结构，不能自动证明翻译忠实或流畅。请导入经过核对的英文，保留人名、对话和情节。当前没有自动 AI 翻译功能。</p>
  </dialog>
}
