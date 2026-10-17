import { useEffect, useRef, useState } from 'react'
import type { Book } from '../../shared/types/book'
import type { TextEncoding } from './types'
import { importBook } from './importBook'
import { storageError } from '../../shared/storage/books'

export function ImportPanel({ onSave, onClose }: { onSave: (book: Book) => Promise<void>; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [encoding, setEncoding] = useState<TextEncoding>('auto')
  const [draft, setDraft] = useState<Book | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [progress, setProgress] = useState('')
  const [saving, setSaving] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => {
    if (!file) { setDraft(null); setParsing(false); return }
    let cancelled = false
    const controller=new AbortController()
    setParsing(true); setDraft(null); setError(''); setProgress('正在读取小说…')
    importBook(file, { encoding, signal:controller.signal, onProgress: message => { if (!cancelled) setProgress(message) } }).then(book => {
      if (!cancelled) { setDraft(book); setTitle(book.title.slice(0, 150)) }
    }).catch(err => { if (!cancelled) setError(storageError(err)) }).finally(() => { if (!cancelled) setParsing(false) })
    return () => { cancelled = true; controller.abort() }
  }, [file, encoding])
  async function submit() {
    if (!draft || !title.trim() || saving) return
    setSaving(true); setError('')
    try { await onSave({ ...draft, title: title.trim() }); onClose() }
    catch (err) { setError(storageError(err)); setSaving(false) }
  }
  return <dialog ref={dialog} className="import-dialog" aria-labelledby="import-title" onCancel={event => { event.preventDefault(); if (!saving) onClose() }}>
    <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <div className="section-heading"><h2 id="import-title">导入小说</h2><button type="button" className="text-button" onClick={onClose} disabled={saving}>关闭</button></div>
      <p className="muted">小说仅保存在当前浏览器。支持 TXT（UTF-8、GBK、GB18030，最大 15 MB）和 EPUB 2／3（最大 40 MB）。解析在本机完成。清理网站数据会丢失书库，请保留原文件。</p>
      <label className="field-label">选择小说文件<input type="file" accept=".txt,.epub,text/plain,application/epub+zip,application/zip" disabled={saving} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
      {(!file || /\.txt$/i.test(file.name)) && <label className="field-label">文字编码<select value={encoding} disabled={saving} onChange={event => setEncoding(event.target.value as TextEncoding)}><option value="auto">自动识别（优先 UTF-8）</option><option value="utf-8">UTF-8</option><option value="gb18030">GB18030</option><option value="gbk">GBK</option></select></label>}
      {parsing && <p role="status" className="muted">{progress}</p>}
      {draft && !parsing && <><label className="field-label">书名<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={150} disabled={saving} /></label><p className="muted">{draft.source === 'epub' ? `${draft.author} · ${draft.chapters.length} 个阅读分段 · ${draft.toc?.length ?? 0} 项目录` : `识别编码：${draft.encoding}`} · 确认内容后加入书架</p>{draft.importWarnings?.map(warning => <p key={warning} className="micro" role="status">{warning}</p>)}<div className="import-preview">{(draft.chapters[0]?.blocks?.map(block=>block.kind==='image'?'[正文插图]':block.text).join('\n') ?? draft.chapters[0]?.paragraphs.join('\n'))?.slice(0, 600)}</div></>}
      {error && <p role="alert" className="error-message">{error}</p>}
      <button type="submit" className="primary-button" disabled={!draft || parsing || saving || !title.trim()}>{saving ? '正在保存…' : '加入书架'}</button>
    </form>
  </dialog>
}
