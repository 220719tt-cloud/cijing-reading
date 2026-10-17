import type { DisplayText, DisplayRun } from './displayText'
/** Lookup tokens keep translated sentence anchors; they never invent word-level alignment. */
export function withOriginalEnglishLookup(model:DisplayText,phrases:readonly string[]=[],glosses:ReadonlyMap<string,string>=new Map()):DisplayText {
  const runs:DisplayRun[]=[]
  const alternatives=[...new Set(phrases.filter(value=>/^[a-z]+(?: [a-z]+)+$/i.test(value)).map(value=>value.toLowerCase()))].sort((a,b)=>b.length-a.length).map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/ /g,'\\s+'))
  const pattern=new RegExp(`\\b(?:${alternatives.length?alternatives.join('|')+'|':''}[A-Za-z]+(?:['’\\-][A-Za-z]+)*)\\b`,'gi')
  for(const run of model.runs) {
    if(run.replacement) {runs.push(run);continue}
    const text=model.text.slice(run.displayStart,run.displayEnd)
    let cursor=0
    const piece=(start:number,end:number,lookup=false)=>{
      const value=text.slice(start,end)
      runs.push({...run,sourceStart:run.translation?run.sourceStart:run.sourceStart+start,sourceEnd:run.translation?run.sourceEnd:run.sourceStart+end,displayStart:run.displayStart+start,displayEnd:run.displayStart+end,lookup,...(lookup?{english:value,entryId:value.toLowerCase().replace(/’/g,"'").replace(/\s+/g,' '),lookupMeaning:glosses.get(value.toLowerCase().replace(/’/g,"'").replace(/\s+/g,' '))}:{})})
    }
    for(const match of text.matchAll(pattern)) {
      const start=match.index!,end=start+match[0].length
      if(start>cursor) piece(cursor,start)
      piece(start,end,true);cursor=end
    }
    if(cursor<text.length) piece(cursor,text.length)
  }
  return {...model,runs}
}
