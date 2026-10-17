import type {Book} from '../../../shared/types/book'
import type {ChapterTranslation,TranslationSegment} from '../types'
import type {BatchRequest,Glossary} from './protocol'
import {AUTO_LIMITS,AUTO_VERSION,MODEL} from './protocol.ts'
import {chapterHash,paragraphIsText,sentenceRanges,translationCoverage} from '../package.ts'
import {contentHash} from '../hash.ts'
import {readChapterTranslation,saveChapterTranslation} from '../storage.ts'
import {requestTranslation} from './client.ts'
export interface AutoProgress{done:number;total:number;percent:number}
export interface AutoOptions{endpoint:string;signal:AbortSignal;paragraph:number;offset:number;onUpdate:(translation:ChapterTranslation)=>void;onProgress:(value:AutoProgress)=>void;request?:typeof requestTranslation}
function abort(signal:AbortSignal){if(signal.aborted)throw new DOMException('翻译已停止。','AbortError')}
export function missingSegments(book:Book,index:number,cached:ChapterTranslation|undefined){
  const chapter=book.chapters[index],result:TranslationSegment[]=[]
  chapter.paragraphs.forEach((text,paragraph)=>{
    if(!paragraphIsText(chapter,paragraph))return
    const covered=(cached?.segments??[]).filter(item=>item.source.paragraph===paragraph).sort((a,b)=>a.source.start-b.source.start)
    let cursor=0
    const add=(start:number,end:number)=>{for(const range of sentenceRanges(text.slice(start,end))){const a=start+range.start,b=start+range.end;result.push({id:`auto-p${paragraph}-${a}-${b}`,chapterId:chapter.id,source:{paragraph,start:a,end:b},sourceText:text.slice(a,b),targetText:''})}}
    for(const item of covered){if(item.source.start>cursor)add(cursor,item.source.start);cursor=item.source.end}
    if(cursor<text.length)add(cursor,text.length)
  })
  return result
}
const queues=new Map<string,Promise<unknown>>()
/** Per-tab serialization prevents duplicate requests, including StrictMode/retry races. */
export function translateChapter(book:Book,index:number,options:AutoOptions):Promise<ChapterTranslation|undefined>{
  const key=`${book.id}:${book.chapters[index].id}`,previous=queues.get(key)??Promise.resolve()
  const task=previous.catch(()=>{}).then(()=>run(book,index,options));queues.set(key,task)
  void task.finally(()=>{if(queues.get(key)===task)queues.delete(key)}).catch(()=>{})
  return task
}
async function run(book:Book,index:number,options:AutoOptions){
  const {signal}=options,chapter=book.chapters[index];abort(signal)
  let cached=await readChapterTranslation(book,chapter);abort(signal)
  const report=()=>{const c=translationCoverage(chapter,cached?.segments??[]);options.onProgress({done:c.covered,total:c.total,percent:c.percent});if(cached)options.onUpdate(cached)}
  report()
  if(cached?.status==='complete'||!translationCoverage(chapter,[]).total)return cached
  const previous=index>0?await readChapterTranslation(book,book.chapters[index-1]).catch(()=>undefined):undefined
  let glossary:Glossary={...previous?.glossary,...cached?.glossary}
  const contextPrefix=index>0?book.chapters[index-1].paragraphs.join('\n').slice(-500):''
  const queue=missingSegments(book,index,cached)
  const priority=options.paragraph*20000+options.offset
  queue.sort((a,b)=>{
    const order=(item:TranslationSegment)=>{if(item.source.paragraph===options.paragraph&&item.source.start<=options.offset&&item.source.end>options.offset)return -1;const n=item.source.paragraph*20000+item.source.start;return n>=priority?n-priority:n-priority+chapter.paragraphs.length*20000}
    return order(a)-order(b)
  })
  let segments=[...(cached?.segments??[])]
  while(queue.length){
    abort(signal)
    if(queue[0].sourceText.length>AUTO_LIMITS.singleSource)throw new Error(`本章存在超过${AUTO_LIMITS.singleSource}字符的单句，无法安全自动分段；请保留原文或导入对应译文。`)
    const batch:TranslationSegment[]=[];let size=0
    const max=queue[0].sourceText.length>AUTO_LIMITS.source?AUTO_LIMITS.singleSource:AUTO_LIMITS.source
    while(queue.length&&batch.length<(max===AUTO_LIMITS.singleSource?1:AUTO_LIMITS.segments)&&size+queue[0].sourceText.length<=max){if(batch.length&&queue[0].source.paragraph<batch.at(-1)!.source.paragraph)break;const item=queue.shift()!;batch.push(item);size+=item.sourceText.length}
    const first=batch[0].source.paragraph,last=batch.at(-1)!.source.paragraph
    const context=(contextPrefix.slice(-350)+'\n'+chapter.paragraphs.slice(0,3).join('\n').slice(0,350)+'\n'+(chapter.paragraphs[first-1]??'').slice(-250)+'\n'+chapter.paragraphs[first].slice(Math.max(0,batch[0].source.start-300),batch[0].source.start+300)+'\n'+(chapter.paragraphs[last+1]??'').slice(0,250)).slice(0,AUTO_LIMITS.context)
    const request:BatchRequest={version:1,segments:batch.map(s=>({id:s.id,text:s.sourceText})),context,glossary}
    const result=await (options.request??requestTranslation)(options.endpoint,request,signal);abort(signal)
    // Existing proper-name choices win; keep the glossary bounded across a long novel.
    const merged={...result.glossary,...glossary};glossary=Object.fromEntries(Object.entries(merged).slice(-AUTO_LIMITS.glossary))
    const usedIds=new Set(segments.map(s=>s.id))
    const added=batch.map(item=>{let id=item.id;while(usedIds.has(id))id+='-a';usedIds.add(id);return {...item,id,targetText:result.translations.find(t=>t.id===item.id)!.text}})
    segments=[...segments,...added]
    const input:ChapterTranslation={schemaVersion:1,chapterId:chapter.id,chapterIndex:index,chapterTitle:chapter.title,status:'partial',identity:{sourceHash:await chapterHash(chapter),sourceLanguage:'zh',targetLanguage:'en',provider:cached&&cached.identity.provider!=='cloudflare-workers-ai'?'mixed-user-cloudflare':'cloudflare-workers-ai',modelVersion:MODEL,configurationHash:AUTO_VERSION,contextHash:await contentHash(contextPrefix+JSON.stringify(glossary))},segments,glossary,updatedAt:new Date().toISOString()}
    abort(signal);cached=await saveChapterTranslation(book,index,input,cached??null);abort(signal);segments=cached.segments;report()
  }
  return cached
}
