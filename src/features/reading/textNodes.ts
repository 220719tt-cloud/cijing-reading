/** Locate UTF-16 display offsets across plain text and inline interactive words.
 * The concatenated DOM text must stay identical to DisplayText.text. */
export function locateTextOffset(starts: readonly number[], lengths: readonly number[], offset: number) {
  if (!starts.length) return null
  let low = 0, high = starts.length - 1
  const total = starts[high] + lengths[high]
  const clamped = Math.max(0, Math.min(total, offset))
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (starts[middle] <= clamped) low = middle
    else high = middle - 1
  }
  return { index: low, offset: clamped - starts[low] }
}
export function indexTextNodes(element: HTMLElement) {
  const nodes: Text[] = [], starts: number[] = [], lengths: number[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let total = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.length) continue
    nodes.push(node as Text); starts.push(total); lengths.push(node.textContent.length)
    total += node.textContent.length
  }
  return {
    length: total,
    rect(offset: number) {
      const point=locateTextOffset(starts,lengths,offset)
      if(!point) return null
      const image=nodes[point.index].parentElement?.closest('[data-reader-image]')
      if(image) return image.getBoundingClientRect()
      const end=locateTextOffset(starts,lengths,Math.min(total,offset+1))!
      const range=document.createRange()
      range.setStart(nodes[point.index],point.offset);range.setEnd(nodes[end.index],end.offset)
      return range.getBoundingClientRect()
    },
    range(start: number, end: number) {
      const a = locateTextOffset(starts, lengths, start), b = locateTextOffset(starts, lengths, end)
      if (!a || !b) return null
      const range = document.createRange()
      range.setStart(nodes[a.index], a.offset); range.setEnd(nodes[b.index], b.offset)
      return range
    },
  }
}
