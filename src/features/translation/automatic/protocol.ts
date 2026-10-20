export const MODEL='@cf/qwen/qwen3-30b-a3b-fp8'
export const AUTO_VERSION='fiction-zh-en-v1'
export const AUTO_LIMITS={requestBytes:32000,segments:8,source:900,singleSource:3000,context:1800,glossary:60,outputBytes:64000}
export type Glossary=Record<string,string>
export interface BatchRequest {version:1;segments:{id:string;text:string}[];context:string;glossary:Glossary}
export interface BatchResult {version:1;model:string;translations:{id:string;text:string}[];glossary:Glossary}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('翻译数据格式错误。');return value as Record<string,unknown>}
function text(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))throw new Error('翻译文本为空或超长。');return value}
export function validateGlossary(value:unknown):Glossary {
  const input=object(value),result:Glossary=Object.create(null)
  if(Object.keys(input).length>AUTO_LIMITS.glossary)throw new Error('人物术语表过大。')
  for(const [key,value]of Object.entries(input)){text(key,80);if(['__proto__','constructor','prototype'].includes(key))throw new Error('术语编号无效。');result[key]=text(value,160)}
  return result
}
export function validateBatch(value:unknown):BatchRequest {
  const raw=object(value)
  if(raw.version!==1||!Array.isArray(raw.segments)||!raw.segments.length||raw.segments.length>AUTO_LIMITS.segments)throw new Error('翻译批次版本或数量错误。')
  const segments=raw.segments.map(item=>{const s=object(item);return {id:text(s.id,100),text:text(s.text,AUTO_LIMITS.singleSource)}})
  if(new Set(segments.map(s=>s.id)).size!==segments.length||segments.reduce((n,s)=>n+s.text.length,0)>(segments.length===1?AUTO_LIMITS.singleSource:AUTO_LIMITS.source))throw new Error('翻译批次重复或过大。')
  if(typeof raw.context!=='string'||raw.context.length>AUTO_LIMITS.context||raw.context.includes('\0'))throw new Error('翻译上下文过大。')
  return {version:1,segments,context:raw.context,glossary:validateGlossary(raw.glossary)}
}
export function neutralCopy(source:string,target:string){return /^[\p{N}\p{P}\p{S}\s]+$/u.test(source)&&source.trim()===target.trim()}
export function validateBatchResult(value:unknown,request:BatchRequest):BatchResult {
  const raw=object(value)
  if(raw.version!==1||raw.model!==MODEL||!Array.isArray(raw.translations)||raw.translations.length!==request.segments.length)throw new Error('译文返回不完整或模型不匹配，请重试。')
  const seen=new Set<string>()
  const translations=raw.translations.map(value=>{const s=object(value),id=text(s.id,100),source=request.segments.find(item=>item.id===id),translated=text(s.text,Math.max(500,(source?.text.length??0)*20))
    if(!source||seen.has(id)||!/[a-z]/i.test(translated)&&!neutralCopy(source?.text??'',translated)||translated.trim()===source.text.trim()&&/[\u3400-\u9fff]/u.test(source.text)||/<(?:script|iframe)\b|<think>/i.test(translated))throw new Error('译文缺失、重复、含异常内容或仍为中文。')
    const chinese=translated.match(/[\u3400-\u9fff]/gu)?.length??0,latin=translated.match(/[a-z]/gi)?.length??0
    if(chinese>6&&chinese>latin*.25)throw new Error('译文仍以中文为主。')
    seen.add(id);return {id,text:translated}
  })
  const glossary=validateGlossary(raw.glossary)
  for(const [key,value]of Object.entries(request.glossary))if(glossary[key]!==undefined&&glossary[key]!==value)throw new Error('模型改变了已有的人物译名，请重试。')
  const story=request.context+'\n'+request.segments.map(s=>s.text).join('\n')
  for(const name of Object.keys(glossary))if(request.glossary[name]===undefined&&!story.includes(name))throw new Error('模型返回了原文上下文中不存在的人物术语。')
  return {version:1,model:MODEL,translations,glossary}
}
/** Size bound applies while streaming, before allocating a JSON string. */
export async function boundedJson(body:ReadableStream<Uint8Array>|null,limit:number):Promise<unknown>{
  if(!body)throw new Error('响应为空。')
  const reader=body.getReader(),chunks:Uint8Array[]=[];let size=0
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('请求或响应过大。');chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes)) as unknown
}
export function translationEndpoint(value:string|undefined,development=false){
  if(!value?.trim())return ''
  const url=new URL(value.trim())
  if(url.username||url.password||url.search||url.hash||url.protocol!=='https:'&&!(development&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('翻译服务必须使用无密钥参数的 HTTPS 地址。')
  return url.href
}
