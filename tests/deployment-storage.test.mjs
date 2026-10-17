import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { saveBook, listBooks, storageError } from '../src/shared/storage/books.ts'
import { listFavorites, listMastery, setFavorite, setMastered } from '../src/features/vocabulary/storage.ts'

const book = { schemaVersion: 1, id: 'release-test', source: 'txt', title: '独立测试书', importedAt: '2026-10-16', chapters: [] }
test('同一来源刷新可读取书籍和学习记录，不同来源的存储相互隔离', async () => {
  const original = globalThis.indexedDB
  const first = new IDBFactory(), second = new IDBFactory()
  try {
    globalThis.indexedDB = first
    await saveBook(book)
    await setFavorite({ id: 'moon', word: 'moon', translation: '月亮', phonetic: '' }, true)
    await setMastered('moon', true)
    assert.deepEqual(await listBooks(), [book])
    assert.equal((await listFavorites()).length, 1)
    assert.equal((await listMastery())[0].mastered, true)
    globalThis.indexedDB = second
    assert.deepEqual(await listBooks(), [])
    assert.deepEqual(await listFavorites(), [])
    globalThis.indexedDB = first
    assert.deepEqual(await listBooks(), [book])
  } finally { globalThis.indexedDB = original }
})
test('模拟浏览器清理独立测试来源后返回空书库，不生成虚假的服务器恢复数据', async () => {
  const original = globalThis.indexedDB
  globalThis.indexedDB = new IDBFactory()
  try {
    await saveBook(book)
    await setMastered('moon', true)
    for (const name of ['cijing-reading', 'cijing-vocabulary']) await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = resolve; request.onerror = reject
    })
    assert.deepEqual(await listBooks(), [])
    assert.deepEqual(await listMastery(), [])
  } finally { globalThis.indexedDB = original }
})
test('书库写入无法克隆时明确失败，已有书籍不受影响且连接可继续使用', async () => {
  const original = globalThis.indexedDB
  globalThis.indexedDB = new IDBFactory()
  try {
    await saveBook(book)
    await assert.rejects(saveBook({ ...book, id: 'bad', invalid: () => {} }), { name: 'DataCloneError' })
    assert.deepEqual(await listBooks(), [book])
  } finally { globalThis.indexedDB = original }
})
test('数据库被阻塞后晚到的连接必须关闭，不遗留升级阻塞', async () => {
  const original = globalThis.indexedDB
  let closed = false
  globalThis.indexedDB = { open() {
    const request = {}
    queueMicrotask(() => {
      request.onblocked()
      queueMicrotask(() => { request.result = { close() { closed = true } }; request.onsuccess() })
    })
    return request
  } }
  try {
    await assert.rejects(listBooks(), /其他页面阻止/)
    await Promise.resolve()
    assert.equal(closed, true)
  } finally { globalThis.indexedDB = original }
})
test('跨浏览器／不同执行上下文的配额错误也显示明确中文提示', () => {
  assert.match(storageError({ name: 'QuotaExceededError' }), /空间不足/)
  assert.match(storageError(new DOMException('full', 'QuotaExceededError')), /尚未保存/)
})

test('可选的容量估算同步异常或异步失败时仍以实际写入结果为准', async () => {
  const original = globalThis.indexedDB
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  globalThis.indexedDB = new IDBFactory()
  try {
    for (const estimate of [() => { throw new Error('unavailable') }, () => Promise.reject(new Error('unavailable'))]) {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { estimate } } })
      await saveBook({ ...book, importBytes: 100 })
      assert.equal((await listBooks()).length, 1)
    }
  } finally {
    globalThis.indexedDB = original
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator
  }
})
