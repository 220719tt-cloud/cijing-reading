import type { Chapter } from '../../shared/types/book'
import type { DisplayRun, DisplayText } from '../replacement/displayText'
import { protectedRanges } from '../replacement/displayText.ts'
import type { SentenceEntry } from './library'

interface Match { start:number; end:number; entry:SentenceEntry }
function rank(value:string) {
  let hash=2166136261
  for(let i=0;i<value.length;i++) hash=Math.imul(hash^value.charCodeAt(i),16777619)
  return hash>>>0
}
/** Quote ranges are context, never removed from the original or translated output. */
function quotedRanges(source:string) {
  const ranges:[number,number][]=[]
  const pairs:Record<string,string>={'“':'”','「':'」','『':'』','"':'"'}
  const stack:{end:string;start:number}[]=[]
  for(let i=0;i<source.length;i++) {
    const ch=source[i]
    if(stack.at(-1)?.end===ch) {const open=stack.pop()!;ranges.push([open.start,i+1])}
    else if(pairs[ch]) stack.push({end:pairs[ch],start:i})
  }
  // Unclosed quotations must not turn reported speech into past-tense narration.
  for(const open of stack) ranges.push([open.start,source.length])
  return ranges
}
function startsSentence(source:string,start:number) {
  let i=start-1
  while(i>=0&&/[ \t\r]/u.test(source[i])) i--
  return i<0||/[\n。！？!?“「『"]/u.test(source[i])
}
/** Exact authored sentences only; no placeholders, fuzzy translation or model calls. */
export function applySentenceLibrary(chapter:Chapter,baseline:DisplayText,entries:readonly SentenceEntry[],options:{concentration:number;seed:string;titles?:string[]}) {
  if(![20,40].includes(options.concentration)) return {model:baseline,eligible:0,replaced:0}
  const source=baseline.original
  const protectedSpans=protectedRanges(source,options.titles??[],[])
  const quotes=quotedRanges(source)
  let blockStart=0
  chapter.paragraphs.forEach((text,index)=>{
    if(chapter.blocks?.[index]?.kind==='heading'||chapter.blocks?.[index]?.kind==='image'||chapter.blocks?.[index]?.kind==='pre') protectedSpans.push([blockStart,blockStart+text.length])
    if(chapter.blocks?.[index]?.kind==='quote') quotes.push([blockStart-1,blockStart+text.length])
    blockStart+=text.length+2
  })
  const matches:Match[]=[]
  const imported=baseline.runs.filter(run=>run.translation&&!run.sentence)
  for(const entry of entries) for(let start=source.indexOf(entry.chinese);start>=0;start=source.indexOf(entry.chinese,start+entry.chinese.length)) {
    const end=start+entry.chinese.length
    if(!startsSentence(source,start)||protectedSpans.some(([a,b])=>start<b&&end>a)) continue
    if(imported.some(run=>start<run.sourceEnd&&end>run.sourceStart)) continue
    const inQuote=quotes.some(([a,b])=>start>a&&start<b)
    if(entry.category==='conversation'?!inQuote:inQuote) continue
    matches.push({start,end,entry})
  }
  matches.sort((a,b)=>rank(`${options.seed}:${a.start}:${a.entry.id}`)-rank(`${options.seed}:${b.start}:${b.entry.id}`)||a.start-b.start)
  const cap=options.concentration===20?Math.max(1,Math.floor(matches.length/2)):matches.length
  const budget=Math.ceil(source.replace(/\s/gu,'').length*(options.concentration===20?.1:.25))
  const chosen:Match[]=[];let covered=0
  for(const match of matches.slice(0,cap)) {
    if(covered>=budget) break
    if(chosen.some(item=>match.start<item.end&&match.end>item.start)) continue
    chosen.push(match);covered+=match.end-match.start
  }
  if(!chosen.length) return {model:baseline,eligible:matches.length,replaced:0}
  const edits:{start:number;end:number;text:string;run:Partial<DisplayRun>}[]=chosen.map(({start,end,entry})=>({
    start,end,text:` ${entry.english} `,run:{replacement:true,translation:true,sentence:true,entryId:entry.id,english:entry.english,chinese:source.slice(start,end),contextChinese:source.slice(start,end)},
  }))
  for(const run of baseline.runs) {
    if(!(run.replacement||run.translation)||chosen.some(item=>run.sourceStart<item.end&&run.sourceEnd>item.start)) continue
    edits.push({start:run.sourceStart,end:run.sourceEnd,text:baseline.text.slice(run.displayStart,run.displayEnd),run})
  }
  edits.sort((a,b)=>a.start-b.start)
  let text='',cursor=0;const runs:DisplayRun[]=[]
  function append(start:number,end:number,value:string,properties:Partial<DisplayRun>={}) {
    runs.push({...properties,sourceStart:start,sourceEnd:end,displayStart:text.length,displayEnd:text.length+value.length,replacement:properties.replacement??false});text+=value
  }
  for(const edit of edits) {
    if(cursor<edit.start) append(cursor,edit.start,source.slice(cursor,edit.start))
    append(edit.start,edit.end,edit.text,edit.run);cursor=edit.end
  }
  if(cursor<source.length) append(cursor,source.length,source.slice(cursor))
  return {model:{...baseline,text,runs,replaced:runs.filter(run=>run.replacement).length},eligible:matches.length,replaced:chosen.length}
}
