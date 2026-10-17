import type {Book} from '../../shared/types/book'
import type {BackupData} from './types'
import {listBooks,addBackupBooks} from '../../shared/storage/books.ts'
import {listFavorites,listMastery,addBackupLearning} from '../vocabulary/storage.ts'
import {addBackupTranslations} from '../translation/storage.ts'
import {validateTranslationPackage} from '../translation/package.ts'
import {backupBookIdentity} from './archive.ts'
interface Mapping {source:Book;target:Book;fingerprint:string;add:boolean}
export interface RestorePlan {mappings:Mapping[];newBooks:number;existingBooks:number;newFavorites:number;newMastery:number;conflicts:number}
export async function prepareRestore(data:BackupData,samples:Book[]):Promise<RestorePlan> {
  const existing=[...await listBooks(),...samples],byIdentity=new Map<string,Book>(),ids=new Set(existing.map(book=>book.id))
  for(const book of existing)byIdentity.set(await backupBookIdentity(book),book)
  const mappings:Mapping[]=[]
  for(const source of data.books) {
    const fingerprint=await backupBookIdentity(source),known=byIdentity.get(fingerprint)
    if(known){mappings.push({source,target:known,fingerprint,add:false});continue}
    const base=`backup-${fingerprint.slice(7)}`;let key=base,index=0
    while(ids.has(key))key=`${base}-${++index}`
    ids.add(key)
    const target:Book={...source,id:key,source:source.source==='sample'?'txt':source.source}
    byIdentity.set(fingerprint,target);mappings.push({source,target,fingerprint,add:true})
  }
  const favorites=new Set((await listFavorites()).map(item=>item.id)),mastery=new Set((await listMastery()).map(item=>item.id))
  const newFavorites=data.favorites.filter(item=>!favorites.has(item.id)).length,newMastery=data.mastery.filter(item=>!mastery.has(item.id)).length
  return {mappings,newBooks:mappings.filter(m=>m.add).length,existingBooks:mappings.filter(m=>!m.add).length,newFavorites,newMastery,conflicts:data.favorites.length-newFavorites+data.mastery.length-newMastery}
}
export interface RestoreReport {books:number;learning:number;translations:number;positions:number;settings:number;skipped:number}
/** Independent databases cannot share a transaction. Every stage is add-only and retryable. */
export async function restoreBackup(data:BackupData,samples:Book[],options:{restoreSettings?:boolean;storage?:Storage}={}):Promise<RestoreReport> {
  const storage=options.storage??localStorage,report:RestoreReport={books:0,learning:0,translations:0,positions:0,settings:0,skipped:0}
  try {
    const plan=await prepareRestore(data,samples);report.skipped+=plan.existingBooks
    const books=await addBackupBooks(plan.mappings.filter(m=>m.add).map(m=>m.target));report.books=books.added;report.skipped+=books.skipped
    // Concurrent changes must never redirect progress or translations to a different book.
    const current=[...await listBooks(),...samples]
    for(const mapping of plan.mappings) {
      const actual=current.find(book=>book.id===mapping.target.id)
      if(!actual||await backupBookIdentity(actual)!==mapping.fingerprint)throw new Error('书库在恢复期间发生变化，请关闭其他阅读页面并重新预览。')
      mapping.target=actual
    }
    const learning=await addBackupLearning(data.favorites,data.mastery);report.learning=learning.added;report.skipped+=learning.skipped
    const translations=[]
    for(const item of data.translations) {
      const mapping=plan.mappings.find(m=>m.source.id===item.bookId)!
      const validated=await validateTranslationPackage(item.data,mapping.target)
      for(const translation of validated.chapters)translations.push({bookId:mapping.target.id,chapterId:translation.chapterId,translation})
    }
    const translated=await addBackupTranslations(translations);report.translations=translated.added;report.skipped+=translated.skipped
    for(const item of data.positions) {
      const mapping=plan.mappings.find(m=>m.source.id===item.bookId)!,chapterIndex=mapping.source.chapters.findIndex(chapter=>chapter.id===item.position.chapterId)
      const key=`cijing-position:${mapping.target.id}`
      if(storage.getItem(key)!==null){report.skipped++;continue}
      storage.setItem(key,JSON.stringify({...item.position,chapterId:mapping.target.chapters[chapterIndex].id}));report.positions++
    }
    for(const [key,value] of Object.entries(data.settings)) {
      if(!options.restoreSettings&&storage.getItem(key)!==null){report.skipped++;continue}
      storage.setItem(key,value);report.settings++
    }
    return report
  } catch(error) {
    const detail=error&&typeof error==='object'&&'name'in error&&error.name==='QuotaExceededError'?'设备存储空间不足。':error instanceof Error?error.message:'本地存储失败。'
    throw new Error(`恢复未全部完成：${detail} 已补充 ${report.books} 本小说、${report.learning} 条学习记录、${report.translations} 章译文、${report.positions} 项进度、${report.settings} 项设置。已有书籍、学习记录和进度未覆盖；可释放空间后重新导入。只有明确勾选时才会替换阅读设置。`)
  }
}
