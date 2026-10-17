import { useState } from 'react'
import type { Book } from '../shared/types/book'
import { ImportPanel } from '../features/importing/ImportPanel'
import { storageError } from '../shared/storage/books'
import { BookCover } from '../features/reading/BookCover'
import { sampleBooks } from '../features/reading/sampleBooks'
import { Icon } from '../shared/components/Icon'

export function HomePage({ books, loading, loadError, onRetry, onSave, onDelete }: {
  books: Book[]; loading: boolean; loadError: string; onRetry: () => Promise<void>;
  onSave: (book: Book) => Promise<void>; onDelete: (id: string) => Promise<void>;
}) {
  const [importOpen, setImportOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  async function confirmDelete(id: string) {
    setDeleting(true); setError('')
    try { await onDelete(id); setPendingDelete(null) }
    catch (err) { setError(storageError(err)) }
    finally { setDeleting(false) }
  }
  const featured = sampleBooks[0]
  return <div className="shelf-page">
    <section className="welcome">
      <p className="eyebrow">把日常，读成故事</p>
      <h2>留一点时间，<br />给下一页。</h2>
      <p className="muted">在故事里，自然学英语</p>
      <span aria-hidden="true" className="welcome-orbit" />
    </section>
    <section aria-labelledby="continue-title" className="continue-section">
      <div className="section-heading"><h2 id="continue-title">继续阅读</h2><span className="micro">示例书架</span></div>
      <a className="continue-card" href={`#/read/${featured.id}`}>
        <BookCover book={featured} small />
        <div className="continue-copy"><span className="eyebrow">让故事继续</span><h3>{featured.title}</h3><p className="muted">{featured.chapters[0]?.title}</p><span className="continue-action">打开故事 <Icon name="arrow" size={17} /></span></div>
      </a>
    </section>
    <section className="books-section" aria-labelledby="books-title">
      <div className="section-heading"><h2 id="books-title">我的书架 <span className="book-count">{String(books.length).padStart(2, '0')}</span></h2><button className="primary-button import-trigger" onClick={() => setImportOpen(true)} disabled={loading}>＋ 导入小说</button></div>
      {loading && <p role="status" className="muted">正在读取本地书架…</p>}
      {loadError && <div role="alert" className="error-message">{loadError}<button className="text-button" onClick={() => void onRetry()}>重试</button></div>}
      {error && <p role="alert" className="error-message">{error}</p>}
      <div className="book-grid">{books.map(book => <div key={book.id} className="book-item">
        <a href={`#/read/${book.id}`} aria-label={`阅读《${book.title}》`}>
          <BookCover book={book} />
          <h3>{book.title}</h3><p className="book-author">{book.author} · {book.source === 'sample' ? book.genre.split(' · ')[0] : book.source.toUpperCase()}</p>
          <div className="progress-track" aria-hidden="true"><span style={{ width: `${book.demoProgress ?? 0}%` }} /></div>
          <p className="progress-label">{book.source === 'sample' ? (book.demoProgress ? `已读 ${book.demoProgress}%` : '尚未开始') : '已保存到本机'}</p>
        </a>
        {book.source !== 'sample' && (pendingDelete === book.id ? <div className="delete-confirm"><p>从本机删除此书？</p><button className="text-button" disabled={deleting} onClick={() => void confirmDelete(book.id)}>{deleting ? '删除中…' : '确认删除'}</button><button className="text-button" disabled={deleting} onClick={() => setPendingDelete(null)}>取消</button></div> : <button className="text-button delete-button" onClick={() => { setPendingDelete(book.id); setError('') }} aria-label={`删除《${book.title}》`}>删除</button>)}
      </div>)}</div>
      <p className="sample-note">三本原创示例小说 · 阅读进度为演示数据</p>
    </section>
    {importOpen && <ImportPanel onSave={onSave} onClose={() => setImportOpen(false)} />}
    <p className="shelf-footer">小说仅保存在当前浏览器，不会上传。清理网站数据会丢失本地书库，请保留原文件。<br /><a href="#/settings">查看本地数据说明</a></p>
  </div>
}
