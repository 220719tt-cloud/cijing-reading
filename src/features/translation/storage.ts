import type { Book, Chapter } from '../../shared/types/book'
import type { ChapterTranslation, TranslationPackage, TranslationCache } from './types'
import { bookIdentity, validateChapterTranslation, validateTranslationPackage } from './package.ts'
interface StoredChapter { bookId:string; chapterId:string; translation:ChapterTranslation }
async function openDatabase():Promise<IDBDatabase> {
  if(typeof indexedDB==='undefined') throw new Error('当前浏览器无法保存译文，请允许网站存储。')
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('cijing-translations',1);let blocked=false
    request.onupgradeneeded=()=>request.result.createObjectStore('chapters',{keyPath:['bookId','chapterId']}).createIndex('bookId','bookId')
    request.onerror=()=>reject(request.error)
    request.onblocked=()=>{blocked=true;reject(new Error('译文库被其他页面阻止，请关闭其他阅读页面后重试。'))}
    request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return};db.onversionchange=()=>db.close();resolve(db)}
  })
}
async function operation<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
  const db=await openDatabase()
  return new Promise((resolve,reject)=>{
    let tx:IDBTransaction,request:IDBRequest<T>
    try {tx=db.transaction('chapters',mode);request=action(tx.objectStore('chapters'))} catch(error){try{tx!.abort()}catch{/* No active transaction. */}db.close();reject(error);return}
    tx.oncomplete=()=>{db.close();resolve(request.result)}
    tx.onabort=()=>{db.close();reject(tx.error??request.error??new Error('译文保存事务失败。'))}
  })
}
export async function readChapterTranslation(book:Book,chapter:Chapter):Promise<ChapterTranslation|undefined> {
  const record=await operation<StoredChapter|undefined>('readonly',store=>store.get([book.id,chapter.id]))
  if(!record) return undefined
  return validateChapterTranslation(record.translation,book,book.chapters.findIndex(item=>item.id===chapter.id))
}
/** Validate the entire package before one atomic transaction; other books are untouched. */
export async function saveTranslationPackage(book:Book,input:TranslationPackage) {
  const validated=await validateTranslationPackage(input,book)
  await operation('readwrite',store=>{
    let request:IDBRequest|undefined
    for(const translation of validated.chapters) request=store.put({bookId:book.id,chapterId:translation.chapterId,translation} satisfies StoredChapter)
    return request!
  })
}
export async function exportCachedTranslations(book:Book,indices:readonly number[]=book.chapters.map((_,i)=>i)):Promise<TranslationPackage> {
  const chapters:ChapterTranslation[]=[]
  for(const index of indices) {const chapter=book.chapters[index];if(!chapter) throw new Error('章节不存在。');const translation=await readChapterTranslation(book,chapter);if(translation) chapters.push(translation)}
  if(!chapters.some(chapter=>chapter.segments.length)) throw new Error('所选范围尚无已保存的译文。请先导入英文译文。')
  return {format:'cijing-translations',schemaVersion:1,book:await bookIdentity(book),chapters}
}
export async function deleteBookTranslations(bookId:string) {
  await operation('readwrite',store=>{
    const request=store.index('bookId').openKeyCursor(bookId)
    request.onsuccess=()=>{const cursor=request.result;if(cursor){store.delete(cursor.primaryKey);cursor.continue()}}
    return request
  })
}
export function translationError(error:unknown) {
  if(error&&typeof error==='object'&&'name' in error&&error.name==='QuotaExceededError') return '设备空间不足，译文未保存；原书和之前的译文仍保留。'
  return error instanceof Error?error.message:'无法访问本地译文库，请检查浏览器存储设置。'
}

export const translationCache:TranslationCache={get:readChapterTranslation,put:saveTranslationPackage}

export async function listBookTranslations(book:Book) {
  const records=await operation<StoredChapter[]>('readonly',store=>store.index('bookId').getAll(book.id))
  const chapters:ChapterTranslation[]=[]
  for(const record of records) {
    const index=book.chapters.findIndex(chapter=>chapter.id===record.chapterId)
    if(index<0) throw new Error('本地译文与书籍章节不一致，无法完整备份。')
    chapters.push(await validateChapterTranslation(record.translation,book,index))
  }
  return {format:'cijing-translations' as const,schemaVersion:1 as const,book:await bookIdentity(book),chapters}
}
export async function addBackupTranslations(records:{bookId:string;chapterId:string;translation:ChapterTranslation}[]) {
  const {addMissing}=await import('../../shared/storage/addMissing.ts')
  return addMissing(await openDatabase(),[{store:'chapters',records:records.map(value=>({key:[value.bookId,value.chapterId],value}))}])
}
