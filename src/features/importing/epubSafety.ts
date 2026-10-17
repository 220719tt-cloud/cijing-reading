import { decodeHTMLStrict } from 'entities'
export function archivePath(base: string, href: string) {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href) || /[\\\u0000]/.test(href)) throw new Error('EPUB 含不支持的外部资源路径。')
  const raw=href.split(/[?#]/)[0]
  let decoded: string
  try {decoded=decodeURIComponent(raw)} catch {throw new Error('EPUB 的资源路径编码损坏。')}
  if (/[\\\u0000]/.test(decoded) || decoded.includes(':')) throw new Error('EPUB 资源路径不安全。')
  const parts=decoded.startsWith('/') ? [] : base.split('/').slice(0,-1)
  for(const part of decoded.split('/')) {
    if (!part || part==='.') continue
    if (part==='..') {if(!parts.length) throw new Error('EPUB 资源路径越界。');parts.pop()}
    else parts.push(part)
  }
  return parts.join('/')
}
export function decodeEpubXml(bytes: Uint8Array) {
  const encoding=bytes[0]===255&&bytes[1]===254 || bytes[0]===60&&bytes[1]===0 ? 'utf-16le' : bytes[0]===254&&bytes[1]===255 || bytes[0]===0&&bytes[1]===60 ? 'utf-16be' : 'utf-8'
  return new TextDecoder(encoding,{fatal:true}).decode(bytes)
}
export function parseEpubXml(text: string, name: string): XMLDocument {
  // Never resolve DTDs/entities. Standard HTML named entities become numeric text
  // references, without decoding &lt;script&gt; into executable markup.
  if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(text)) throw new Error(`EPUB ${name} 含不支持的自定义 XML 实体。`)
  text=text.replace(/<!DOCTYPE[^>]*>/gi,'').replace(/&([a-z][a-z0-9]+);/gi,(entity,name:string)=>{
    if (['amp','lt','gt','quot','apos'].includes(name)) return entity
    const decoded=decodeHTMLStrict(entity)
    return decoded===entity ? entity : Array.from(decoded).map(char=>`&#${char.codePointAt(0)};`).join('')
  })
  const doc=new DOMParser().parseFromString(text,'application/xml')
  if (!doc.documentElement || doc.getElementsByTagName('parsererror').length) throw new Error(`EPUB ${name} 的 XML／正文已损坏，无法解析。`)
  // Bound traversal before EPUB.js or the content extractor recurses into it.
  const pending: { node: Element; depth: number }[] = [{ node: doc.documentElement, depth: 0 }]
  let count = 0
  while (pending.length) {
    const { node, depth } = pending.pop()!
    if (++count > 60000 || depth > 128) throw new Error(`EPUB ${name} 的 XML 结构过于复杂，已停止解析。`)
    for (let child = node.firstElementChild; child; child = child.nextElementSibling) pending.push({ node: child, depth: depth + 1 })
  }
  return doc
}
export function rasterMime(bytes: Uint8Array) {
  if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71) return 'image/png'
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255) return 'image/jpeg'
  const head=String.fromCharCode(...bytes.slice(0,16))
  if(/^GIF8[79]a/.test(head)) return 'image/gif'
  if(head.startsWith('RIFF')&&head.slice(8,12)==='WEBP') return 'image/webp'
  if(head.slice(4,8)==='ftyp'&&/avif|avis/.test(head.slice(8))) return 'image/avif'
  return null
}
export function decodeRasterData(href:string,limit:number):Uint8Array|null {
  if(!href.startsWith('data:')) return null
  const match=href.match(/^data:image\/(?:png|jpeg|gif|webp|avif);base64,([a-z0-9+/=\s]+)$/i)
  if(!match) throw new Error('EPUB 内嵌图片格式不受支持。')
  if(match[1].length>limit*1.4) throw new Error('EPUB 内嵌图片过大。')
  const bytes=Uint8Array.from(atob(match[1].replace(/\s/g,'')),char=>char.charCodeAt(0))
  if(!rasterMime(bytes)) throw new Error('EPUB 内嵌图片内容损坏。')
  return bytes
}
export function base64(bytes: Uint8Array) {
  const pieces=[]
  for(let i=0;i<bytes.length;i+=16384) pieces.push(String.fromCharCode(...bytes.subarray(i,i+16384)))
  return btoa(pieces.join(''))
}
const svgTags=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','defs','linearGradient','radialGradient','stop','clipPath','use','image'])
const svgAttrs=new Set(['id','viewBox','width','height','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','d','points','fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','opacity','transform','gradientTransform','gradientUnits','offset','stop-color','stop-opacity','clip-path','font-size','font-family','text-anchor','preserveAspectRatio','dx','dy'])
export async function safeSvg(doc: XMLDocument, raster: (href:string)=>Promise<string|null>) {
  if(doc.documentElement.localName!=='svg') throw new Error('不是 SVG 图片')
  const output=document.implementation.createDocument('http://www.w3.org/2000/svg','svg',null)
  let count=0
  async function copy(element: Element, parent: Element) {
    if(++count>10000) throw new Error('SVG 图片过大，结构过于复杂。')
    if(!svgTags.has(element.localName)) return
    const node=element===doc.documentElement ? output.documentElement : output.createElementNS('http://www.w3.org/2000/svg',element.localName)
    for(const attr of Array.from(element.attributes)) if(svgAttrs.has(attr.name) && attr.value.length<100000 && !/[<>\\\u0000-\u001f]|(?:https?:|data:|javascript:|\/\/)/i.test(attr.value) && (!/url\s*\(/i.test(attr.value)||/^url\(#[\w.-]+\)$/.test(attr.value))) node.setAttribute(attr.name,attr.value)
    const href=element.getAttribute('href') || element.getAttribute('xlink:href')
    if(element.localName==='image'&&href) {const uri=await raster(href);if(uri) node.setAttribute('href',uri)}
    if(element.localName==='use'&&href&&/^#[\w.-]+$/.test(href)) node.setAttribute('href',href)
    if(node!==output.documentElement) parent.appendChild(node)
    for(const child of Array.from(element.childNodes)) {
      if(child.nodeType===1) await copy(child as Element,node)
      else if(child.nodeType===3&&['text','tspan'].includes(element.localName)) node.appendChild(output.createTextNode(child.textContent??''))
    }
  }
  await copy(doc.documentElement,output.documentElement)
  return new XMLSerializer().serializeToString(output)
}
