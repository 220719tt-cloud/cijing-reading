import { indexTextNodes } from './textNodes'
/** Measure the browser's actual column layout, not an estimated character count. */
export function measurePageStarts(element: HTMLDivElement, width: number, gap: number): number[] {
  const index = indexTextNodes(element)
  if (!index.length) return [0]
  const text = element.textContent ?? ''
  const length = index.length
  const count = Math.max(1, Math.round((element.scrollWidth + gap) / (width + gap)))
  const origin = element.getBoundingClientRect().left
  // Floor gives the column containing a glyph; a small tolerance absorbs subpixel rounding.
  function columnAt(offset: number) {
    return Math.max(0, Math.floor((index.rect(offset)!.left - origin + .5) / (width + gap)))
  }
  const starts = [0]
  for (let page = 1; page < count; page++) {
    let low = starts[starts.length - 1], high = length
    while (low < high) { const middle = Math.floor((low + high) / 2); if (columnAt(middle) < page) low = middle + 1; else high = middle }
    if (low < length) {
      const code = text.charCodeAt(low)
      if (code >= 0xdc00 && code <= 0xdfff) low--
      starts.push(low)
    }
  }
  return starts
}
