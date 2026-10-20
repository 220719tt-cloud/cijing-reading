import {AUTO_LIMITS,MODEL,validateBatchResult} from '../src/features/translation/automatic/protocol.ts'
import type {BatchRequest,BatchResult} from '../src/features/translation/automatic/protocol.ts'
import {validateAvailableResult} from '../src/features/translation/automatic/availableResult.ts'

export class ModelOutputError extends Error{
  readonly code:string
  readonly reason:string
  constructor(code:string,reason:string){super('模型输出未通过校验。');this.code=code;this.reason=reason}
}
const invalid=(code:string,reason:string):never=>{throw new ModelOutputError(code,reason)}
/** Fixed diagnostics only. Never return a model response, prompt, name or story in errors. */
export function checkedModelOutput(raw:unknown,batch:BatchRequest,allowPartial=false):BatchResult{
  const output=raw as {response?:unknown;choices?:{message?:{content?:unknown};finish_reason?:string}[];finish_reason?:string}
  const result=output?.response??output?.choices?.[0]?.message?.content
  const finish=output?.choices?.[0]?.finish_reason??output?.finish_reason
  if(finish==='length'||finish==='max_tokens')invalid('MODEL_OUTPUT_INVALID','TOKEN_LIMIT')
  if(!result)invalid('MODEL_OUTPUT_INVALID','EMPTY_OUTPUT')
  let size=0
  try{size=new TextEncoder().encode(typeof result==='string'?result:JSON.stringify(result)).length}catch{invalid('MODEL_OUTPUT_INVALID','OUTPUT_SHAPE')}
  if(size>AUTO_LIMITS.outputBytes)invalid('MODEL_OUTPUT_INVALID','OUTPUT_LIMIT')
  let value:unknown=result
  if(typeof result==='string'){
    let content=result.replace(/^\uFEFF/u,'').trim()
    if(content.startsWith('<think>')){
      const end=content.indexOf('</think>')
      if(end<0)invalid('MODEL_OUTPUT_INVALID','INCOMPLETE_THINK_BLOCK')
      content=content.slice(end+8).trim()
    }
    const fenced=content.match(/^```(?:json|text|plaintext|english)?\s*\n([\s\S]*)\n```$/iu)
    if(fenced)content=fenced[1].trim()
    if(!content)invalid('MODEL_OUTPUT_INVALID','EMPTY_OUTPUT')
    if(batch.segments.length===1&&!/^[{[]/u.test(content)){
      // One requested source has one unambiguous ID. The model produces only
      // English prose; JSON.stringify at the HTTP boundary escapes its dialogue.
      // No positional mapping of multi-segment output is ever inferred here.
      if(/```|<\/?think>|"(?:translations|glossary|id|text)"\s*:|^(?:translation\s*[:：]|english\s+translation\s*[:：]|(?:译文|英文翻译)\s*[:：]|here(?:\s+is|'s)\s+(?:the|your)\s+(?:english\s+)?translation|as\s+an\s+ai\b)/iu.test(content))invalid('MODEL_ALIGNMENT_INVALID','EXTRA_OUTPUT')
      if((content.match(/“/gu)?.length??0)!==(content.match(/”/gu)?.length??0))invalid('MODEL_OUTPUT_INVALID','UNBALANCED_DIALOGUE')
      value={translations:[{id:batch.segments[0].id,text:content}],glossary:batch.glossary}
    }else{
      try{value=JSON.parse(content)}catch{invalid('MODEL_JSON_INVALID','INVALID_JSON')}
    }
  }
  if(!value||typeof value!=='object'||Array.isArray(value))invalid('MODEL_ALIGNMENT_INVALID','OUTPUT_SHAPE')
  const decoded=value as Record<string,unknown>
  if(!Array.isArray(decoded.translations)||!allowPartial&&decoded.translations.length!==batch.segments.length)invalid('MODEL_ALIGNMENT_INVALID','SEGMENT_COUNT')
  const ids=(decoded.translations as unknown[]).map(item=>item&&typeof item==='object'&&!Array.isArray(item)?(item as Record<string,unknown>).id:undefined)
  if(!allowPartial&&(ids.some(id=>typeof id!=='string'||!batch.segments.some(s=>s.id===id))||new Set(ids).size!==ids.length))invalid('MODEL_ALIGNMENT_INVALID','SEGMENT_IDS')
  let checked:BatchResult
  try{checked=(allowPartial?validateAvailableResult:validateBatchResult)({...decoded,version:1,model:MODEL},batch)}catch(error){
    const message=error instanceof Error?error.message:''
    if(/人物|术语|译名/.test(message))return invalid('MODEL_GLOSSARY_INVALID','GLOSSARY')
    return invalid('MODEL_ALIGNMENT_INVALID','TARGET_VALIDATION')
  }
  if(batch.segments.length===1){
    const translated=checked.translations[0].text.toLocaleLowerCase('en')
    for(const [name,spelling]of Object.entries(batch.glossary))if(batch.segments[0].text.includes(name)&&/[a-z]/iu.test(spelling)&&!translated.includes(spelling.toLocaleLowerCase('en')))invalid('MODEL_GLOSSARY_INVALID','NAME_SPELLING')
  }
  return checked
}
