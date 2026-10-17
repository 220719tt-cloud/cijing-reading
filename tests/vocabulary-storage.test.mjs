import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readCachedDictionary, cacheDictionary, listMastery, setMastered } from '../src/features/vocabulary/storage.ts'
import { saveBook, listBooks } from '../src/shared/storage/books.ts'
const word = {id:'secret',word:'secret',phonetic:'',translation:'n. 秘密',tags:['cet4'],kind:'word'}
test('词库缓存可从新连接读取，掌握／取消独立持久化', async () => {
  assert.equal(await readCachedDictionary(),undefined)
  await cacheDictionary('test-v1',[word])
  assert.deepEqual(await readCachedDictionary(),{id:'lookup',version:'test-v1',entries:[word]})
  await setMastered('secret',true)
  let records=await listMastery()
  assert.equal(records[0].id,'secret')
  assert.equal(records[0].mastered,true)
  assert.ok(records[0].updatedAt)
  await setMastered('secret',false)
  records=await listMastery()
  assert.equal(records.length,1)
  assert.equal(records[0].mastered,false)
  assert.deepEqual((await readCachedDictionary()).entries,[word])
})
test('升级词库缓存不会清空掌握记录，也不修改小说数据库', async () => {
  const book={schemaVersion:1,id:'test-book',title:'测试',source:'txt',importedAt:'2026-10-16',chapters:[]}
  await saveBook(book)
  await setMastered('courage',true)
  await cacheDictionary('test-v2',[word])
  assert.equal((await readCachedDictionary()).version,'test-v2')
  assert.ok((await listMastery()).some(item=>item.id==='courage'&&item.mastered))
  assert.deepEqual(await listBooks(),[book])
})

test('有效缓存断网可用，过期缓存更新后仍保留掌握记录', async () => {
  const { resolveVocabulary } = await import('../src/features/vocabulary/repository.ts')
  await cacheDictionary('offline-v1',[word])
  const result = await resolveVocabulary('offline-v1',1,{
    readCache:readCachedDictionary,writeCache:cacheDictionary,
    readAsset:async()=>{ assert.fail('有有效缓存时不应发起网络请求') },
  })
  assert.equal(result.offlineReady,true)
  assert.equal(result.entries[0].id,'secret')
  let downloads=0
  await resolveVocabulary('offline-v2',1,{
    readCache:readCachedDictionary,writeCache:cacheDictionary,
    readAsset:async()=>{ downloads++;return [word] },
  })
  assert.equal(downloads,1)
  assert.equal((await readCachedDictionary()).version,'offline-v2')
  assert.ok((await listMastery()).some(item=>item.id==='courage'&&item.mastered))
})
test('存储失败不伪报离线成功，文件不完整不缓存', async () => {
  const { resolveVocabulary } = await import('../src/features/vocabulary/repository.ts')
  const result=await resolveVocabulary('v1',1,{
    readCache:async()=>{throw new Error('blocked')},
    writeCache:async()=>{throw new Error('quota')},readAsset:async()=>[word],
  })
  assert.equal(result.offlineReady,false)
  assert.ok(result.warning)
  await assert.rejects(resolveVocabulary('v2',2,{
    readCache:async()=>undefined,readAsset:async()=>[word],writeCache:async()=>assert.fail('不完整文件不能入库'),
  }),/词库文件不完整/)
})
