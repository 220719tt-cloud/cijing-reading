import type { Chapter } from '../../shared/types/book'
export interface ReadingPosition { chapterId: string; paragraph: number; offset: number; rendition?: { fingerprint: string; offset: number } }
export function chapterText(chapter: Chapter) { return chapter.paragraphs.join('\n\n') }
export function positionToOffset(chapter: Chapter, position: ReadingPosition) {
  const paragraph = Math.max(0, Math.min(chapter.paragraphs.length - 1, position.paragraph))
  const prefix = chapter.paragraphs.slice(0, paragraph).reduce((sum, text) => sum + text.length + 2, 0)
  return prefix + Math.max(0, Math.min(chapter.paragraphs[paragraph]?.length ?? 0, position.offset))
}
export function offsetToPosition(chapter: Chapter, offset: number): ReadingPosition {
  let remaining = Math.max(0, offset)
  for (let paragraph = 0; paragraph < chapter.paragraphs.length; paragraph++) {
    const length = chapter.paragraphs[paragraph].length
    if (remaining <= length || paragraph === chapter.paragraphs.length - 1) return { chapterId: chapter.id, paragraph, offset: Math.min(remaining, length) }
    remaining = Math.max(0, remaining - length - 2)
  }
  return { chapterId: chapter.id, paragraph: 0, offset: 0 }
}
export function pageForOffset(starts: number[], offset: number) {
  let page = 0
  for (let index = 1; index < starts.length && starts[index] <= offset; index++) page = index
  return page
}
export function loadPosition(bookId: string, chapters: Chapter[]): ReadingPosition {
  try {
    const saved = JSON.parse(localStorage.getItem(`cijing-position:${bookId}`) ?? 'null') as ReadingPosition | null
    if (saved && chapters.some(chapter => chapter.id === saved.chapterId) && Number.isInteger(saved.paragraph) && Number.isInteger(saved.offset) && saved.paragraph >= 0 && saved.offset >= 0) return saved
  } catch { /* Use the beginning when storage is unavailable or corrupt. */ }
  return { chapterId: chapters[0]?.id ?? '', paragraph: 0, offset: 0 }
}
export function loadFontSize() {
  try { const size = Number(localStorage.getItem('cijing-font-size')); if (Number.isFinite(size) && size >= 14 && size <= 32) return size } catch { /* Use default. */ }
  return 18
}
