import type { Chapter } from '../../shared/types/book'
import type { DisplayRun, DisplayText } from '../replacement/displayText'
import type { ChapterTranslation, TranslationSegment } from './types'
import { textWeight, translationCoverage } from './package.ts'
import { selectTranslationGroups } from './selection.ts'
function rank(value:string) {let hash=2166136261;for(const char of value) hash=Math.imul(hash^char.charCodeAt(0),16777619);return hash>>>0}
export interface BilingualDisplay { model:DisplayText; translated:number; available:number; complete:boolean; message:string; badge:string; coveredPercent:number; availablePercent:number }
function translatedText(segment:TranslationSegment) {
  const leading=segment.sourceText.match(/^\s*/u)?.[0]??'',trailing=segment.sourceText.match(/\s*$/u)?.[0]??''
  const prefix=leading.includes('\n')&&!/^\s*\n/u.test(segment.targetText)?leading:''
  const suffix=trailing.includes('\n')&&!/\n\s*$/u.test(segment.targetText)?trailing:''
  return ` ${prefix}${segment.targetText}${suffix} `
}
/** Composition only. Never generates English, mutates a Book or calls a provider. */
export function buildBilingualDisplay(chapter:Chapter,baseline:DisplayText,translation:ChapterTranslation|undefined,concentration:number,seed:string):BilingualDisplay {
  const coverage=translationCoverage(chapter,translation?.segments??[]),available=translation?.segments.length??0
  const missing=coverage.covered<coverage.total
  const empty={model:baseline,translated:0,available,complete:!missing,message:'当前显示完整原文。',badge:'',coveredPercent:0,availablePercent:coverage.percent}
  if(concentration===0) return empty
  if(!coverage.total) return {...empty,message:'本章没有需要翻译的文字，图片按原样显示。'}
  if(concentration===20) return {...empty,message:'中文为主，使用本地单词和短语替换。'}
  if(concentration===100&&missing) return {...empty,message:`本章译文尚未完整（已覆盖 ${coverage.percent}%）。100% 需要补齐正文，当前显示原文。自动翻译未完成时保留原文，请查看翻译进度、重试，或导入本章译文。`,badge:'译文未完整 · 当前为原文'}
  if(!available) return {...empty,message:concentration===40?'本章暂无句子译文，当前使用本地词语／短语替换。可导入译文加入完整英文句子。':'本章尚无英文译文，当前显示原文。请配置并允许自动翻译，或重试失败的任务；也可导入对应译文。本地预览和上线网址的数据不会自动同步。',badge:concentration>=60?'暂无译文 · 当前为原文':''}
  let offset=0
  const starts=chapter.paragraphs.map(text=>{const start=offset;offset+=text.length+2;return start})
  const pool=translation!.segments.map(segment=>({segment,start:starts[segment.source.paragraph]+segment.source.start,end:starts[segment.source.paragraph]+segment.source.end}))
    .sort((a,b)=>rank(`${seed}:${a.start}:${a.end}`)-rank(`${seed}:${b.start}:${b.end}`)||a.start-b.start)
  const chosen=selectTranslationGroups(pool,item=>textWeight(item.segment.sourceText),coverage.total,concentration)
  const translatedWeight=chosen.reduce((sum,item)=>sum+textWeight(item.segment.sourceText),0)
  const edits:{start:number;end:number;text:string;run?:DisplayRun;segment?:TranslationSegment}[]=chosen.map(item=>({...item,text:translatedText(item.segment)}))
  let covered=translatedWeight
  if(concentration===40) for(const run of baseline.runs) {
    if(!run.replacement||chosen.some(item=>run.sourceStart<item.end&&run.sourceEnd>item.start)) continue
    if(chosen.length&&covered>=coverage.total*.4) break
    edits.push({start:run.sourceStart,end:run.sourceEnd,text:baseline.text.slice(run.displayStart,run.displayEnd),run})
    covered+=textWeight(baseline.original.slice(run.sourceStart,run.sourceEnd))
  }
  edits.sort((a,b)=>a.start-b.start)
  let cursor=0,text='';const runs:DisplayRun[]=[]
  function append(start:number,end:number,value:string,properties:Partial<DisplayRun>={}) {
    if(start===end&&!value) return
    runs.push({sourceStart:start,sourceEnd:end,displayStart:text.length,displayEnd:text.length+value.length,replacement:false,...properties});text+=value
  }
  for(const edit of edits) {
    if(cursor<edit.start) append(cursor,edit.start,baseline.original.slice(cursor,edit.start))
    if(edit.segment) append(edit.start,edit.end,edit.text,{translation:true,contextChinese:edit.segment.sourceText,contextEnglish:edit.segment.targetText})
    else {const {replacement,entryId,hint,english,chinese}=edit.run!;append(edit.start,edit.end,edit.text,{replacement,entryId,hint,english,chinese})}
    cursor=edit.end
  }
  if(cursor<baseline.original.length) append(cursor,baseline.original.length,baseline.original.slice(cursor))
  const model={...baseline,text,runs,replaced:runs.filter(run=>run.replacement).length}
  const actual=coverage.total?Math.round(translatedWeight/coverage.total*100):0
  const coarse=concentration>=60&&Math.abs(actual-concentration)>10&&!missing ? '现有译文句组较长，无法在不拆散句子的前提下接近目标；请按原文模板提供更细的对应句组。' : ''
  const message=`目标 ${concentration}%；已显示 ${chosen.length} 个英文句组，约覆盖本章 ${actual}% 的原文内容。${missing?`现有译文仅覆盖 ${coverage.percent}%，未翻译范围保持中文。`:''}${concentration===40?'其余范围可使用词语／短语替换。':''}${coarse}`
  return {model,translated:chosen.length,available,complete:coverage.complete,message,badge:concentration>=60?`目标 ${concentration}% · 实际 ${actual}%${missing?' · 部分译文':''}`:'',coveredPercent:actual,availablePercent:coverage.percent}
}
