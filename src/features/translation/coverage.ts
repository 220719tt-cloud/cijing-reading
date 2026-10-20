import type { Chapter } from '../../shared/types/book'
import type { DisplayText } from '../replacement/displayText'
import {sectionMarkerRanges} from './neutral.ts'

/** Count source letters (including Han), never English length or probability.
 * Spaces, punctuation, digits, images, headings and preformatted blocks are neutral.
 * Offsets stay UTF-16; a supplementary Unicode letter contributes one unit.
 */
export function sourceCoverage(chapter: Chapter) {
  const original = chapter.paragraphs.join('\n\n')
  const prefix = new Uint32Array(original.length + 1)
  let start = 0, total = 0
  chapter.paragraphs.forEach((text, index) => {
    const readable = !['image', 'heading', 'pre'].includes(chapter.blocks?.[index]?.kind ?? '')
    const markers=sectionMarkerRanges(text);let local=0,marker=0
    for (const char of text) {
      while(marker<markers.length&&markers[marker].end<=local)marker++
      const numbering=marker<markers.length&&local>=markers[marker].start&&local<markers[marker].end
      const end = start + char.length
      for (let i = start + 1; i < end; i++) prefix[i] = total
      if (readable && !numbering && /\p{L}/u.test(char)) total++
      prefix[end] = total; start = end;local+=char.length
    }
    if (index < chapter.paragraphs.length - 1) {
      prefix[++start] = total; prefix[++start] = total
    }
  })
  return { original, total, weight: (start: number, end: number) => prefix[Math.min(original.length, end)] - prefix[Math.max(0, start)] }
}

/** Lookup tokenisation repeats source ranges. Count their union exactly once. */
export function displayCoverage(chapter: Chapter, model: DisplayText) {
  const source = sourceCoverage(chapter)
  const ranges = model.runs.filter(run => run.translation || run.replacement)
    .map(run => [run.sourceStart, run.sourceEnd] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let covered = 0, end = 0
  for (const range of ranges) {
    if (range[1] > end) covered += source.weight(Math.max(end, range[0]), range[1])
    end = Math.max(end, range[1])
  }
  return { covered, total: source.total, percent: source.total ? Math.round(covered / source.total * 1000) / 10 : 0 }
}
