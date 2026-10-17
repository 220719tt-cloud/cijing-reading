import type { Book } from '../types/book'
const DB_NAME = 'cijing-reading'
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器无法使用本地书库，请允许网站存储或换用新版浏览器。'))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore('books', { keyPath: 'id' })
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new Error('存储升级被其他页面阻止，请关闭其他词境阅读页面后重试。')) }
    request.onsuccess = () => {
      const db = request.result
      if (blocked) { db.close(); return }
      db.onversionchange = () => db.close()
      resolve(db)
    }
  })
}
async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction
    let request: IDBRequest<T>
    try { tx = db.transaction('books', mode); request = action(tx.objectStore('books')) }
    catch (error) { db.close(); reject(error); return }
    tx.oncomplete = () => { db.close(); resolve(request.result) }
    tx.onabort = () => { db.close(); reject(tx.error ?? request.error ?? new Error('存储操作已取消')) }
    tx.onerror = () => { /* onabort handles transaction failures. */ }
  })
}
export async function listBooks(): Promise<Book[]> {
  const books = await transact<Book[]>('readonly', store => store.getAll())
  return books.sort((a, b) => b.importedAt.localeCompare(a.importedAt))
}
export async function saveBook(book: Book) {
  let estimate: StorageEstimate | undefined
  // This optional preflight must not replace the actual IndexedDB write result.
  try { if (book.importBytes && typeof navigator !== 'undefined') estimate = await navigator.storage?.estimate?.() }
  catch { /* Some embedded/privacy browsers throw synchronously or reject. */ }
  if (book.importBytes && estimate?.quota && estimate.quota - (estimate.usage ?? 0) < book.importBytes) throw new DOMException('设备存储空间不足','QuotaExceededError')
  await transact('readwrite', store => store.put(book))
}
export async function deleteBook(id: string) { await transact('readwrite', store => store.delete(id)) }
export function storageError(error: unknown) {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError') return '设备存储空间不足，请释放空间后重试；本次小说尚未保存。'
  return error instanceof Error ? error.message : '无法访问本地存储，请检查浏览器设置后重试。'
}

/** Restore never replaces an existing primary key. */
export async function addBackupBooks(books:Book[]) {
  const {addMissing}=await import('./addMissing.ts')
  return addMissing(await openDatabase(),[{store:'books',records:books.map(book=>({key:book.id,value:book}))}])
}
