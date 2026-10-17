import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb'
import {JSDOM} from 'jsdom'
import {ZipReader,ZipWriter,BlobReader,BlobWriter,Uint8ArrayReader,Uint8ArrayWriter} from '@zip.js/zip.js'
import {createBackup,parseBackup,backupBookIdentity,byteHash} from '../src/features/backup/archive.ts'
import {prepareRestore,restoreBackup} from '../src/features/backup/restore.ts'
import {sampleBooks} from '../src/features/reading/sampleBooks.ts'
import {txtImporter} from '../src/features/importing/txtImporter.ts'
import {epubImporter} from '../src/features/importing/epubImporter.ts'
import {saveBook,listBooks,addBackupBooks} from '../src/shared/storage/books.ts'
import {setFavorite,setMastered,listFavorites,listMastery,cacheDictionary,readCachedDictionary,addBackupLearning} from '../src/features/vocabulary/storage.ts'
import {saveTranslationPackage,readChapterTranslation} from '../src/features/translation/storage.ts'
const window=new JSDOM('').window
Object.assign(globalThis,{document:window.document,DOMParser:window.DOMParser,XMLSerializer:window.XMLSerializer})
class MemoryStorage {
 map=new Map()
 getItem(key){return this.map.get(key)??null}
 setItem(key,value){this.map.set(key,String(value))}
 removeItem(key){this.map.delete(key)}
 clear(){this.map.clear()}
 get length(){return this.map.size}
 key(index){return [...this.map.keys()][index]??null}
}
const file=async path=>new File([await readFile(new URL(`fixtures/${path}`,import.meta.url))],path.split('/').at(-1))
const txt=await txtImporter.parse(await file('utf8.txt'))
const epub=await epubImporter.parse(await file('epub/chinese-epub3.epub'))
const moon=sampleBooks.find(book=>book.id==='moon')
const sourceDB=new IDBFactory(),previousDB=globalThis.indexedDB
const sourceStorage=new MemoryStorage()
globalThis.indexedDB=sourceDB
await saveBook(txt);await saveBook(epub)
const favorites=[{id:'moon',word:'moon',translation:'月亮',phonetic:'mu:n'}, {id:'think of',word:'think of',translation:'想到；考虑',phonetic:'',kind:'phrase'}, {id:'sentence:003',word:"Don't worry.",translation:'别担心。',phonetic:'',kind:'sentence'}]
for(const entry of favorites){await setFavorite(entry,true);await setMastered(entry.id,true,entry)}
await setMastered('legacy-only-id',false)
for(const [book,path] of [[txt,'translations/utf8-en.json'],[epub,'translations/epub-en.json'],[moon,'translations/moon-en.json']])await saveTranslationPackage(book,JSON.parse(await (await file(path)).text()))
for(const book of [txt,epub,moon])sourceStorage.setItem(`cijing-position:${book.id}`,JSON.stringify({chapterId:book.chapters[0].id,paragraph:0,offset:3}))
sourceStorage.setItem('cijing-font-size','24');sourceStorage.setItem('cijing-theme','dark');sourceStorage.setItem('cijing-reader-preferences',JSON.stringify({background:'green',english:40,mode:'slide',chineseHints:false,lastLight:'green'}))
const zip=await createBackup(sampleBooks,sourceStorage),data=await parseBackup(zip)
if(process.env.CIJING_BACKUP_FIXTURE)await writeFile(process.env.CIJING_BACKUP_FIXTURE,new Uint8Array(await zip.arrayBuffer()))
globalThis.indexedDB=previousDB
async function device(action){const prior=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();try{return await action()}finally{globalThis.indexedDB=prior}}
async function alter(changes,{version=1,extra=false,corrupt=false}={}){
 const reader=new ZipReader(new BlobReader(zip),{useWebWorkers:false}),files=new Map()
 for(const entry of await reader.getEntries())files.set(entry.filename,await entry.getData(new Uint8ArrayWriter()))
 await reader.close()
 const manifest=JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
 for(const [path,change]of Object.entries(changes)){const before=files.get(path);files.set(path,typeof change==='function'?new TextEncoder().encode(change(new TextDecoder().decode(before))):new TextEncoder().encode(change))}
 manifest.schemaVersion=version
 for(const info of manifest.files){const bytes=files.get(info.path);info.size=bytes.length;if(!corrupt)info.sha256=await byteHash(bytes)}
 if(extra)files.set('../evil',new TextEncoder().encode('bad'))
 files.set('manifest.json',new TextEncoder().encode(JSON.stringify(manifest)))
 const writer=new ZipWriter(new BlobWriter('application/zip'),{useWebWorkers:false})
 for(const[path,bytes]of files)await writer.add(path,new Uint8ArrayReader(bytes),{level:0})
 return writer.close()
}
test('完整ZIP备份包含TXT、EPUB封面插图、目录、进度、学习、设置和译文，不依赖设备路径',async()=>{
 assert.equal(data.books.length,5);assert.equal(data.favorites.length,3);assert.equal(data.mastery.length,4);assert.equal(data.positions.length,3);assert.equal(data.translations.length,3)
 const restored=data.books.find(book=>book.id===epub.id)
 assert.equal(await backupBookIdentity(restored),await backupBookIdentity(epub));
 assert.deepEqual(restored.chapters,epub.chapters);assert.deepEqual(restored.toc,epub.toc);assert.equal(restored.resources.length,epub.resources.length)
 for(const resource of restored.resources)assert.ok(resource.blob instanceof Blob)
 assert.equal(data.settings['cijing-font-size'],'24');assert.equal(JSON.parse(data.settings['cijing-reader-preferences']).english,40)
 assert.equal(await backupBookIdentity({...txt,id:'other-device',chapters:txt.chapters.map(c=>({...c,id:'other-chapter'}))}),await backupBookIdentity(txt))
})
test('另一台空设备恢复全部个人数据与译文，正确映射进度，重复恢复不产生重复或覆盖',()=>device(async()=>{
 const storage=new MemoryStorage();storage.setItem('cijing-theme','light')
 const report=await restoreBackup(data,sampleBooks,{storage});assert.equal(report.books,2);assert.equal(report.learning,7);assert.equal(report.positions,3);assert.equal(report.translations,4)
 assert.equal(storage.getItem('cijing-theme'),'light');assert.equal(storage.getItem('cijing-font-size'),'24')
 const books=await listBooks();assert.equal(books.length,2)
 const restored=books.find(book=>book.title===txt.title);assert.notEqual(restored.id,txt.id);assert.deepEqual(restored.chapters,txt.chapters)
 assert.equal(JSON.parse(storage.getItem(`cijing-position:${restored.id}`)).offset,3)
 assert.equal((await readChapterTranslation(restored,restored.chapters[0])).status,'complete')
 assert.equal((await listFavorites()).find(e=>e.id==='sentence:003').kind,'sentence')
 const snapshot=JSON.stringify(await listFavorites()),again=await restoreBackup(data,sampleBooks,{storage})
 assert.equal(again.books,0);assert.equal(again.learning,0);assert.equal(again.translations,0);assert.equal(again.positions,0);assert.equal(again.settings,0)
 assert.equal(JSON.stringify(await listFavorites()),snapshot);assert.equal((await listBooks()).length,2)
}))
test('冲突小说另存副本，同内容书籍跨ID合并；已有进度、收藏、掌握、译文和设置均不覆盖',()=>device(async()=>{
 const storage=new MemoryStorage(),conflict={...txt,title:'同编号的另一部小说',chapters:txt.chapters.map(c=>({...c,paragraphs:['不同小说正文。']}))}
 await saveBook(conflict)
 const other={...epub,id:'existing-epub',chapters:epub.chapters.map((c,i)=>({...c,id:`existing-chapter-${i}`})),toc:epub.toc.map(t=>({...t,chapterId:`existing-chapter-${epub.chapters.findIndex(c=>c.id===t.chapterId)}`}))}
 await saveBook(other);storage.setItem(`cijing-position:${other.id}`,JSON.stringify({chapterId:other.chapters[0].id,paragraph:0,offset:1}));storage.setItem('cijing-font-size','18')
 await setFavorite({...favorites[0],translation:'已有释义'},true);await setMastered('moon',false,favorites[0]);await cacheDictionary('keep',[])
 const existingTranslation=JSON.parse(await (await file('translations/epub-en.json')).text());existingTranslation.chapters.forEach(chapter=>chapter.segments.forEach(segment=>segment.targetText='An existing translation remains here.'))
 await saveTranslationPackage(other,existingTranslation)
 const plan=await prepareRestore(data,sampleBooks);assert.equal(plan.newBooks,1);assert.equal(plan.existingBooks,4)
 await restoreBackup(data,sampleBooks,{storage})
 assert.deepEqual((await listBooks()).find(book=>book.id===txt.id),conflict);assert.equal((await listBooks()).length,3)
 assert.equal(JSON.parse(storage.getItem(`cijing-position:${other.id}`)).offset,1);assert.equal(storage.getItem('cijing-font-size'),'18')
 assert.equal((await listFavorites()).find(e=>e.id==='moon').translation,'已有释义');assert.equal((await listMastery()).find(e=>e.id==='moon').mastered,false)
 assert.equal((await readChapterTranslation(other,other.chapters[0])).segments[0].targetText,'An existing translation remains here.')
 assert.equal((await readCachedDictionary()).version,'keep')
 await restoreBackup(data,sampleBooks,{storage,restoreSettings:true});assert.equal(storage.getItem('cijing-font-size'),'24');assert.equal(storage.getItem('cijing-theme'),'dark')
}))
test('损坏、未知版本、不安全路径、篡改内容、错章节进度、任意设置键和重复编号全部拒绝且不写入',()=>device(async()=>{
 await saveBook(txt);const before=JSON.stringify(await listBooks())
 await assert.rejects(parseBackup(new Blob(['broken'])),/无法读取/)
 await assert.rejects(parseBackup(new Blob([])),/有效备份/)
 await assert.rejects(parseBackup({size:129*1024*1024}),/最大128/)
 await assert.rejects(parseBackup(await alter({},{version:2})),/版本/)
 await assert.rejects(parseBackup(await alter({},{extra:true})),/不安全/)
 await assert.rejects(parseBackup(await alter({'books/0.json':text=>text+' '},{corrupt:true})),/校验/)
 await assert.rejects(parseBackup(await alter({'state.json':text=>{const s=JSON.parse(text);s.positions[0].position.offset=999999;return JSON.stringify(s)}})),/越界/)
 await assert.rejects(parseBackup(await alter({'state.json':text=>{const s=JSON.parse(text);s.settings['other-secret-key']='bad';return JSON.stringify(s)}})),/不允许/)
 await assert.rejects(parseBackup(await alter({'state.json':text=>{const s=JSON.parse(text);s.favorites.push(s.favorites[0]);return JSON.stringify(s)}})),/重复/)
 assert.equal(JSON.stringify(await listBooks()),before);assert.equal((await listFavorites()).length,0)
}))
test('备份中的SVG重新清理脚本、事件和外部图片，不执行或请求书籍内容',async()=>{
 const reader=new ZipReader(new BlobReader(zip),{useWebWorkers:false});let path
 for(const entry of await reader.getEntries())if(entry.filename.startsWith('images/')){const bytes=await entry.getData(new Uint8ArrayWriter());if(new TextDecoder().decode(bytes).includes('<svg'))path=entry.filename}
 await reader.close();assert.ok(path)
 const parsed=await parseBackup(await alter({[path]:'<svg xmlns="http://www.w3.org/2000/svg"><script>BAD()</script><rect width="10" height="10" onclick="BAD()"/><image href="https://example.invalid/tracker.png"/></svg>'}))
 const svg=await parsed.books.flatMap(book=>book.resources??[]).find(asset=>asset.blob.type==='image/svg+xml').blob.text()
 assert.ok(svg.includes('rect'));assert.doesNotMatch(svg,/script|onclick|example.invalid|BAD/)
})
test('合并事务中途容量失败时该批全回滚；跨库部分完成明确报告，重试补齐且不影响已有数据',()=>device(async()=>{
 const storage=new MemoryStorage();await setFavorite({id:'keep',word:'keep',translation:'保留',phonetic:''},true)
 const original=IDBObjectStore.prototype.add;let count=0
 IDBObjectStore.prototype.add=function(value,...args){if(this.name==='chapters'&&++count===2)throw new DOMException('full','QuotaExceededError');return original.call(this,value,...args)}
 try{await assert.rejects(restoreBackup(data,sampleBooks,{storage}),/未全部完成.*空间不足/)}finally{IDBObjectStore.prototype.add=original}
 assert.equal((await listBooks()).length,2);assert.ok((await listFavorites()).some(e=>e.id==='keep'))
 const restored=(await listBooks()).find(book=>book.title===epub.title)
 assert.equal(await readChapterTranslation(restored,restored.chapters[0]),undefined)
 const retried=await restoreBackup(data,sampleBooks,{storage});assert.equal(retried.books,0);assert.equal(retried.translations,4);assert.equal((await listBooks()).length,2)
}))
test('学习合并与小说同编号写入采用add-only，旧记录和书籍不会被put覆盖',()=>device(async()=>{
 await saveBook(txt);await setFavorite(favorites[0],true)
 await addBackupBooks([{...txt,title:'不应覆盖'}]);await addBackupLearning([{...favorites[0],translation:'不应覆盖'}],[])
 assert.equal((await listBooks())[0].title,txt.title);assert.equal((await listFavorites())[0].translation,'月亮')
}))
test('localStorage受限时报告恢复未完成并可重试；默认不覆盖目标设备设置',()=>device(async()=>{
 const broken={getItem(){throw new Error('blocked')},setItem(){throw new Error('blocked')}}
 await assert.rejects(restoreBackup(data,sampleBooks,{storage:broken}),/未全部完成/)
 const storage=new MemoryStorage();await restoreBackup(data,sampleBooks,{storage});assert.equal(storage.getItem('cijing-font-size'),'24');assert.equal((await listBooks()).length,2)
}))
