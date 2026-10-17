import { ZipReader, Uint8ArrayReader } from '@zip.js/zip.js'
import type { Entry } from '@zip.js/zip.js'
// Runtime decompression is bounded and does not create a rendering iframe.

import PackagingModule from 'epubjs/lib/packaging.js'
import NavigationModule from 'epubjs/lib/navigation.js'
import type PackagingType from 'epubjs/types/packaging'
import type NavigationType from 'epubjs/types/navigation'
import type { NavItem } from 'epubjs/types/navigation'
import type { Book, BookResource, BookTocEntry } from '../../shared/types/book'
import type { BookImporter } from './types'
import { archivePath, base64, decodeEpubXml, decodeRasterData, parseEpubXml, rasterMime, safeSvg } from './epubSafety.ts'
import { extractEpubContent, nonBodyTypes, splitEpubContent } from './epubContent.ts'

const Packaging = ('default' in PackagingModule ? PackagingModule.default : PackagingModule) as typeof PackagingType
const Navigation = ('default' in NavigationModule ? NavigationModule.default : NavigationModule) as typeof NavigationType
export const EPUB_LIMITS = { file:40*1024*1024, expanded:128*1024*1024, xml:4*1024*1024, image:8*1024*1024, resources:32*1024*1024, text:16*1024*1024, entries:4000 }
function flattenToc(items: NavItem[], base: string, depth=0): {title:string;path:string;fragment:string;depth:number}[] {
  if(depth>20) throw new Error('EPUB 目录层级过深。')
  return items.flatMap(item=>{
    const children=flattenToc(item.subitems??[],base,depth+1)
    if(!item.href) return children
    try {return [{title:item.label.trim().slice(0,250),path:archivePath(base,item.href),fragment:decodeURIComponent(item.href.split('#')[1]??''),depth},...children]}
    catch {return children}
  })
}
export const epubImporter: BookImporter = {
  format:'epub', accepts:file=>/\.epub$/i.test(file.name),
  async parse(file,options) {
    if(!this.accepts(file)) throw new Error('请选择 .epub 文件。')
    if(file.size>EPUB_LIMITS.file) throw new Error('EPUB 最大支持 40 MB，请选择较小的版本或拆分后导入。')
    if(!file.size) throw new Error('EPUB 文件为空。')
    const reader=new ZipReader(new Uint8ArrayReader(new Uint8Array(await file.arrayBuffer())),{useWebWorkers:false,checkSignature:true})
    try {
      const entries:Entry[]=[];let expanded=0
      for await (const entry of reader.getEntriesGenerator()) {
        entries.push(entry);expanded+=entry.uncompressedSize
        if(entries.length>EPUB_LIMITS.entries || expanded>EPUB_LIMITS.expanded) throw new Error('EPUB 解压后过大或资源过多，已停止导入以保护设备内存。')
      }
      const files=new Map<string,typeof entries[number]>()
      for(const entry of entries) {
        if(entry.directory) continue
        if(entry.encrypted) throw new Error('此 EPUB 已加密，暂不支持密码或 DRM 保护的书籍。')
        if(entry.filename.split('/').includes('..') || entry.filename.startsWith('/') || entry.filename.includes('\\')) throw new Error('EPUB 压缩包包含不安全的路径。')
        const path=archivePath('',entry.filename)
        if(files.has(path)) throw new Error('EPUB 包含重复资源路径，无法安全导入。')
        files.set(path,entry)
      }
      async function read(path:string,limit:number) {
        if(options?.signal?.aborted) throw new Error('EPUB 导入已取消。')
        const entry=files.get(path)
        if(!entry || !('getData' in entry)) throw new Error(`EPUB 缺少资源：${path.slice(0,180)}`)
        if(entry.uncompressedSize>limit) throw new Error('EPUB 单个章节或图片过大，已停止导入。')
        const chunks:Uint8Array[]=[];let size=0
        await entry.getData(new WritableStream<Uint8Array>({write(chunk){if(options?.signal?.aborted) throw new Error('EPUB 导入已取消。');size+=chunk.length;if(size>limit) throw new Error('EPUB 解压内容超出安全大小限制。');chunks.push(chunk)}}))
        const bytes=new Uint8Array(size);let offset=0
        for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length}
        return bytes
      }
      const xml=async(path:string)=>parseEpubXml(decodeEpubXml(await read(path,EPUB_LIMITS.xml)),path)
      if(new TextDecoder().decode(await read('mimetype',128)).trim()!=='application/epub+zip') throw new Error('该文件不是有效的 EPUB，或 mimetype 已损坏。')
      if(files.has('META-INF/encryption.xml')) {
        const encrypted=await xml('META-INF/encryption.xml')
        for(const method of Array.from(encrypted.getElementsByTagName('*')).filter(el=>el.localName==='EncryptionMethod')) if(!['http://www.idpf.org/2008/embedding','http://ns.adobe.com/pdf/enc#RC'].includes(method.getAttribute('Algorithm')??'')) throw new Error('此 EPUB 含 DRM 加密内容，暂不支持。')
      }
      const container=await xml('META-INF/container.xml')
      const root=Array.from(container.getElementsByTagName('*')).find(el=>el.localName==='rootfile')?.getAttribute('full-path')
      if(!root) throw new Error('EPUB 缺少书籍描述文件。')
      const opfPath=archivePath('',root), opf=await xml(opfPath)
      if(!/^[23](?:\.|$)/.test(opf.documentElement.getAttribute('version')??'')) throw new Error('目前支持 EPUB 2 和 EPUB 3 流式排版小说。')
      const ids=new Set<string>()
      for(const item of Array.from(opf.getElementsByTagName('*')).filter(el=>el.localName==='item')) {
        const id=item.getAttribute('id')??''
        if(!/^[\w.:-]{1,200}$/.test(id)||['__proto__','constructor','prototype'].includes(id)||ids.has(id)) throw new Error('EPUB 清单中的资源编号无效或重复。')
        ids.add(id)
      }
      const pkg=new Packaging(opf)
      if(pkg.metadata.layout==='pre-paginated') throw new Error('此 EPUB 为固定版式，目前仅支持可重排的文字小说。')
      const warnings=new Set<string>(), resources:BookResource[]=[], assets=new Map<string,string>();let assetBytes=0,textBytes=0
      async function rasterUri(base:string,href:string) {
        try {const bytes=decodeRasterData(href,EPUB_LIMITS.image)??await read(archivePath(base,href),EPUB_LIMITS.image),mime=rasterMime(bytes);return mime ? `data:${mime};base64,${base64(bytes)}` : null}
        catch {warnings.add('部分外部或缺失的图片未载入。');return null}
      }
      async function image(base:string,href:string,inlineSvg?:Element):Promise<string|null> {
        let path:string
        try {path=inlineSvg ? `${base}#inline-${resources.length}` : href.startsWith('data:') ? `${base}#embedded-${resources.length}` : archivePath(base,href)}
        catch {warnings.add('外部图片不会联网下载，已保留缺图提示。');return null}
        if(assets.has(path)) return assets.get(path)!
        try {
          let bytes:Uint8Array, mime:string|null
          if(inlineSvg) {
            const doc=parseEpubXml(new XMLSerializer().serializeToString(inlineSvg),'内嵌图片')
            bytes=new TextEncoder().encode(await safeSvg(doc,href=>rasterUri(base,href)));mime='image/svg+xml'
          } else {
            bytes=decodeRasterData(href,EPUB_LIMITS.image)??await read(path,EPUB_LIMITS.image);mime=rasterMime(bytes)
            if(!mime && /\.svg$/i.test(path)) {bytes=new TextEncoder().encode(await safeSvg(parseEpubXml(new TextDecoder().decode(bytes),path),href=>rasterUri(path,href)));mime='image/svg+xml'}
          }
          if(!mime) {warnings.add('不支持的图片格式已保留缺图提示。');return null}
          if(assetBytes+bytes.length>EPUB_LIMITS.resources) throw new Error('EPUB 图片总量超过 32 MB，无法保存。')
          assetBytes+=bytes.length
          const id=`image-${resources.length}`,blob=new Blob([bytes.slice().buffer as ArrayBuffer],{type:mime})
          resources.push({id,blob});assets.set(path,id);return id
        } catch(error) {
          if(error instanceof Error && /过大|超出|超过/.test(error.message)) throw error
          warnings.add('部分缺失或损坏的图片未能载入，正文中会显示提示。');return null
        }
      }
      const navItem=Object.values(pkg.manifest).find(item=>item.properties.includes('nav'))
      const navHrefs=[...new Set([navItem?.href||pkg.navPath,pkg.ncxPath].filter(Boolean))]
      let toc:ReturnType<typeof flattenToc>=[], nav:NavigationType|undefined,navPath=''
      const skipped=new Set<string>()
      for(const href of navHrefs) {
        try {
          const path=archivePath(opfPath,href);skipped.add(path)
          const parsed=new Navigation(await xml(path)),items=flattenToc(parsed.toc,path)
          if(items.length) {nav=parsed;navPath=path;toc=items;break}
        } catch { /* An EPUB 2 NCX may still be usable when an EPUB 3 nav is damaged. */ }
      }
      if(!toc.length) warnings.add('原书目录无法完整解析，将使用正文顺序生成目录。')
      for(const reference of Array.from(opf.getElementsByTagName('*')).filter(el=>el.localName==='reference')) if(nonBodyTypes.has(reference.getAttribute('type')??'')) {
        try {skipped.add(archivePath(opfPath,reference.getAttribute('href')??''))} catch { /* Ignore invalid guide references. */ }
      }
      for(const landmark of nav?.landmarks??[]) if(landmark.href&&nonBodyTypes.has(landmark.type??'')) {try{skipped.add(archivePath(navPath,landmark.href))}catch{/* Ignore external landmarks. */}}
      const book:Book={schemaVersion:1,id:`local-epub-${`${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint32Array(2)),value=>value.toString(36)).join('')}`}`,title:pkg.metadata.title?.trim().slice(0,250)||file.name.replace(/\.epub$/i,'')||'未命名小说',author:pkg.metadata.creator?.trim().slice(0,250)||'未知作者',source:'epub',language:pkg.metadata.language||undefined,originalFileName:file.name,importedAt:new Date().toISOString(),palette:'mist',genre:'本地小说',chapters:[],resources,toc:[]}
      const creators=Array.from(opf.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/','creator')).map(item=>item.textContent?.trim()).filter(Boolean).join('、')
      if(creators) book.author=creators.slice(0,250)
      const targets=new Map<string,{chapterId:string;paragraph:number;offset:number;anchors:Record<string,{chapterId:string;paragraph:number;offset:number}>}>()
      for(const [index,spine] of pkg.spine.entries()) {
        const manifest=pkg.manifest[spine.idref]
        if(!manifest) throw new Error('EPUB 阅读顺序引用了不存在的正文。')
        const path=archivePath(opfPath,manifest.href)
        if((spine as {linear?:string}).linear==='no'||skipped.has(path)||manifest.properties.includes('nav')||/(?:^|\/)(?:copyright|colophon|toc|nav|cover|titlepage)\.x?html?$/i.test(path)) {warnings.add('已按书籍结构排除导航、封面或版权等非正文页。');continue}
        if(!['application/xhtml+xml','text/html'].includes(manifest.type)) throw new Error('EPUB 含不支持的正文格式，目前仅支持 XHTML 文字章节。')
        options?.onProgress?.(`正在解析章节 ${index+1} / ${pkg.spine.length}…`)
        const document=await xml(path)
        const content=await extractEpubContent(document,(href,svg)=>image(path,href,svg))
        if(!content.blocks.length) continue
        const title=toc.find(item=>item.path===path)?.title || content.blocks.find(block=>block.kind==='heading')?.text.slice(0,250) || `第 ${book.chapters.length+1} 章`
        const divided=splitEpubContent(content,`epub-${index}`,title,book.chapters.length)
        textBytes+=content.blocks.reduce((sum,block)=>sum+block.text.length*2,0)
        if(textBytes>EPUB_LIMITS.text) throw new Error('EPUB 正文过长，当前支持最多约 16 MB 文字数据，请拆分后导入。')
        book.chapters.push(...divided.chapters)
        targets.set(path,{chapterId:divided.chapters[0].id,paragraph:0,offset:0,anchors:divided.anchors})
        await new Promise(resolve=>setTimeout(resolve,0))
      }
      if(!book.chapters.length) throw new Error('EPUB 中未找到可阅读的小说正文。')
      book.toc=toc.flatMap((item,index):BookTocEntry[]=>{
        const target=targets.get(item.path)
        if(!target) return []
        const position=item.fragment ? target.anchors[item.fragment] : target
        if(!position) {warnings.add('部分目录锚点缺失，已改为跳到对应章节开头。')}
        const actual=position??target
        return [{id:`toc-${index}`,title:item.title||'未命名章节',chapterId:actual.chapterId,paragraph:actual.paragraph,offset:actual.offset,depth:Math.min(8,item.depth)}]
      })
      // Long chapter continuations and unlisted spine files remain reachable.
      const included=new Set(book.toc.map(item=>item.chapterId))
      for(const chapter of book.chapters) if(!included.has(chapter.id)) book.toc.push({id:`auto-${chapter.id}`,title:chapter.title,chapterId:chapter.id,paragraph:0,offset:0,depth:0})
      book.toc.sort((a,b)=>book.chapters.findIndex(chapter=>chapter.id===a.chapterId)-book.chapters.findIndex(chapter=>chapter.id===b.chapterId)||a.paragraph-b.paragraph||a.offset-b.offset)
      const coverId=Array.from(opf.getElementsByTagName('*')).find(el=>el.localName==='meta'&&el.getAttribute('name')==='cover')?.getAttribute('content')
      const coverHref=pkg.coverPath||Object.values(pkg.manifest).find(item=>item.properties.includes('cover-image'))?.href||(coverId?pkg.manifest[coverId]?.href:undefined)
      if(coverHref) book.coverResourceId=await image(opfPath,coverHref)??undefined
      if(!book.coverResourceId) {
        const guide=Array.from(opf.getElementsByTagName('*')).find(el=>el.localName==='reference'&&el.getAttribute('type')==='cover')?.getAttribute('href')
        if(guide) try {
          const path=archivePath(opfPath,guide),document=await xml(path)
          const element=Array.from(document.getElementsByTagName('*')).find(el=>['img','svg'].includes(el.localName.toLowerCase()))
          if(element) book.coverResourceId=await image(path,element.getAttribute('src')??'',element.localName==='svg'?element:undefined)??undefined
        } catch {warnings.add('封面无法提取，将使用默认封面。')}
      }
      book.importWarnings=[...warnings];book.importBytes=textBytes+assetBytes
      return book
    } catch(error) {
      if(error instanceof Error && error.message.startsWith('EPUB') || error instanceof Error && /此 EPUB|目前支持|请选择|加密/.test(error.message)) throw error
      throw new Error('无法解析 EPUB：文件可能损坏、被加密或格式不受支持。请尝试重新下载未加密的 EPUB 2／3 文件。')
    } finally {await reader.close()}
  },
}
