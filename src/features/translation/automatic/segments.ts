import {sentenceRanges} from '../package.ts'

/** Keep complete quotations and their short speech tags in one translation group.
 * Only changes new automatic request boundaries; original text and cached ranges stay intact.
 */
export function translationRanges(text:string){
  const pairs:Record<string,string>={'“':'”','「':'」','『':'』','"':'"'}
  const stack:string[]=[],quotes:{start:number;end:number}[]=[]
  let opening=0
  for(let i=0;i<text.length;i++){
    const char=text[i]
    if(char==='"'&&text[i-1]==='\\')continue
    if(stack.length&&char===stack.at(-1)){
      stack.pop();if(!stack.length)quotes.push({start:opening,end:i+1})
    }else if(Object.hasOwn(pairs,char)){
      if(!stack.length)opening=i
      stack.push(pairs[char])
    }
  }
  const protectedRanges=quotes.map(quote=>{
    // Exact, short attribution only. Actions and arbitrary names are not guessed.
    const tag=text.slice(quote.end,quote.end+40).match(/^\s*(?:他|她|我|你|男人|女人|老人|少年|少女|男孩|女孩|父亲|母亲|哥哥|姐姐|弟弟|妹妹)(?:轻声|低声|小声|大声|忽然|突然|平静地|轻轻地|缓缓地)?(?:说道|说|问道|问|答道|回答|喊道|喊|低语|解释道|解释)[。！？!?]/u)
    return {...quote,end:quote.end+(tag?.[0].length??0)}
  })
  const ranges:{start:number;end:number}[]=[];let start=0,protectedIndex=0
  for(const range of sentenceRanges(text)){
    while(protectedIndex<protectedRanges.length&&protectedRanges[protectedIndex].end<=range.end)protectedIndex++
    const quote=protectedRanges[protectedIndex]
    if(quote&&range.end>quote.start&&range.end<quote.end)continue
    ranges.push({start,end:range.end});start=range.end
  }
  return ranges
}
