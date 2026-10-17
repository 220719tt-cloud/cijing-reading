export interface ReaderPointer { x: number; y: number; time: number; wordStart?: number }
/** A word tap takes priority over side-zone paging; a swipe may start on a word. */
export function readerGesture(start: ReaderPointer, end: { x: number; y: number; time: number }, scrolling: boolean) {
  const dx = end.x - start.x, dy = end.y - start.y
  if (!scrolling && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) return dx < 0 ? 'next' : 'previous'
  if (Math.abs(dx) > 12 || Math.abs(dy) > 12 || end.time - start.time > 500) return 'ignore'
  return start.wordStart === undefined ? 'tap' : 'word'
}

/** Screen-wide zones, independent of the narrower text column and its gutters. */
export function readingTapZone(x:number,left:number,width:number,scrolling=false) {
  if(width<=0||x<left||x>left+width) return 'ignore'
  if(scrolling) return 'toolbar'
  const fraction=(x-left)/width
  return fraction<=.2?'previous':fraction>=.8?'next':'toolbar'
}
/** Do not let toolbar whitespace, native inputs or modal backdrops become page taps. */
export function readerTargetBlocked(target:Element|null) {
  return !!target?.closest('dialog,.reading-toolbar,.reader-bottom-tools,.reading-page-footer,.reading-warning,button,a,input,select,textarea,label,summary,[role="slider"],[contenteditable="true"],[role="button"]:not([data-word-start])')
}
export function inReadingBand(y:number,top:number,bottom:number) { return y>=top&&y<bottom }
