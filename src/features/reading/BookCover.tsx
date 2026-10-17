import { useMemo, useState } from 'react'
import { useResourceUrls } from './resourceUrls'
import type { Book } from '../../shared/types/book'

export function BookCover({ book, small = false }: { book: Book; small?: boolean }) {
  const resources=useMemo(()=>book.resources?.filter(resource=>resource.id===book.coverResourceId),[book.resources,book.coverResourceId])
  const urls=useResourceUrls(resources)
  const [failed,setFailed]=useState(false)
  if(book.coverResourceId && urls[book.coverResourceId] && !failed) return <div aria-hidden="true" className={`book-cover epub-cover${small ? ' cover-small' : ''}`}><img src={urls[book.coverResourceId]} alt="" onError={()=>setFailed(true)} /></div>
  return <div aria-hidden="true" className={`book-cover cover-${book.palette}${small ? ' cover-small' : ''}`}>
    <span className="cover-edition">{book.source === 'sample' ? '词境 · 原创故事' : '词境 · 我的藏书'}</span>
    <span className="cover-title">{book.title}</span>
    <span className="cover-art"><i /><i /><i /></span>
    <span className="cover-author">{book.source === 'sample' ? `${book.author} 著` : `${book.source.toUpperCase()} · 本地`}</span>
  </div>
}
