import type { Chapter } from '../../shared/types/book'
import type { DisplayRun, DisplayText } from '../replacement/displayText'
import type { ChapterTranslation, TranslationSegment } from './types'
import { translationCoverage } from './package.ts'
import { closestGroups } from './selection.ts'
import { displayCoverage, sourceCoverage } from './coverage.ts'
import {translateSectionMarker} from './neutral.ts'

function rank(value:string) {let hash=2166136261;for(const char of value) hash=Math.imul(hash^char.charCodeAt(0),16777619);return hash>>>0}
export interface BilingualDisplay {
  model:DisplayText; translated:number; available:number; complete:boolean; message:string; badge:string
  coveredPercent:number; availablePercent:number; covered:number; total:number; localCount:number
}
interface Edit {start:number;end:number;text:string;run?:DisplayRun;segment?:TranslationSegment;weight:number}
interface HintOptions {showChineseHints?:boolean;mastered?:ReadonlySet<string>}
function translatedText(segment:TranslationSegment) {
  const leading=segment.sourceText.match(/^\s*/u)?.[0]??'',trailing=segment.sourceText.match(/\s*$/u)?.[0]??''
  const prefix=leading.includes('\n')&&!/^\s*\n/u.test(segment.targetText)?leading:''
  const suffix=trailing.includes('\n')&&!/\n\s*$/u.test(segment.targetText)?trailing:''
  return ` ${prefix}${segment.targetText}${suffix} `
}
const overlap=(a:Edit,b:Edit)=>a.start<b.end&&a.end>b.start
const contains=(a:Edit,b:Edit)=>a.start<=b.start&&a.end>=b.end
function choose(pool:Edit[],target:number,weight:(item:Edit)=>number=item=>item.weight) {
  if(target<=0||!pool.length)return []
  const available=pool.reduce((sum,item)=>sum+weight(item),0)
  return closestGroups(pool,weight,Math.max(0,target),available)
}

/** One source-range budget for words, authored sentences and actual AI translations.
 * Whole cached groups are indivisible. Never slice English or infer word alignment.
 * Every setting uses the SAME candidate pool and a stable concentration ladder.
 * Prefer nested ranges; coarse groups may require a disclosed adjustment to meet the target.
 */
