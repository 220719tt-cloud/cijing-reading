import type { Book, Chapter, ReadingBlock } from '../../shared/types/book'
import type { LearningWord } from '../vocabulary/types'
import type { ReadingPosition } from '../reading/readingPosition'
import { normalizePreferences } from '../reading/readerPreferences.ts'
import { BACKUP_LIMITS, SETTING_KEYS } from './types.ts'
export function obj(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('备份数据结构无效。')
  return value as Record<string,unknown>
}
export function str(value:unknown,name:string,max=500) {
  if(typeof value!=='string'||value.length>max||value.includes('\0'))throw new Error(`备份${name}无效或过长。`)
  return value
}
export function id(value:unknown) {
  const result=str(value,'编号',16000)
  if(!result.trim()||['__proto__','constructor','prototype'].includes(result))throw new Error('备份编号无效。')
  return result
}
export function arr(value:unknown,max=BACKUP_LIMITS.records):unknown[] {
  if(!Array.isArray(value)||value.length>max)throw new Error('备份条目数量无效或过多。')
  return value
}
export function integer(value:unknown,max:number) {
  if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>max)throw new Error('备份位置或数量越界。')
  return Number(value)
}
export function unique<T>(items:T[],key:(item:T)=>string):T[] {
  const keys=items.map(key)
  if(new Set(keys).size!==keys.length)throw new Error('备份存在重复编号，不能安全恢复。')
  return items
}
export function learning(value:unknown):LearningWord {
  const raw=obj(value),kind=raw.kind
  if(kind!==undefined&&!['word','phrase','sentence'].includes(String(kind)))throw new Error('备份学习记录类型无效。')
  const word=str(raw.word,'英文',120000),translation=str(raw.translation,'中文释义',120000)
  if(!word.trim())throw new Error('备份英文内容为空。')
  return {id:id(raw.id),word,translation,phonetic:str(raw.phonetic,'音标'),...(kind?{kind:kind as LearningWord['kind']}:{})}
}
export function validateBook(value:unknown,resources:Book['resources']):Book {
  const raw=obj(value)
  if(raw.schemaVersion!==1||!['txt','epub','sample'].includes(String(raw.source)))throw new Error('不支持的小说备份版本。')
  const assetIds=new Set(resources?.map(asset=>asset.id)??[])
  const chapters=unique(arr(raw.chapters,20000).map(value=>{
    const c=obj(value),paragraphs=arr(c.paragraphs,20000).map(text=>str(text,'段落',12000))
    if(!paragraphs.length||paragraphs.reduce((n,text)=>n+text.length+2,0)>16000)throw new Error('备份单章过大或为空，无法安全分页。')
    let blocks:ReadingBlock[]|undefined
    if(c.blocks!==undefined) {
      if(arr(c.blocks,20000).length!==paragraphs.length)throw new Error('EPUB文字块与原文段落不一致。')
      blocks=(c.blocks as unknown[]).map((value,index)=>{
        const b=obj(value),kind=String(b.kind)
        if(!['paragraph','heading','quote','pre','image'].includes(kind)||b.text!==paragraphs[index])throw new Error('EPUB备份文字块无效。')
        const block:ReadingBlock={kind:kind as ReadingBlock['kind'],text:paragraphs[index]}
        if(b.level!==undefined){block.level=integer(b.level,6);if(!block.level)throw new Error('标题层级无效。')}
        if(b.alt!==undefined)block.alt=str(b.alt,'图片描述',1000)
        if(b.resourceId!==undefined){block.resourceId=id(b.resourceId);if(!assetIds.has(block.resourceId))throw new Error('EPUB备份缺少正文图片。')}
        if(kind==='image'&&(block.text!=='\ufffc'||!block.resourceId))throw new Error('EPUB图片位置无效。')
        if(b.marks!==undefined) block.marks=arr(b.marks,20000).map(value=>{const m=obj(value),start=integer(m.start,block.text.length),end=integer(m.end,block.text.length);if(start>=end||!['strong','em','code'].includes(String(m.kind)))throw new Error('EPUB文字格式范围无效。');return {start,end,kind:m.kind as 'strong'|'em'|'code'}})
        return block
      })
    }
    return {id:id(c.id),title:str(c.title,'章节标题'),order:integer(c.order,20000),paragraphs,...(blocks?{blocks}:{})} satisfies Chapter
  }),chapter=>chapter.id)
  if(!chapters.length)throw new Error('备份小说没有章节。')
  const book:Book={schemaVersion:1,id:id(raw.id),title:str(raw.title,'书名'),author:str(raw.author,'作者'),source:raw.source as Book['source'],importedAt:str(raw.importedAt,'导入时间',80),palette:['mist','moon','forest'].includes(String(raw.palette))?raw.palette as Book['palette']:'mist',genre:str(raw.genre,'分类'),chapters}
  for(const key of ['language','originalFileName','encoding'] as const)if(raw[key]!==undefined)book[key]=str(raw[key],key)
  if(raw.demoProgress!==undefined)book.demoProgress=integer(raw.demoProgress,100)
  if(raw.importBytes!==undefined)book.importBytes=integer(raw.importBytes,BACKUP_LIMITS.expanded)
  if(resources?.length)book.resources=resources
  if(raw.coverResourceId!==undefined){book.coverResourceId=id(raw.coverResourceId);if(!assetIds.has(book.coverResourceId))throw new Error('备份缺少封面。')}
  if(raw.importWarnings!==undefined)book.importWarnings=arr(raw.importWarnings,1000).map(value=>str(value,'提示',1000))
  if(raw.toc!==undefined)book.toc=unique(arr(raw.toc,20000).map(value=>{
    const t=obj(value),chapterId=id(t.chapterId),chapter=chapters.find(chapter=>chapter.id===chapterId)
    if(!chapter)throw new Error('备份目录指向不存在的章节。')
    const paragraph=integer(t.paragraph,chapter.paragraphs.length-1),offset=integer(t.offset,chapter.paragraphs[paragraph].length)
    return {id:id(t.id),title:str(t.title,'目录标题'),chapterId,paragraph,offset,depth:integer(t.depth,30)}
  }),item=>item.id)
  return book
}
export function validatePosition(value:unknown,book:Book):ReadingPosition {
  const p=obj(value),chapterId=id(p.chapterId),chapter=book.chapters.find(chapter=>chapter.id===chapterId)
  if(!chapter)throw new Error('备份阅读进度与章节不匹配。')
  const paragraph=integer(p.paragraph,chapter.paragraphs.length-1),offset=integer(p.offset,chapter.paragraphs[paragraph].length)
  const result:ReadingPosition={chapterId,paragraph,offset}
  if(p.rendition!==undefined){const r=obj(p.rendition);result.rendition={fingerprint:str(r.fingerprint,'显示位置',200),offset:integer(r.offset,300000)}}
  return result
}
export function validateSettings(value:unknown) {
  const settings=obj(value),result:Record<string,string>={}
  for(const [key,value] of Object.entries(settings)) {
    if(!(SETTING_KEYS as readonly string[]).includes(key))throw new Error('备份包含不允许恢复的设置。')
    const text=str(value,'设置',3000)
    if(key==='cijing-theme'&&!['light','dark'].includes(text))throw new Error('备份主题无效。')
    if(key==='cijing-font-size'&&(!Number.isFinite(Number(text))||Number(text)<14||Number(text)>32))throw new Error('备份字号无效。')
    result[key]=key==='cijing-reader-preferences'?JSON.stringify(normalizePreferences(JSON.parse(text))):text
  }
  return result
}
