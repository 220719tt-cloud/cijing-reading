import { deleteBookTranslations } from '../features/translation/storage'
import { matchesPreference } from '../shared/browser/compatibility'
import { lazy, Suspense, useEffect, useState } from 'react'
import { HomePage } from '../pages/HomePage'
import { ReaderPage } from '../pages/ReaderPage'
import { PlaceholderPage } from '../pages/PlaceholderPage'
import { sampleBooks } from '../features/reading/sampleBooks'
import { Icon } from '../shared/components/Icon'
import type { IconName } from '../shared/components/Icon'

import type { Book } from '../shared/types/book'
import { listBooks, saveBook, deleteBook, storageError } from '../shared/storage/books'

const VocabularyPage = lazy(() => import('../pages/VocabularyPage').then(module => ({ default: module.VocabularyPage })))

type Theme = 'light' | 'dark'
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('cijing-theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* Storage may be unavailable in restricted browser contexts. */ }
  return matchesPreference('(prefers-color-scheme: dark)') ? 'dark' : 'light'
}
const navigation: { id: string; label: string; icon: IconName }[] = [
  { id: 'books', label: '书架', icon: 'book' },
  { id: 'words', label: '生词本', icon: 'words' },
  { id: 'settings', label: '设置', icon: 'settings' },
]

export function App() {
  const [route, setRoute] = useState(window.location.hash || '#/books')
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [importedBooks, setImportedBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [themeWarning, setThemeWarning] = useState('')
  async function loadLibrary() {
    setLoading(true); setLoadError('')
    try { setImportedBooks(await listBooks()) } catch (error) { setLoadError(storageError(error)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void loadLibrary() }, [])
  async function addBook(book: Book) {
    await saveBook(book)
    setImportedBooks(previous => [book, ...previous])
  }
  async function removeBook(id: string) {
    // Clear only this book's derived data; never clear the shared learning database.
    await deleteBookTranslations(id)
    await deleteBook(id)
    setImportedBooks(previous => previous.filter(book => book.id !== id))
  }
  const books = [...importedBooks, ...sampleBooks]
  const book = books.find(item => route === `#/read/${item.id}`)
  const page = route === '#/words' ? 'words' : route === '#/settings' ? 'settings' : 'books'

  useEffect(() => {
    const onHashChange = () => { setRoute(window.location.hash || '#/books'); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#18221f' : '#f7f6f0')
    try { localStorage.setItem('cijing-theme', theme); setThemeWarning('') }
    catch { setThemeWarning('浏览器无法保存主题，当前切换仍有效；刷新后可能恢复默认主题。') }
  }, [theme])
  useEffect(() => { document.title = book ? `${book.title} · 词境阅读` : '词境阅读' }, [book])

  if (book) return <ReaderPage key={book.id} book={book} theme={theme} />

  return <div className="app-shell">
    <header className="app-header">
      {book ? <a href="#/books" className="back-link"><Icon name="back" size={20} />书架</a> : <a className="brand" href="#/books"><span className="brand-symbol"><Icon name="book" size={20} /></span>词境阅读<span className="brand-dot">.</span></a>}
      {book && <span className="reader-header-title">词境阅读</span>}
      <button className="theme-button" type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'} title={theme === 'light' ? '切换深色主题' : '切换浅色主题'}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={21} /></button>
    </header>
    <main>{themeWarning && <p role="alert" className="error-message">{themeWarning}</p>}{page === 'books' ? <HomePage books={books} loading={loading} loadError={loadError} onRetry={loadLibrary} onSave={addBook} onDelete={removeBook} /> : page === 'words' ? <Suspense fallback={<p role="status" className="muted">正在打开本地词库…</p>}><VocabularyPage /></Suspense> : <PlaceholderPage page={page} onRestored={()=>{void loadLibrary();setTheme(initialTheme())}} />}</main>
    <nav className="bottom-nav" aria-label="主导航">{navigation.map(item => <a key={item.id} href={`#/${item.id}`} className={`nav-item ${page === item.id ? 'is-active' : ''}`} aria-current={!book && page === item.id ? 'page' : undefined}><Icon name={item.icon} size={22} /><span>{item.label}</span></a>)}</nav>
  </div>
}
