import type { Book, Chapter } from '../../shared/types/book'

/** Inert, versioned translation data; no AI model is bundled. */
export interface SourceRange {
  paragraph: number
  /** Original UTF-16 offsets, never translated-text offsets. */
  start: number
  end: number
}
export interface TranslationIdentity {
  /** Hash of canonical source content, independent of a device-local book ID. */
  sourceHash: string
  sourceLanguage: string
  targetLanguage: string
  provider: string
  modelVersion: string
  configurationHash: string
  /** Include preceding context/glossary changes in cache invalidation. */
  contextHash: string
}
export interface TranslationSegment {
  id: string
  chapterId: string
  source: SourceRange
  sourceText: string
  targetText: string
}
export interface ChapterTranslation {
  schemaVersion: 1
  identity: TranslationIdentity
  chapterId: string
  /** Zero-based canonical chapter position; IDs can differ on another device. */
  chapterIndex: number
  chapterTitle: string
  status: 'partial' | 'complete'
  segments: TranslationSegment[]
  /** Model-discovered proper names; optional for old/manual packages. */
  glossary?: Record<string,string>
  updatedAt: string
}
export interface TranslationPackage {
  format: 'cijing-translations'
  schemaVersion: 1
  book: { sourceHash: string; title: string; chapterCount: number }
  chapters: ChapterTranslation[]
}
export interface TranslationRequest {
  identity: TranslationIdentity
  chapterId: string
  segments: ReadonlyArray<Omit<TranslationSegment, 'targetText'>>
  context?: string
  glossary?: Readonly<Record<string, string>>
}
export interface TranslationProvider {
  readonly id: string
  isAvailable(): Promise<boolean>
  translate(request: TranslationRequest, options: { signal?: AbortSignal }): Promise<ChapterTranslation>
}
export interface TranslationCache {
  get(book: Book, chapter: Chapter): Promise<ChapterTranslation | undefined>
  put(book: Book, translations: TranslationPackage): Promise<void>
}
export interface TranslationExchange {
  /** Must validate schema, size, source hashes/ranges and inert plain text before writing. */
  import(file: File, book: Book): Promise<TranslationPackage>
  export(translations: TranslationPackage): Blob
}
