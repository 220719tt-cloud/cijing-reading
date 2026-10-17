import type { Book } from '../../shared/types/book'
export type TextEncoding = 'auto' | 'utf-8' | 'gb18030' | 'gbk'
export interface ImportOptions { encoding?: TextEncoding; signal?: AbortSignal; onProgress?: (message: string) => void }
export interface BookImporter {
  format: 'txt' | 'epub'
  accepts(file: File): boolean
  parse(file: File, options?: ImportOptions): Promise<Book>
}
