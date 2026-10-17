/** Importers normalize into inert data; original XHTML is never mounted. */
export interface TextMark { start: number; end: number; kind: 'strong' | 'em' | 'code' }
export interface ReadingBlock {
  kind: 'paragraph' | 'heading' | 'quote' | 'pre' | 'image'
  text: string
  marks?: TextMark[]
  level?: number
  resourceId?: string
  alt?: string
}
export interface Chapter {
  id: string
  title: string
  order: number
  paragraphs: string[]
  /** EPUB only: aligns one-to-one with paragraphs; images use an object character. */
  blocks?: ReadingBlock[]
}
export interface BookResource { id: string; blob: Blob }
export interface BookTocEntry { id: string; title: string; chapterId: string; paragraph: number; offset: number; depth: number }
export interface Book {
  schemaVersion: 1
  id: string
  title: string
  author: string
  source: 'sample' | 'txt' | 'epub'
  language?: string
  originalFileName?: string
  encoding?: string
  importedAt: string
  palette: 'mist' | 'moon' | 'forest'
  genre: string
  demoProgress?: number
  chapters: Chapter[]
  toc?: BookTocEntry[]
  coverResourceId?: string
  resources?: BookResource[]
  importWarnings?: string[]
  importBytes?: number
}
