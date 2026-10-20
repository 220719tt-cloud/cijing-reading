import type {Book} from '../../../shared/types/book'
import type {ChapterTranslation,TranslationSegment,TranslationFailure} from '../types'
import type {BatchRequest,Glossary} from './protocol'
import {AUTO_LIMITS,AUTO_VERSION,MODEL} from './protocol.ts'
import {localNeutralTarget} from '../neutral.ts'
import {chapterHash,paragraphIsText,translationCoverage} from '../package.ts'
import {translationRanges} from './segments.ts'
import {contentHash} from '../hash.ts'
import {readChapterTranslation,saveChapterTranslation} from '../storage.ts'
import {requestTranslation} from './client.ts'
import {skippable,TranslationRequestError} from './errors.ts'
import {validateAvailableResult} from './availableResult.ts'
import {AUTO_POLICY,translationScheduler} from './scheduler.ts'
import {createNetworkRecovery,NETWORK_POLICY,transportFailure} from './networkRecovery.ts'
import type {NetworkRecoveryOptions} from './networkRecovery.ts'
export interface AutoProgress{done:number;total:number;percent:number;succeeded?:number;remaining?:number;failed?:number;pending?:number;requests?:number;requestLimit?:number;stage?:'translating'|'waiting'|'reconnecting'|'complete'|'partial';networkRetries?:number;networkProbes?:number;skipped?:number;processed?:number;processedPercent?:number;waitSeconds?:number;modelFailures?:number;lastModelError?:string;lastModelReason?:string}
export const overlapsFailure=(source:TranslationSegment['source'],failure:TranslationFailure)=>source.paragraph===failure.source.paragraph&&source.start<failure.source.end&&source.end>failure.source.start
export interface AutoOptions{endpoint:string;signal:AbortSignal;paragraph:number;offset:number;onUpdate:(translation:ChapterTranslation)=>void;onProgress:(value:AutoProgress)=>void;request?:typeof requestTranslation;retryFailures?:boolean;networkRecovery?:NetworkRecoveryOptions;schedule?:(signal:AbortSignal,onWait:(ms:number)=>void)=>Promise<void>}
function abort(signal:AbortSignal){if(signal.aborted)throw new DOMException('翻译已停止。','AbortError')}
export function missingSegments(book:Book,index:number,cached:ChapterTranslation|undefined){
  const chapter=book.chapters[index],result:TranslationSegment[]=[]
  chapter.paragraphs.forEach((text,paragraph)=>{
    if(!paragraphIsText(chapter,paragraph))return
    const covered=(cached?.segments??[]).filter(item=>item.source.paragraph===paragraph).sort((a,b)=>a.source.start-b.source.start)
    let cursor=0
    const add=(start:number,end:number)=>{for(const range of translationRanges(text.slice(start,end))){const a=start+range.start,b=start+range.end;result.push({id:`auto-p${paragraph}-${a}-${b}`,chapterId:chapter.id,source:{paragraph,start:a,end:b},sourceText:text.slice(a,b),targetText:''})}}
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
  let segments=[...(cached?.segments??[])],failures=[...(cached?.failures??[])]
  let requests=0,stage:AutoProgress['stage']='translating',waitSeconds=0,modelFailures=0,lastModelError='',lastModelReason=''
  const missing=missingSegments(book,index,cached)
  const queue=missing.filter(item=>options.retryFailures||!failures.some(f=>overlapsFailure(item.source,f)))
  const requestLimit=Math.min(AUTO_POLICY.maxRequests,queue.length+NETWORK_POLICY.retries)
  const recovery=createNetworkRecovery(options.endpoint,signal,options.networkRecovery)
  const report=()=>{
    const c=translationCoverage(chapter,segments)
    const uncovered=missingSegments(book,index,cached),todo=uncovered.filter(item=>!failures.some(f=>overlapsFailure(item.source,f))).length
    options.onProgress({done:c.covered,total:c.total,percent:c.percent,succeeded:segments.length,remaining:uncovered.length,failed:failures.length,pending:todo,skipped:uncovered.length-todo,processed:segments.length+uncovered.length-todo,processedPercent:todo?Math.min(99,Math.round((segments.length+uncovered.length-todo)/Math.max(1,segments.length+uncovered.length)*100)):100,requests,requestLimit,stage,networkRetries:recovery.retries,networkProbes:recovery.probes,waitSeconds,modelFailures,lastModelError,lastModelReason})
    if(cached)options.onUpdate(cached)
  }
  report()
  if(cached?.status==='complete'||!translationCoverage(chapter,[]).total)return cached
  const previous=index>0?await readChapterTranslation(book,book.chapters[index-1]).catch(()=>undefined):undefined
  let glossary:Glossary={...previous?.glossary,...cached?.glossary}
  const contextPrefix=index>0?book.chapters[index-1].paragraphs.join('\n').slice(-500):''
  const priority=options.paragraph*20000+options.offset
  queue.sort((a,b)=>{
    if(options.retryFailures){const failed=(s:TranslationSegment)=>failures.some(f=>overlapsFailure(s.source,f))?0:1;const difference=failed(a)-failed(b);if(difference)return difference}
    const order=(item:TranslationSegment)=>{if(item.source.paragraph===options.paragraph&&item.source.start<=options.offset&&item.source.end>options.offset)return -1;const n=item.source.paragraph*20000+item.source.start;return n>=priority?n-priority:n-priority+chapter.paragraphs.length*20000}
    return order(a)-order(b)
  })
  async function persist(context:string,usedAI:boolean){
    const provider=usedAI?(cached&&!['cloudflare-workers-ai','source-neutral-copy'].includes(cached.identity.provider)?'mixed-user-cloudflare':'cloudflare-workers-ai'):(cached?.identity.provider??'source-neutral-copy')
    const input:ChapterTranslation={schemaVersion:1,chapterId:chapter.id,chapterIndex:index,chapterTitle:chapter.title,status:'partial',identity:{sourceHash:await chapterHash(chapter),sourceLanguage:'zh',targetLanguage:'en',provider,modelVersion:usedAI?MODEL:(cached?.identity.modelVersion??'none'),configurationHash:AUTO_VERSION,contextHash:await contentHash(contextPrefix+JSON.stringify(glossary)+context.slice(0,100))},segments,glossary,...(failures.length?{failures}:{}),updatedAt:new Date().toISOString()}
    abort(signal);cached=await saveChapterTranslation(book,index,input,cached??null);abort(signal)
    segments=cached.segments;failures=cached.failures??[];report()
  }
  async function mark(items:TranslationSegment[],code:string,attempts:number,context:string,reason?:string){
    for(const item of items){
      const old=failures.find(f=>overlapsFailure(item.source,f))
      failures=failures.filter(f=>!overlapsFailure(item.source,f))
      failures.push({source:item.source,code,attempts:Math.min(9999,(old?.attempts??0)+attempts),failedAt:new Date().toISOString(),...(reason?{reason}:{})})
    }
    await persist(context,false)
  }
  function contextFor(batch:TranslationSegment[],compact=false){
    const first=batch[0].source.paragraph,last=batch.at(-1)!.source.paragraph
    const radius=compact?200:450
    // Only neighbouring story, not a repeated opening/blurb from far away.
    // The requested text already has its own field; do not translate it twice as context.
    const before=(chapter.paragraphs.slice(Math.max(0,first-2),first).join('\n')+'\n'+chapter.paragraphs[first].slice(0,batch[0].source.start)).slice(-radius)
    const after=(chapter.paragraphs[last].slice(batch.at(-1)!.source.end)+'\n'+chapter.paragraphs.slice(last+1,last+3).join('\n')).slice(0,radius)
    return (first===0?contextPrefix.slice(-200)+'\n':'')+before+'\n'+after
  }
  async function add(batch:TranslationSegment[],result:{translations:{id:string;text:string}[]},context:string,usedAI:boolean){
    const usedIds=new Set(segments.map(s=>s.id))
    const added=batch.map(item=>{let id=item.id;while(usedIds.has(id))id+='-a';usedIds.add(id);return {...item,id,targetText:usedAI?result.translations.find(t=>t.id===item.id)!.text:localNeutralTarget(item.sourceText)!}})
    failures=failures.filter(f=>!batch.some(item=>overlapsFailure(item.source,f)))
    segments=[...segments,...added];await persist(context,usedAI)
  }
  async function translateBatch(batch:TranslationSegment[]):Promise<void>{
    abort(signal)
    const context=contextFor(batch,!!options.retryFailures)
    const neutral=batch.filter(item=>localNeutralTarget(item.sourceText)!==undefined)
    if(neutral.length)await add(neutral,{translations:[]},context,false)
    const pending=batch.filter(item=>localNeutralTarget(item.sourceText)===undefined)
    if(!pending.length)return
    if(requests>=requestLimit)throw new TranslationRequestError('REQUEST_BUDGET_PAUSED','本轮调用已达到安全上限，翻译已暂停；成功缓存保留，未处理句组仍待翻译，可稍后手动继续。')
    stage='translating';waitSeconds=0;report()
    const onWait=(ms:number)=>{stage='waiting';waitSeconds=Math.ceil(ms/1000);report()}
    await (options.schedule?options.schedule(signal,onWait):translationScheduler.start(options.endpoint,signal,onWait));abort(signal)
    stage='translating';waitSeconds=0;requests++;report()
    const story=context+'\n'+pending.map(s=>s.sourceText).join('\n')
    const relevantGlossary=Object.fromEntries(Object.entries(glossary).filter(([name])=>story.includes(name)))
    const request:BatchRequest={version:1,segments:pending.map((s,i)=>({id:`s${i}`,text:s.sourceText})),context,glossary:relevantGlossary}
    let result
    try{
      const response=await (options.request??requestTranslation)(options.endpoint,request,signal);abort(signal)
      try{result=validateAvailableResult(response,request)}catch{throw new TranslationRequestError('MODEL_ALIGNMENT_INVALID','返回句组未通过严格对应校验。')}
    }catch(error){
      abort(signal)
      if(error instanceof TranslationRequestError&&error.status===429)translationScheduler.defer(options.endpoint,error.retryAfter)
      if(transportFailure(error)){
        // Never turn network-interrupted or untouched text into skipped/model failures.
        stage='reconnecting';report()
        if(requests>=requestLimit||!await recovery.recover(ms=>{stage='reconnecting';waitSeconds=Math.ceil(ms/1000);report()})){
          throw new TranslationRequestError(error.code,'网络恢复尝试已达上限，翻译已暂停。成功译文已保存，未完成句组仍待翻译；可稍后点击「继续翻译本章」。',error.status)
        }
        abort(signal)
        // A cache update in another tab during the outage must also be respected.
        cached=await readChapterTranslation(book,chapter);abort(signal)
        segments=[...(cached?.segments??[])];failures=[...(cached?.failures??[])]
        glossary={...previous?.glossary,...cached?.glossary}
        const missing=missingSegments(book,index,cached)
        const stillMissing=(items:TranslationSegment[])=>items.flatMap(original=>missing.filter(item=>item.source.paragraph===original.source.paragraph&&item.source.start>=original.source.start&&item.source.end<=original.source.end&&(options.retryFailures||!failures.some(f=>overlapsFailure(item.source,f)))))
        queue.splice(0,queue.length,...stillMissing(queue))
        const retry=stillMissing(pending);stage='translating';waitSeconds=0;report()
        // Recursion is bounded by the shared two-retry budget, only for transport faults.
        if(retry.length)await translateBatch(retry)
        return
      }
      // Auth, quota and storage faults still stop safely. Ordinary model
      // faults mark this batch once and return to the *remaining* queue, never recurse.
      if(!skippable(error))throw error
      modelFailures++;lastModelError=error.code;lastModelReason=error.reason??''
      await mark(pending,error.code,1,context,error.reason);return
    }
    const merged={...result.glossary,...glossary};glossary=Object.fromEntries(Object.entries(merged).slice(-AUTO_LIMITS.glossary))
    const confirmed=pending.filter((_,i)=>result.translations.some(t=>t.id===`s${i}`))
    const mapped={translations:confirmed.map(item=>({id:item.id,text:result.translations.find(t=>t.id===`s${pending.indexOf(item)}`)!.text}))}
    // Save independently confirmed successes BEFORE recording skipped siblings.
    // A subsequent storage failure must not roll back a successful earlier write.
    if(confirmed.length)await add(confirmed,mapped,context,true)
    const skipped=pending.filter(item=>!confirmed.includes(item))
    if(skipped.length){modelFailures++;lastModelError='MODEL_ALIGNMENT_INVALID';lastModelReason='TARGET_VALIDATION';await mark(skipped,lastModelError,1,context,lastModelReason)}
  }
  // Decide risky dialogue grouping BEFORE its only request, using the already
  // deployed single-text Worker path. A failed batch is never split or resent.
  const dialogue=(item:TranslationSegment)=>/[“”「」『』"]/.test(item.sourceText)
  while(queue.length){
    abort(signal)
    if(queue[0].sourceText.length>AUTO_LIMITS.singleSource){await mark([queue.shift()!],'SOURCE_TOO_LONG',0,'');continue}
    const batch:TranslationSegment[]=[];let size=0
    const retrySingle=dialogue(queue[0])||options.retryFailures&&failures.some(f=>overlapsFailure(queue[0].source,f))
    const max=retrySingle||queue[0].sourceText.length>AUTO_POLICY.source?AUTO_LIMITS.singleSource:AUTO_POLICY.source
    while(queue.length&&batch.length<(max===AUTO_LIMITS.singleSource?1:AUTO_POLICY.segments)&&size+queue[0].sourceText.length<=max){if(batch.length&&(dialogue(queue[0])||queue[0].source.paragraph<batch.at(-1)!.source.paragraph))break;const item=queue.shift()!;batch.push(item);size+=item.sourceText.length}
    await translateBatch(batch)
  }
  stage=translationCoverage(chapter,segments).complete?'complete':'partial';report()
  return cached
}
