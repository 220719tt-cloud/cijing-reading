import type { DisplayRun, DisplayText } from '../replacement/displayText'
import type { TextMark } from '../../shared/types/book'
export interface TextFragment { text:string; run?:DisplayRun; marks:TextMark['kind'][] }
export function fragmentsForBlock(model:DisplayText,start:number,end:number,marks:TextMark[]=[]):TextFragment[] {
  const result:TextFragment[]=[]
  for(const run of model.runs) {
    const a=Math.max(start,run.sourceStart),b=Math.min(end,run.sourceEnd)
    if(a>=b) continue
    const active=marks.filter(mark=>start+mark.end>a&&start+mark.start<b)
    if(run.replacement || run.lookup || run.translation) result.push({text:model.text.slice(run.displayStart,run.displayEnd),run:run.replacement||run.lookup?run:undefined,marks:[...new Set(active.filter(mark=>!run.translation || start+mark.start<=run.sourceStart&&start+mark.end>=run.sourceEnd).map(mark=>mark.kind))]})
    else {
      const cuts=[a,...active.flatMap(mark=>[start+mark.start,start+mark.end]).filter(cut=>cut>a&&cut<b),b].sort((x,y)=>x-y)
      for(let i=0;i<cuts.length-1;i++) if(cuts[i]<cuts[i+1]) result.push({text:model.original.slice(cuts[i],cuts[i+1]),marks:[...new Set(active.filter(mark=>start+mark.start<=cuts[i]&&start+mark.end>=cuts[i+1]).map(mark=>mark.kind))]})
    }
  }
  return result
}
