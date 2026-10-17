import type { Book, Chapter } from '../../shared/types/book'
import type { ChapterTranslation, TranslationPackage, TranslationSegment, TranslationExchange } from './types'
import { contentHash } from './hash.ts'
export const TRANSLATION_LIMITS={file:20*1024*1024,segments:50000,chapterSegments:6000,target:120000,chapterText:120000}
export const textWeight=(text:string)=>text.replace(/\s/gu,'').length
export function paragraphIsText(chapter:Chapter,index:number) {return chapter.blocks?.[index]?.kind!=='image' && textWeight(chapter.paragraphs[index])>0}
export function canonicalChapter(chapter:Chapter) {return JSON.stringify({title:chapter.title,paragraphs:chapter.paragraphs,images:chapter.paragraphs.map((_,i)=>chapter.blocks?.[i]?.kind==='image')})}
export const chapterHash=(chapter:Chapter)=>contentHash(canonicalChapter(chapter))
export async function bookIdentity(book:Book) {
  return {sourceHash:await contentHash(JSON.stringify(book.chapters.map(canonicalChapter))),title:book.title,chapterCount:book.chapters.length}
}
export function sentenceRanges(text:string) {
  const ranges:{start:number;end:number}[]=[];let start=0
  for(let i=0;i<text.length;i++) if(text[i]==='\n' || /[。！？!?]/u.test(text[i]) || text[i]==='.' && (i+1===text.length || /\s/.test(text[i+1]))) {
    while(i+1<text.length&&/[。！？!?.”’"」』）)]/u.test(text[i+1])) i++
    const end=i+1;if(textWeight(text.slice(start,end))) ranges.push({start,end});start=end
  }
  if(textWeight(text.slice(start))) ranges.push({start,end:text.length})
  else if(ranges.length) ranges[ranges.length-1].end=text.length
  return ranges
}
export async function createTranslationTemplate(book:Book,indices:readonly number[]=book.chapters.map((_,i)=>i)):Promise<TranslationPackage> {
  const chapters:ChapterTranslation[]=[]
  for(const index of indices) {
    const chapter=book.chapters[index];if(!chapter) throw new Error('章节不存在。')
    const segments:TranslationSegment[]=[]
    chapter.paragraphs.forEach((text,paragraph)=>{
      if(!paragraphIsText(chapter,paragraph)) return
      for(const range of sentenceRanges(text)) segments.push({id:`p${paragraph}-${range.start}-${range.end}`,chapterId:chapter.id,source:{paragraph,...range},sourceText:text.slice(range.start,range.end),targetText:''})
    })
    chapters.push({schemaVersion:1,chapterId:chapter.id,chapterIndex:index,chapterTitle:chapter.title,identity:{sourceHash:await chapterHash(chapter),sourceLanguage:'zh',targetLanguage:'en',provider:'user-import',modelVersion:'unassigned',configurationHash:'',contextHash:''},status:'partial',segments,updatedAt:new Date().toISOString()})
    // Long books should not monopolize the UI thread during template generation.
    if(chapters.length%20===0) await new Promise(resolve=>setTimeout(resolve,0))
  }
  return {format:'cijing-translations',schemaVersion:1,book:await bookIdentity(book),chapters}
}
function object(value:unknown):Record<string,unknown> {
  if(!value || typeof value!=='object'||Array.isArray(value)) throw new Error('译文结构无效，请使用导出的 JSON 模板。')
  return value as Record<string,unknown>
}
function string(value:unknown,label:string,max=300) {
  if(typeof value!=='string'||value.length>max) throw new Error(`译文的${label}无效或过长。`)
  return value
}
function integer(value:unknown,label:string) {
  if(!Number.isSafeInteger(value)||Number(value)<0) throw new Error(`译文的${label}必须是非负整数。`)
  return Number(value)
}
function safeBoundary(text:string,offset:number) {return !(offset>0&&offset<text.length&&/[\uD800-\uDBFF]/.test(text[offset-1])&&/[\uDC00-\uDFFF]/.test(text[offset]))}
export function translationCoverage(chapter:Chapter,segments:readonly TranslationSegment[]) {
  const total=chapter.paragraphs.reduce((n,text,i)=>n+(paragraphIsText(chapter,i)?textWeight(text):0),0)
  const covered=segments.reduce((n,segment)=>n+textWeight(segment.sourceText),0)
  return {total,covered,complete:covered===total,percent:total?Math.min(100,Math.round(covered/total*100)):0}
}
export async function validateChapterTranslation(value:unknown,book:Book,index:number):Promise<ChapterTranslation> {
  const input=object(value),chapter=book.chapters[index],identity=object(input.identity)
  if(!chapter||input.schemaVersion!==1||input.chapterIndex!==index||input.chapterTitle!==chapter.title) throw new Error('译文章节编号或标题与原书不匹配。')
  if(identity.sourceHash!==await chapterHash(chapter)) throw new Error('译文章节原文校验失败，请重新导出当前小说的模板。')
  if(identity.sourceLanguage!=='zh'||identity.targetLanguage!=='en') throw new Error('当前译文包仅支持中文原文 → 英文。')
  if(input.status!=='partial'&&input.status!=='complete') throw new Error('译文完成状态无效。')
  if(!Array.isArray(input.segments)||input.segments.length>TRANSLATION_LIMITS.chapterSegments) throw new Error('译文片段数量无效或过多。')
  const ids=new Set<string>(),ranges:{paragraph:number;start:number;end:number}[]=[],segments:TranslationSegment[]=[]
  for(const value of input.segments) {
    const item=object(value),range=object(item.source),id=string(item.id,'片段编号')
    if(!id.trim()||ids.has(id)) throw new Error('译文片段编号为空或重复。');ids.add(id)
    const paragraph=integer(range.paragraph,'段落编号'),start=integer(range.start,'起始位置'),end=integer(range.end,'结束位置')
    const source=chapter.paragraphs[paragraph]
    if(source===undefined||!paragraphIsText(chapter,paragraph)||start>=end||end>source.length||!safeBoundary(source,start)||!safeBoundary(source,end)) throw new Error('译文原文范围越界、指向图片或拆开了字符。')
    const sourceText=string(item.sourceText,'对应原文',12000),targetText=string(item.targetText,'英文内容',TRANSLATION_LIMITS.target)
    if(sourceText!==source.slice(start,end)||!textWeight(sourceText)) throw new Error('译文片段与对应中文原文不一致。')
    ranges.push({paragraph,start,end})
    if(!targetText.trim()) continue // Unfilled template segments are genuinely missing.
    if(!/[a-z]/i.test(targetText)||/[\u3400-\u9fff]/u.test(sourceText)&&targetText.trim()===sourceText.trim()) throw new Error('译文片段没有可用英文，不能用中文原文冒充译文。')
    if((targetText.match(/[\u3400-\u9fff]/gu)?.length??0)>6 && (targetText.match(/[\u3400-\u9fff]/gu)?.length??0)>(targetText.match(/[a-z]/gi)?.length??0)*.25) throw new Error('译文仍以中文为主，请填写真正的英文译文（可保留少量人物名称）。')
    if(targetText.length>Math.max(500,sourceText.length*20)||/\u0000/.test(targetText)) throw new Error('译文片段长度异常或含无效字符。')
    segments.push({id,chapterId:chapter.id,source:{paragraph,start,end},sourceText,targetText})
  }
  ranges.sort((a,b)=>a.paragraph-b.paragraph||a.start-b.start)
  for(let i=1;i<ranges.length;i++) if(ranges[i].paragraph===ranges[i-1].paragraph&&ranges[i].start<ranges[i-1].end) throw new Error('译文原文范围重叠，无法安全对应。')
  if(segments.reduce((total,item)=>total+item.targetText.length,0)>TRANSLATION_LIMITS.chapterText) throw new Error('单章译文超过 120,000 字符，已停止导入以保护设备内存。')
  segments.sort((a,b)=>a.source.paragraph-b.source.paragraph||a.source.start-b.source.start)
  const coverage=translationCoverage(chapter,segments)
  if(input.status==='complete'&&!coverage.complete) throw new Error('译文标注为完整，但仍有未翻译的正文。请补齐或将状态设为 partial。')
  return {schemaVersion:1,chapterId:chapter.id,chapterIndex:index,chapterTitle:chapter.title,identity:{sourceHash:identity.sourceHash as string,sourceLanguage:'zh',targetLanguage:'en',provider:string(identity.provider,'提供者'),modelVersion:string(identity.modelVersion,'模型版本'),configurationHash:string(identity.configurationHash,'配置版本'),contextHash:string(identity.contextHash,'上下文版本')},status:coverage.complete?'complete':'partial',segments,updatedAt:typeof input.updatedAt==='string'&&input.updatedAt.length<60&&Number.isFinite(Date.parse(input.updatedAt))?input.updatedAt:new Date().toISOString()}
}
export async function validateTranslationPackage(value:unknown,book:Book):Promise<TranslationPackage> {
  const input=object(value),reference=object(input.book),expected=await bookIdentity(book)
  if(input.format!=='cijing-translations'||input.schemaVersion!==1) throw new Error('不支持的译文包格式或版本。请使用词境导出的 JSON 模板。')
  if(reference.sourceHash!==expected.sourceHash||reference.chapterCount!==expected.chapterCount) throw new Error('译文包与这本小说的原文或章节结构不匹配。')
  if(!Array.isArray(input.chapters)||!input.chapters.length||input.chapters.length>book.chapters.length) throw new Error('译文章节列表为空或无效。')
  const seen=new Set<number>(),chapters:ChapterTranslation[]=[];let total=0
  for(const value of input.chapters) {
    const raw=object(value),index=integer(raw.chapterIndex,'章节序号')
    if(seen.has(index)) throw new Error('译文包包含重复章节。');seen.add(index)
    const translation=await validateChapterTranslation(raw,book,index);total+=translation.segments.length
    if(total>TRANSLATION_LIMITS.segments) throw new Error('译文包片段过多，请分章节导入。')
    if(translation.segments.length) chapters.push(translation)
    if(chapters.length%20===0) await new Promise(resolve=>setTimeout(resolve,0))
  }
  if(!total) throw new Error('模板尚未填写英文译文，未保存任何内容。')
  return {format:'cijing-translations',schemaVersion:1,book:expected,chapters}
}
export async function parseTranslationFile(file:File,book:Book) {
  if(file.size>TRANSLATION_LIMITS.file) throw new Error('译文 JSON 最大支持 20 MB，请分章节导入。')
  let value:unknown
  try {value=JSON.parse((await file.text()).replace(/^\uFEFF/,''))} catch {throw new Error('无法读取译文 JSON，文件可能损坏。')}
  return validateTranslationPackage(value,book)
}
export function translationBlob(value:TranslationPackage) {
  const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'})
  if(blob.size>TRANSLATION_LIMITS.file) throw new Error('导出结果超过 20 MB，请选择当前章节。')
  return blob
}

export const translationExchange:TranslationExchange={import:parseTranslationFile,export:translationBlob}
