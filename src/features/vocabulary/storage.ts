import type { FavoriteRecord, LearningWord, MasteryRecord, WordEntry } from './types'
// Separate database: does not change or migrate the existing novel database.
async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('浏览器无法使用本地词库存储。')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cijing-vocabulary', 2)
    let blocked = false
    request.onupgradeneeded = () => {
      for (const name of ['assets', 'mastery', 'favorites']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' })
      }
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new Error('词库存储被其他页面阻止，请关闭其他词库页面后重试。')) }
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}
async function operation<T>(storeName: 'assets' | 'mastery' | 'favorites', mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    let request: IDBRequest<T>
    let transaction: IDBTransaction
    try { transaction = db.transaction(storeName, mode); request = action(transaction.objectStore(storeName)) }
    catch (error) { db.close(); reject(error); return }
    transaction.oncomplete = () => { db.close(); resolve(request.result) }
    transaction.onabort = () => { db.close(); reject(transaction.error ?? request.error ?? new Error('词库保存失败')) }
  })
}
export interface CachedDictionary { id: 'lookup'; version: string; entries: WordEntry[] }
export const readCachedDictionary = () => operation<CachedDictionary | undefined>('assets', 'readonly', store => store.get('lookup'))
export const cacheDictionary = (version: string, entries: WordEntry[]) => operation('assets', 'readwrite', store => store.put({id:'lookup',version,entries}))
export const listMastery = () => operation<MasteryRecord[]>('mastery', 'readonly', store => store.getAll())
export async function setMastered(id: string, mastered: boolean, entry?: LearningWord): Promise<void> {
  if (!id.trim()) throw new Error('缺少词条编号')
  await operation('mastery', 'readwrite', store => {
    const request = store.get(id)
    request.onsuccess = () => store.put({ ...request.result, id, mastered, updatedAt: new Date().toISOString(), ...(entry ? { entry: { ...entry, id } } : {}) } satisfies MasteryRecord)
    return request
  })
}

export const listFavorites = () => operation<FavoriteRecord[]>('favorites', 'readonly', store => store.getAll())
export async function setFavorite(word: Omit<FavoriteRecord, 'createdAt'>, favorite: boolean): Promise<void> {
  if (!word.id.trim() || !word.word.trim()) throw new Error('缺少收藏词条')
  if (favorite) await operation('favorites', 'readwrite', store => store.put({ ...word, createdAt: new Date().toISOString() } satisfies FavoriteRecord))
  else await operation('favorites', 'readwrite', store => store.delete(word.id))
}

export async function addBackupLearning(favorites:FavoriteRecord[],mastery:MasteryRecord[]) {
  const {addMissing}=await import('../../shared/storage/addMissing.ts')
  return addMissing(await openDatabase(),[
    {store:'favorites',records:favorites.map(value=>({key:value.id,value}))},
    {store:'mastery',records:mastery.map(value=>({key:value.id,value}))},
  ])
}
