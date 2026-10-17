import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import {listFavorites,setFavorite,listMastery,setMastered,readCachedDictionary} from '../src/features/vocabulary/storage.ts'
import {saveBook,listBooks} from '../src/shared/storage/books.ts'
const favorite={id:'old house',word:'old house',translation:'旧屋',phonetic:''}
test('v1学习库升级保留掌握和词库缓存，新增收藏不改变小说库',async()=>{
 const old=await new Promise((resolve,reject)=>{
  const request=indexedDB.open('cijing-vocabulary',1)
  request.onupgradeneeded=()=>{request.result.createObjectStore('assets',{keyPath:'id'});request.result.createObjectStore('mastery',{keyPath:'id'})}
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)
 })
 await new Promise((resolve,reject)=>{
  const tx=old.transaction(['assets','mastery'],'readwrite')
  tx.objectStore('assets').put({id:'lookup',version:'existing',entries:[]})
  tx.objectStore('mastery').put({id:'moon',mastered:true,updatedAt:'before'})
  tx.oncomplete=resolve;tx.onabort=reject
 })
 old.close()
 const book={schemaVersion:1,id:'favorite-test',title:'原小说',source:'txt',importedAt:'before',chapters:[]}
 await saveBook(book)
 assert.deepEqual(await listFavorites(),[])
 assert.equal((await listMastery())[0].mastered,true)
 assert.equal((await readCachedDictionary()).version,'existing')
 await setFavorite(favorite,true)
 let records=await listFavorites();assert.equal(records.length,1);assert.equal(records[0].translation,'旧屋');assert.ok(records[0].createdAt)
 await setFavorite(favorite,true);assert.equal((await listFavorites()).length,1)
 await setMastered(favorite.id,true,favorite)
 assert.deepEqual((await listMastery()).find(record=>record.id===favorite.id).entry,favorite)
 await setMastered(favorite.id,false)
 assert.deepEqual((await listMastery()).find(record=>record.id===favorite.id).entry,favorite)
 await setMastered(favorite.id,true)
 assert.ok((await listMastery()).some(record=>record.id===favorite.id && record.mastered))
 await setFavorite(favorite,false);assert.deepEqual(await listFavorites(),[])
 assert.ok((await listMastery()).some(record=>record.id===favorite.id && record.mastered))
 assert.deepEqual(await listBooks(),[book])
 await assert.rejects(setFavorite({...favorite,id:''},true),/缺少收藏/)
})
test('存储被限制时收藏和掌握明确失败，不伪报成功',async()=>{
 const saved=indexedDB
 globalThis.indexedDB=undefined
 try {
  await assert.rejects(setFavorite(favorite,true),/无法使用/)
  await assert.rejects(setMastered('moon',true),/无法使用/)
 } finally {globalThis.indexedDB=saved}
})
