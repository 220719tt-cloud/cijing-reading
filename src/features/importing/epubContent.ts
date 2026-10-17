import type { Chapter, ReadingBlock, TextMark } from '../../shared/types/book'
export const IMAGE_CHARACTER = '\ufffc'
const blocked = new Set(['script','style','link','meta','iframe','object','embed','form','input','button','textarea','select','audio','video','source','track','canvas','math','noscript','template'])
const paragraphTags = new Set(['p','h1','h2','h3','h4','h5','h6','pre','li','dt','dd','figcaption','blockquote'])
export const nonBodyTypes = new Set(['toc','cover','titlepage','title-page','copyright-page','copyright','colophon','landmarks','page-list'])
export function epubTypes(element: Element) { return (element.getAttribute('epub:type') ?? element.getAttributeNS('http://www.idpf.org/2007/ops','type') ?? '').split(/\s+/) }
export interface EpubContent { blocks: ReadingBlock[]; anchors: Record<string, { paragraph: number; offset: number }> }
/** Convert a detached XML document to a tiny typed vocabulary. No imported DOM/CSS survives. */
export async function extractEpubContent(doc: Document, image: (href: string, svg?: Element) => Promise<string | null>): Promise<EpubContent> {
  const blocks: ReadingBlock[] = [], anchors: EpubContent['anchors'] = Object.create(null)
  let current: ReadingBlock = {kind:'paragraph',text:''}, marks: TextMark[] = []
  const anchor = (element: Element) => {
    const id = element.getAttribute('id') || element.getAttribute('name')
    if (id) anchors[id] = {paragraph:blocks.length,offset:current.text.length}
  }
  function flush() {
    if (current.kind !== 'pre') current.text = current.text.trimEnd()
    if (current.text) blocks.push({...current, ...(marks.length ? {marks:marks.map(mark=>({...mark,end:Math.min(mark.end,current.text.length)})).filter(mark=>mark.end>mark.start)} : {})})
    current = {kind:'paragraph',text:''}; marks = []
  }
  async function walk(node: Node, active: TextMark['kind'][] = []) {
    if (node.nodeType === 3) {
      let value = node.textContent ?? ''
      if (current.kind !== 'pre') { value = value.replace(/\s+/gu,' '); if (!current.text || current.text.endsWith(' ')) value=value.trimStart() }
      const start = current.text.length; current.text += value
      for (const kind of active) if (value) marks.push({start,end:current.text.length,kind})
      return
    }
    if (node.nodeType !== 1) return
    const element = node as Element, tag = element.localName.toLowerCase()
    if (blocked.has(tag) || tag === 'nav' || element.hasAttribute('hidden') || epubTypes(element).some(type=>nonBodyTypes.has(type))) return
    if (tag === 'img' || tag === 'image' || tag === 'svg') {
      flush(); anchor(element)
      const href=element.getAttribute('src') || element.getAttribute('href') || element.getAttribute('xlink:href') || ''
      const resourceId = await image(href, tag === 'svg' ? element : undefined)
      if (resourceId) blocks.push({kind:'image',text:IMAGE_CHARACTER,resourceId,alt:element.getAttribute('alt') || '正文插图'})
      else blocks.push({kind:'paragraph',text:`[图片暂不可用${element.getAttribute('alt') ? `：${element.getAttribute('alt')!.slice(0,120)}` : ''}]`})
      return
    }
    if (tag === 'br') { current.text += '\n'; return }
    const hasBlockChildren = Array.from(element.children).some(child=>paragraphTags.has(child.localName.toLowerCase()) || ['div','section','article','figure','table'].includes(child.localName.toLowerCase()))
    const isBlock = paragraphTags.has(tag) || ['div','section','article','figure','table','tr','ul','ol'].includes(tag)
    if (isBlock) flush()
    anchor(element)
    if (isBlock && !hasBlockChildren) {
      current.kind = /^h[1-6]$/.test(tag) ? 'heading' : tag === 'pre' ? 'pre' : tag === 'blockquote' || element.parentElement?.closest('blockquote') ? 'quote' : 'paragraph'
      if (current.kind === 'heading') current.level=Number(tag[1])
      if (tag === 'li') current.text = element.parentElement?.localName.toLowerCase()==='ol' ? `${Array.from(element.parentElement.children).indexOf(element)+1}. ` : '• '
    }
    const mark = ['b','strong'].includes(tag) ? 'strong' : ['i','em'].includes(tag) ? 'em' : tag === 'code' ? 'code' : null
    for (const child of Array.from(element.childNodes)) await walk(child,mark ? [...active,mark] : active)
    if (isBlock) flush()
  }
  const body = Array.from(doc.getElementsByTagName('*')).find(el=>el.localName.toLowerCase()==='body')
  if (!body) throw new Error('EPUB 正文缺少 body，文件可能已损坏。')
  await walk(body); flush()
  return {blocks,anchors}
}
/** Keep long XHTML files bounded, retaining paragraph/style offsets and TOC anchors. */
export function splitEpubContent(content: EpubContent, prefix: string, title: string, firstOrder: number) {
  const groups: ReadingBlock[][] = [], positions: {group:number;paragraph:number;from:number;to:number}[][] = []
  let group: ReadingBlock[] = [], length=0
  function push(block: ReadingBlock, original: number, from: number) {
    if (group.length && length+block.text.length+2>12000) { groups.push(group);group=[];length=0 }
    ;(positions[original] ??= []).push({group:groups.length,paragraph:group.length,from,to:from+block.text.length})
    group.push(block);length+=block.text.length+2
  }
  content.blocks.forEach((block,original)=>{
    if (block.text.length<=12000) {push(block,original,0);return}
    for(let from=0;from<block.text.length;){
      let to=Math.min(block.text.length,from+12000)
      if(to<block.text.length) {
        const space=block.text.lastIndexOf(' ',to-1)
        if(space>from+6000) to=space+1
        if(/[\uD800-\uDBFF]/.test(block.text[to-1])) to--
      }
      push({...block,text:block.text.slice(from,to),marks:block.marks?.filter(mark=>mark.end>from&&mark.start<to).map(mark=>({...mark,start:Math.max(0,mark.start-from),end:Math.min(to,mark.end)-from}))},original,from)
      from=to
    }
  })
  if (group.length) groups.push(group)
  const chapters: Chapter[]=groups.map((blocks,index)=>({id:`${prefix}-${index}`,order:firstOrder+index,title:index ? `${title} · 续 ${index}` : title,paragraphs:blocks.map(block=>block.text),blocks}))
  const anchors: Record<string,{chapterId:string;paragraph:number;offset:number}>=Object.create(null)
  for(const [id,position] of Object.entries(content.anchors)) {
    const parts=positions[position.paragraph] ?? positions[positions.length-1]
    if (!parts?.length) continue
    const part=parts.find(part=>position.offset<part.to) ?? parts[parts.length-1]
    anchors[id]={chapterId:chapters[part.group].id,paragraph:part.paragraph,offset:Math.max(0,Math.min(part.to-part.from,position.offset-part.from))}
  }
  return {chapters,anchors}
}
