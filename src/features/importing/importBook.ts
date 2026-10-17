import type { BookImporter, ImportOptions } from './types'
import { txtImporter } from './txtImporter.ts'
const importers: BookImporter[] = [txtImporter]
export async function importBook(file: File, options?: ImportOptions) {
  if (/\.epub$/i.test(file.name)) return (await import('./epubImporter.ts')).epubImporter.parse(file, options)
  const importer = importers.find(item => item.accepts(file))
  if (!importer) throw new Error('请选择 TXT 或 EPUB 小说文件。')
  return importer.parse(file, options)
}
