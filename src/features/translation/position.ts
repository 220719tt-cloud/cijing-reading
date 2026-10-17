import type { Chapter } from '../../shared/types/book'
import type { DisplayText } from '../replacement/displayText'
import {displayToSource,sourceToDisplay} from '../replacement/displayText.ts'
import {offsetToPosition,positionToOffset} from '../reading/readingPosition.ts'
import type { ReadingPosition } from '../reading/readingPosition'
/** A view identity only; source integrity uses SHA-256 in the translation package. */
export function displayFingerprint(model:DisplayText) {
  let hash=2166136261
  const value=model.original+'\u0000'+model.text
  for(let i=0;i<value.length;i++) hash=Math.imul(hash^value.charCodeAt(i),16777619)
  return `view1:${model.original.length}:${model.text.length}:${hash>>>0}`
}
export function positionForDisplay(chapter:Chapter,model:DisplayText,offset:number,fingerprint:string):ReadingPosition {
  const safe=Math.max(0,Math.min(model.text.length,offset))
  return {...offsetToPosition(chapter,displayToSource(model,safe)),rendition:{fingerprint,offset:safe}}
}
export function displayOffsetForPosition(chapter:Chapter,model:DisplayText,position:ReadingPosition,fingerprint:string) {
  const source=positionToOffset(chapter,position),saved=position.rendition
  if(saved?.fingerprint===fingerprint&&Number.isSafeInteger(saved.offset)&&saved.offset>=0&&saved.offset<=model.text.length&&displayToSource(model,saved.offset)===source) return saved.offset
  return sourceToDisplay(model,source)
}
