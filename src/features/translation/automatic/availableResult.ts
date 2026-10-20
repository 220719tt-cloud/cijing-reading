import type {BatchRequest,BatchResult} from './protocol'
import {AUTO_LIMITS,MODEL,validateBatchResult} from './protocol.ts'

/** Only complete JSON objects with explicit, unique requested IDs can be salvaged.
 * No substring JSON repair, positional inference or extra model call is permitted.
 * Also used by the locally prepared optional Worker revision; no protocol change.
 */
export function validateAvailableResult(value:unknown,request:BatchRequest):BatchResult{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('译文结构无效。')
  const raw=value as Record<string,unknown>
  if(raw.version!==1||raw.model!==MODEL||!Array.isArray(raw.translations)||raw.translations.length>AUTO_LIMITS.segments)throw new Error('译文版本、模型或数量无效。')
  const entries=raw.translations as unknown[],counts=new Map<string,number>()
  for(const item of entries)if(item&&typeof item==='object'&&!Array.isArray(item)&&typeof (item as Record<string,unknown>).id==='string'){
    const id=(item as {id:string}).id;counts.set(id,(counts.get(id)??0)+1)
  }
  const translations:BatchResult['translations']=[]
  let glossary:BatchResult['glossary']={}
  let lastError:unknown
  // Glossary validation still sees exactly the original batch's story, even
  // when one returned entry is being independently validated.
  const context=request.context+'\n'+request.segments.map(s=>s.text).join('\n')
  for(const source of request.segments){
    if(counts.get(source.id)!==1)continue
    const item=entries.find(item=>item&&typeof item==='object'&&(item as {id?:unknown}).id===source.id)
    try{
      const checked=validateBatchResult({...raw,translations:[item]},{...request,segments:[source],context})
      const target=checked.translations[0].text.toLocaleLowerCase('en')
      if(Object.entries(request.glossary).some(([name,spelling])=>source.text.includes(name)&&/[a-z]/iu.test(spelling)&&!target.includes(spelling.toLocaleLowerCase('en')))){lastError=new Error('模型人物译名不一致。');continue}
      translations.push(checked.translations[0]);glossary=checked.glossary
    }catch(error){lastError=error/* Invalid text, names or IDs are skipped, never repaired. */}
  }
  if(!translations.length)throw lastError??new Error('没有可严格对应的有效译文。')
  return {version:1,model:MODEL,translations,glossary}
}
