import type {Entry} from '@zip.js/zip.js'
import {BlobReader,BlobWriter,ZipReader,ZipWriter,Uint8ArrayReader} from '@zip.js/zip.js'
import {contentHash,sha256Fallback} from '../translation/hash.ts'
import {listBooks} from '../../shared/storage/books.ts'
import {listFavorites,listMastery} from '../vocabulary/storage.ts'
import {listBookTranslations} from '../translation/storage.ts'
import {validateTranslationPackage} from '../translation/package.ts'
import {parseEpubXml,safeSvg,decodeRasterData,base64,rasterMime} from '../importing/epubSafety.ts'
import type {Book,BookResource} from '../../shared/types/book'
import type {BackupData} from './types'
import {BACKUP_LIMITS,SETTING_KEYS} from './types.ts'
import {obj,str,id,arr,unique,learning,validateBook,validatePosition,validateSettings} from './validate.ts'
export async function byteHash(bytes:Uint8Array) {
  try {if(globalThis.crypto?.subtle){const digest=await crypto.subtle.digest('SHA-256',bytes.slice().buffer as ArrayBuffer);return 'sha256:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}} catch {/* Insecure/private contexts use the same local fallback. */}
  return `sha256:${sha256Fallback(bytes)}`
}
interface FileInfo {path:string;size:number;sha256:string}
export async function createBackup(samples:Book[],storage:Storage=localStorage):Promise<Blob> {
  const books=unique([...await listBooks(),...samples],book=>book.id)
  if(books.length>BACKUP_LIMITS.books)throw new Error('完整备份最多支持500本书。')
  const [favorites,mastery]=await Promise.all([listFavorites(),listMastery()])
  arr(favorites);arr(mastery)
  for(const item of favorites){learning(item);str(item.createdAt,'收藏时间',80)}
  for(const item of mastery){id(item.id);str(item.updatedAt,'掌握时间',80);if(typeof item.mastered!=='boolean')throw new Error('本地掌握记录无效，未生成备份。');if(item.entry){learning(item.entry);if(item.entry.id!==item.id)throw new Error('本地掌握记录编号不一致。')}}
  const settings:Record<string,string>={}
  for(const key of SETTING_KEYS){const value=storage.getItem(key);if(value!==null)settings[key]=value}
  validateSettings(settings)
  const positions=books.flatMap(book=>{const text=storage.getItem(`cijing-position:${book.id}`);return text===null?[]:[{bookId:book.id,position:validatePosition(JSON.parse(text),book)}]})
  const writer=new ZipWriter(new BlobWriter('application/zip'),{useWebWorkers:false}),files:FileInfo[]=[]
  let expanded=0
  async function add(path:string,value:Blob|string) {
    const bytes=new Uint8Array(await (typeof value==='string'?new Blob([value]):value).arrayBuffer())
    expanded+=bytes.length
    if(bytes.length>BACKUP_LIMITS.entry||expanded>BACKUP_LIMITS.expanded||files.length>=BACKUP_LIMITS.files-1)throw new Error('备份内容超过安全大小限制（单文件24 MB、总内容256 MB），未生成完整备份。')
    files.push({path,size:bytes.length,sha256:await byteHash(bytes)})
    await writer.add(path,new Uint8ArrayReader(bytes),{level:3})
  }
  try {
    const bookFiles:string[]=[],translations:{bookId:string;path:string}[]=[]
    for(let index=0;index<books.length;index++) {
      validateBook(books[index],books[index].resources)
      const book=books[index],resources:{id:string;path:string;mime:string}[]=[]
      for(const [assetIndex,asset] of (book.resources??[]).entries()) {
        if(asset.blob.size>BACKUP_LIMITS.image)throw new Error('本地图片超过8 MB，不能生成可恢复的完整备份。')
        const path=`images/${index}-${assetIndex}.bin`;await add(path,asset.blob);resources.push({id:asset.id,path,mime:asset.blob.type})
      }
      const path=`books/${index}.json`
      await add(path,JSON.stringify({...book,resources}));bookFiles.push(path)
      const translation=await listBookTranslations(book)
      if(translation.chapters.length){const path=`translations/${index}.json`;await add(path,JSON.stringify(translation));translations.push({bookId:book.id,path})}
      await new Promise(resolve=>setTimeout(resolve,0))
    }
    await add('state.json',JSON.stringify({books:bookFiles,favorites,mastery,positions,settings,translations}))
    const manifest={format:'cijing-backup',schemaVersion:1,createdAt:new Date().toISOString(),files}
    const manifestBytes=new TextEncoder().encode(JSON.stringify(manifest))
    if(manifestBytes.length>1024*1024)throw new Error('备份清单过大，未生成不可恢复的文件。')
    await writer.add('manifest.json',new Uint8ArrayReader(manifestBytes),{level:3})
    const blob=await writer.close()
    if(blob.size>BACKUP_LIMITS.file)throw new Error('备份压缩文件超过128 MB，未提供不完整文件。')
    return blob
  } catch(error){try{await writer.close()}catch{/* Preserve original error. */}throw error}
}
export async function parseBackup(file:Blob):Promise<BackupData> {
  if(!file.size||file.size>BACKUP_LIMITS.file)throw new Error('请选择有效备份 ZIP，最大128 MB。')
  const reader=new ZipReader(new BlobReader(file),{useWebWorkers:false,checkSignature:true})
  try {
    const entries:Entry[]=[];let declared=0
    for await(const entry of reader.getEntriesGenerator()){entries.push(entry);declared+=entry.uncompressedSize;if(entries.length>BACKUP_LIMITS.files||declared>BACKUP_LIMITS.expanded)throw new Error('备份解压后过大或条目过多。')}
    const paths=new Set<string>()
    for(const entry of entries)if(entry.directory||entry.encrypted||!/^manifest\.json$|^state\.json$|^(?:books|translations)\/\d+\.json$|^images\/\d+-\d+\.bin$/.test(entry.filename)||paths.has(entry.filename))throw new Error('备份包含重复、不安全或不支持的文件。');else paths.add(entry.filename)
    const files=new Map(entries.map(entry=>[entry.filename,entry])),used=new Set<string>();let total=0
    async function bytes(path:string,limit=BACKUP_LIMITS.entry) {
      const entry=files.get(path)
      if(!entry||!('getData' in entry)||entry.uncompressedSize>limit)throw new Error(`备份缺少文件或内容过大：${path}`)
      const chunks:Uint8Array[]=[];let size=0
      await entry.getData(new WritableStream<Uint8Array>({write(chunk){size+=chunk.length;total+=chunk.length;if(size>limit||total>BACKUP_LIMITS.expanded)throw new Error('备份实际解压大小超限。');chunks.push(chunk)}}))
      const output=new Uint8Array(size);let offset=0
      for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length}
      return output
    }
    const manifest=obj(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes('manifest.json',1024*1024))))
    if(manifest.format!=='cijing-backup'||manifest.schemaVersion!==1)throw new Error('不支持的备份格式或版本。')
    const info=unique(arr(manifest.files,BACKUP_LIMITS.files).map(value=>{const f=obj(value);return {path:str(f.path,'文件路径',100),size:f.size,sha256:f.sha256}}),item=>item.path)
    if(info.length+1!==files.size||info.some(f=>f.path==='manifest.json'||!files.has(f.path)))throw new Error('备份文件清单不完整。')
    const indexed=new Map(info.map(f=>[f.path,f]))
    async function read(path:string) {
      if(used.has(path))throw new Error('备份资源被重复引用。')
      const expected=indexed.get(path)
      if(!expected)throw new Error('备份引用了未登记文件。')
      used.add(path);const data=await bytes(path)
      if(expected.size!==data.length||expected.sha256!==await byteHash(data))throw new Error('备份校验失败，文件可能已损坏。')
      return data
    }
    const json=async(path:string)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await read(path))) as unknown
    const state=obj(await json('state.json')),books:Book[]=[]
    for(const path of arr(state.books,BACKUP_LIMITS.books)) {
      const raw=obj(await json(str(path,'小说文件路径',100))),resources:BookResource[]=[]
      for(const value of arr(raw.resources??[],4000)) {
        const asset=obj(value),data=await read(str(asset.path,'图片路径',100)),mime=str(asset.mime,'图片格式',80)
        if(data.length>BACKUP_LIMITS.image)throw new Error('备份图片超过8 MB。')
        let blob:Blob
        if(mime==='image/svg+xml') {
          const clean=await safeSvg(parseEpubXml(new TextDecoder('utf-8',{fatal:true}).decode(data),'备份插图'),async href=>{
            const raster=decodeRasterData(href,BACKUP_LIMITS.image)
            return raster?`data:${rasterMime(raster)};base64,${base64(raster)}`:null
          })
          blob=new Blob([clean],{type:mime})
        }else {if(rasterMime(data)!==mime)throw new Error('备份图片类型与内容不匹配。');blob=new Blob([data.slice().buffer as ArrayBuffer],{type:mime})}
        resources.push({id:id(asset.id),blob})
      }
      unique(resources,asset=>asset.id);books.push(validateBook(raw,resources))
    }
    unique(books,book=>book.id)
    const favorites=unique(arr(state.favorites).map(value=>({...learning(value),createdAt:str(obj(value).createdAt,'收藏时间',80)})),entry=>entry.id)
    const mastery=unique(arr(state.mastery).map(value=>{const m=obj(value),entryId=id(m.id);if(typeof m.mastered!=='boolean')throw new Error('掌握状态无效。');const entry=m.entry===undefined?undefined:learning(m.entry);if(entry&&entry.id!==entryId)throw new Error('掌握记录编号不一致。');return {id:entryId,mastered:m.mastered,updatedAt:str(m.updatedAt,'掌握时间',80),...(entry?{entry}:{})}}),entry=>entry.id)
    const positions=unique(arr(state.positions,BACKUP_LIMITS.books).map(value=>{const p=obj(value),bookId=id(p.bookId),book=books.find(book=>book.id===bookId);if(!book)throw new Error('进度指向不存在的小说。');return {bookId,position:validatePosition(p.position,book)}}),entry=>entry.bookId)
    const translations=[]
    for(const value of arr(state.translations,BACKUP_LIMITS.books)) {
      const t=obj(value),bookId=id(t.bookId),book=books.find(book=>book.id===bookId)
      if(!book)throw new Error('译文指向不存在的小说。')
      translations.push({bookId,data:await validateTranslationPackage(await json(str(t.path,'译文路径',100)),book)})
    }
    unique(translations,t=>t.bookId)
    if(used.size!==info.length)throw new Error('备份存在未引用的数据。')
    return {format:'cijing-backup',schemaVersion:1,createdAt:str(manifest.createdAt,'备份时间',80),books,favorites,mastery,positions,settings:validateSettings(state.settings),translations}
  } catch(error){throw new Error(`无法读取完整备份：${error instanceof Error?(error.message==='Unsafe filename'?'备份压缩包含不安全的文件路径。':error.message):'文件损坏。'}`)} finally {await reader.close()}
}
/** Ignore device-local IDs, but preserve actual text, formatting, metadata and image content. */
export async function backupBookIdentity(book:Book) {
  const assets=[]
  for(const asset of book.resources??[])assets.push({id:asset.id,mime:asset.blob.type,hash:await byteHash(new Uint8Array(await asset.blob.arrayBuffer()))})
  return contentHash(JSON.stringify({title:book.title,author:book.author,language:book.language,coverResourceId:book.coverResourceId,chapters:book.chapters.map(chapter=>({title:chapter.title,paragraphs:chapter.paragraphs,blocks:chapter.blocks?.map(b=>({kind:b.kind,text:b.text,level:b.level,resourceId:b.resourceId,alt:b.alt,marks:b.marks?.map(m=>({start:m.start,end:m.end,kind:m.kind}))}))})),assets,toc:book.toc?.map(t=>({title:t.title,chapter:book.chapters.findIndex(c=>c.id===t.chapterId),paragraph:t.paragraph,offset:t.offset,depth:t.depth}))}))
}