export function buildBilingualDisplay(chapter:Chapter,baseline:DisplayText,translation:ChapterTranslation|undefined,concentration:number,seed:string,hints?:HintOptions):BilingualDisplay {
  const source=sourceCoverage(chapter),cache=translationCoverage(chapter,translation?.segments??[])
  const original:DisplayText={...baseline,text:source.original,runs:source.original?[{sourceStart:0,sourceEnd:source.original.length,displayStart:0,displayEnd:source.original.length,replacement:false}]:[],replaced:0}
  const empty:BilingualDisplay={model:original,translated:0,available:0,complete:cache.complete,message:'当前显示完整原文。',badge:'',coveredPercent:0,availablePercent:cache.percent,covered:0,total:source.total,localCount:0}
  if(concentration===0)return empty
  if(!source.total)return {...empty,message:'本章没有需要切换语言的正文，标题、数字和图片按原样显示。'}
  if(concentration===100&&!cache.complete)return {...empty,message:`本章译文尚未完整（已缓存 ${cache.percent}%）。100% 需要补齐正文，当前显示原文；请查看翻译进度、继续或重试。`,badge:'译文未完整 · 实际 0%（原文）'}
  let offset=0
  const starts=chapter.paragraphs.map(text=>{const start=offset;offset+=text.length+2;return start})
  const markers:Edit[]=[]
  const groups:Edit[]=(translation?.segments??[]).flatMap(segment=>{
    const kind=chapter.blocks?.[segment.source.paragraph]?.kind
    if(['heading','image','pre'].includes(kind??''))return []
    const start=starts[segment.source.paragraph]+segment.source.start,end=starts[segment.source.paragraph]+segment.source.end
    const weight=source.weight(start,end)
    // A cached structural numeral is not English coverage or a lookup sentence.
    if(!weight&&translateSectionMarker(segment.sourceText)!==undefined)markers.push({start,end,weight:0,text:translatedText(segment)})
    return weight?[{segment,start,end,weight,text:translatedText(segment)}]:[]
  }).sort((a,b)=>rank(`${seed}:${a.start}:${a.end}`)-rank(`${seed}:${b.start}:${b.end}`)||a.start-b.start)
  // Local expressions can be upgraded to their complete translated sentence later.
  // Crossing an AI alignment boundary would truncate an expression, so skip it.
  const local:Edit[]=baseline.runs.filter(run=>(run.replacement||run.translation)&&source.weight(run.sourceStart,run.sourceEnd)>0)
    .map(run=>({start:run.sourceStart,end:run.sourceEnd,weight:source.weight(run.sourceStart,run.sourceEnd),text:baseline.text.slice(run.displayStart,run.displayEnd),run}))
    .filter(item=>!groups.some(group=>overlap(item,group)&&!contains(group,item)))
    .sort((a,b)=>rank(`${seed}:local:${a.start}:${a.end}`)-rank(`${seed}:local:${b.start}:${b.end}`)||a.start-b.start)
  const selected=new Set<Edit>()
  // Vetted words/phrases supply a small part; actual whole sentences supply the rest.
  if(concentration<100)for(const item of choose(local,source.total*(groups.length ? .04 : .2)))selected.add(item)
  let covered=[...selected].reduce((sum,item)=>sum+item.weight,0),adjustedForTarget=false
  for(const level of [20,40,60,80,100]) {
    const previous=[...selected],previousCoverage=covered,target=source.total*level/100
    const remaining=groups.filter(item=>!selected.has(item))
    const localSelected=[...selected].filter(item=>item.run)
    const increment=(group:Edit)=>group.weight-localSelected.filter(item=>contains(group,item)).reduce((sum,item)=>sum+item.weight,0)
    const additions=level===100?remaining:choose(remaining,source.total*level/100-covered,increment)
    for(const group of additions) {
      for(const item of selected)if(item.run&&contains(group,item)){selected.delete(item);covered-=item.weight}
      selected.add(group);covered+=group.weight
    }
    // Fill gaps using vetted expressions within the SAME source-range budget.
    if(level<=40) {
      const occupied=[...selected]
      const remainingLocal=local.filter(item=>!selected.has(item)&&!occupied.some(other=>overlap(item,other)))
      for(const item of choose(remainingLocal,source.total*level/100-covered)){selected.add(item);covered+=item.weight}
    }
    // A few coarse groups can make strict nesting needlessly miss an attainable
    // target (e.g. 40/30/20/10 source units). Prefer the requested coverage when
    // the nested gap exceeds 2 points. Never split English to manufacture precision.
    if(level<100&&groups.length&&Math.abs(covered-target)>Math.max(1,source.total*.02)) {
      const preserved=(group:Edit)=>previous.reduce((sum,item)=>sum+(overlap(group,item)?source.weight(Math.max(group.start,item.start),Math.min(group.end,item.end)):0),0)
      const ordered=[...groups].map(group=>({group,keep:preserved(group)})).sort((a,b)=>b.keep-a.keep).map(item=>item.group)
      const alternative=choose(ordered,target)
      let alternativeCovered=alternative.reduce((sum,item)=>sum+item.weight,0)
      const extras=(level<=40?local:[...selected].filter(item=>item.run)).filter(item=>!alternative.some(group=>overlap(item,group)))
      for(const item of choose(extras,target-alternativeCovered)){alternative.push(item);alternativeCovered+=item.weight}
      if(alternativeCovered>=previousCoverage&&Math.abs(alternativeCovered-target)<Math.abs(covered-target)) {
        if(previous.some(item=>!alternative.some(group=>contains(group,item))))adjustedForTarget=true
        selected.clear();for(const item of alternative)selected.add(item)
        covered=alternativeCovered
      }
    }
    if(level>=concentration)break
  }
  if(concentration>=60&&!groups.length)return {...empty,message:'本章尚无英文译文，当前显示原文。请允许自动翻译，或继续／重试失败的任务。',badge:`目标 ${concentration}% · 暂无译文 · 实际 0%（原文）`}
  const edits=[...selected,...markers].sort((a,b)=>a.start-b.start)
  let cursor=0,text='';const runs:DisplayRun[]=[],seen=new Set<string>()
  function append(start:number,end:number,value:string,properties:Partial<DisplayRun>={}) {
    if(start===end&&!value)return
    runs.push({...properties,sourceStart:start,sourceEnd:end,displayStart:text.length,displayEnd:text.length+value.length,replacement:properties.replacement??false});text+=value
  }
  for(const edit of edits) {
    if(cursor<edit.start)append(cursor,edit.start,source.original.slice(cursor,edit.start))
    if(edit.segment)append(edit.start,edit.end,edit.text,{translation:true,contextChinese:edit.segment.sourceText,contextEnglish:edit.segment.targetText})
    else if(hints&&edit.run?.english&&edit.run.chinese&&edit.run.entryId&&!edit.run.translation) {
      // Hints belong to the first actually DISPLAYED occurrence, not the candidate pool.
      const run=edit.run,hint=hints.showChineseHints===true&&!seen.has(run.entryId!)&&!hints.mastered?.has(run.entryId!)
      seen.add(run.entryId!)
      append(edit.start,edit.end,` ${run.english}${hint?`（${run.chinese}）`:''} `,{...run,hint})
    } else append(edit.start,edit.end,edit.text,edit.run)
    cursor=edit.end
  }
  if(cursor<source.original.length)append(cursor,source.original.length,source.original.slice(cursor))
  const model={...baseline,text,runs,replaced:runs.filter(run=>run.replacement).length}
  const actual=displayCoverage(chapter,model),translated=edits.filter(item=>item.segment).length,localCount=edits.filter(item=>item.run).length
  const coarse=Math.abs(actual.percent-concentration)>2&&cache.complete?'完整句组不可拆分，当前为保留完整语义且逐档递增的可用比例。':''
  const adjustment=adjustedForTarget&&concentration<100?'少数长句组无法同时满足目标比例与逐档包含，已优先接近目标，个别句组会调整。':''
  const fallback=!groups.length?'本章暂无句子译文，当前仅使用经过筛选的本地表达；允许自动翻译可覆盖更多语境。':''
  const message=`目标 ${concentration}% · 实际英文覆盖 ${actual.percent}%。按转为英文的原文正文范围计算，词组和整句一并计入。${!cache.complete?`译文已缓存 ${cache.percent}%，未有可靠英文的范围保留中文。`:''}${fallback}${coarse}${adjustment}`
  return {model,translated,localCount,available:groups.length,complete:cache.complete,message,badge:`目标 ${concentration}% · 实际 ${actual.percent}%${!cache.complete?' · 部分译文':''}`,coveredPercent:actual.percent,availablePercent:cache.percent,covered:actual.covered,total:actual.total}
}
