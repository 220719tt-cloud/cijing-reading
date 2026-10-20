import {neutralCopy} from './automatic/protocol.ts'

const digits='零一二三四五六七八九'
const units:Record<string,number>={十:10,百:100,千:1000}
function writtenNumber(value:number){
  if(value===0)return '零'
  let result='',gap=false
  for(const unit of [1000,100,10,1]){
    const digit=Math.floor(value/unit)%10
    if(!digit){if(result)gap=true;continue}
    if(gap){result+='零';gap=false}
    if(!(unit===10&&digit===1&&!result))result+=digits[digit]
    if(unit>1)result+=Object.keys(units).find(key=>units[key]===unit)
  }
  return result
}
/** Only an entire, bracketed numeric section marker; never narrative or a name.
 * Canonical round-trip rejects ambiguous/malformed numerals such as 十十 / 一百二.
 */
export function translateSectionMarker(source:string):string|undefined{
  const match=source.match(/^(\s*)([（(【\[])([ \t]*)([零〇一二三四五六七八九十百千两]{1,16})([ \t]*)([）)】\]])(\s*)$/u)
  if(!match||({'（':'）','(':')','【':'】','[':']'} as Record<string,string>)[match[2]]!==match[6])return undefined
  const number=match[4].replaceAll('〇','零').replaceAll('两','二')
  let value=0,digit=0
  for(const char of number){if(units[char]){value+=(digit||1)*units[char];digit=0}else digit=digits.indexOf(char)}
  value+=digit
  const canonical=writtenNumber(value)
  if(value>9999||number!==canonical&&!(value>=10&&value<20&&number===`一${canonical}`))return undefined
  return `${match[1]}${match[2]}${match[3]}${value}${match[5]}${match[6]}${match[7]}`
}
/** Markers inside a TXT paragraph still have to occupy their own physical line. */
export function sectionMarkerRanges(text:string){
  const ranges:{start:number;end:number}[]=[]
  for(const line of text.matchAll(/[^\r\n]+/gu))if(translateSectionMarker(line[0])!==undefined)ranges.push({start:line.index,end:line.index+line[0].length})
  return ranges
}
export function localNeutralTarget(source:string){return neutralCopy(source,source)?source:translateSectionMarker(source)}
export function validNeutralTarget(source:string,target:string){return neutralCopy(source,target)||translateSectionMarker(source)===target}
