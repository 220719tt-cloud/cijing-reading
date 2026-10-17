import test from 'node:test'
import assert from 'node:assert/strict'
import {IDBFactory} from 'fake-indexeddb'
import {learningKind,filterLearningEntries,withLearningEntries} from '../src/features/learning/favorites.ts'
import {contextEntryForWord,learningEntryForWord} from '../src/features/learning/cardEntry.ts'
import {listFavorites,setFavorite,listMastery,setMastered,cacheDictionary,readCachedDictionary} from '../src/features/vocabulary/storage.ts'
import {saveBook,listBooks} from '../src/shared/storage/books.ts'
import {withOriginalEnglishLookup} from '../src/features/replacement/originalEnglish.ts'
import {buildDisplayText} from '../src/features/replacement/displayText.ts'
import {buildBilingualDisplay} from '../src/features/translation/display.ts'
const word={id:'moon',word:'moon',translation:'月亮',phonetic:'mu:n',kind:'word'}
const phrase={id:'give up',word:'give up',translation:'放弃',phonetic:'',kind:'phrase'}
const sentence={id:'sentence:003',word:"Don't worry.",translation:'别担心。',phonetic:'',kind:'sentence'}
test('旧记录与显式类型兼容，单词／短语／句子分别分类，不把短句当短语',()=>{
 assert.equal(learningKind({id:'moon',word:'moon'}),'word')
 assert.equal(learningKind({id:'give up',word:'give up'}),'phrase')
 assert.equal(learningKind({id:'sentence:012',word:'Hurry!'}),'sentence')
 assert.equal(learningKind({id:'old',word:'He nodded.'}),'sentence')
 const entries=withLearningEntries([],[word,phrase,sentence])
 for(const type of ['word','phrase','sentence'])assert.equal(filterLearningEntries(entries,'',type).length,1)
 assert.equal(filterLearningEntries(entries,'','all').length,3)
 assert.equal(filterLearningEntries(entries,'别担心。','sentence')[0].id,sentence.id)
 assert.equal(filterLearningEntries(entries,"DON’T worry.",'sentence')[0].id,sentence.id)
 assert.equal(filterLearningEntries(entries,'moon','phrase').length,0)
})
test('超过30／100条个人收藏可分页查看全部，分类与搜索不截掉后面的记录',()=>{
 const records=Array.from({length:135},(_,i)=>({...word,id:`entry-${i}`,word:`word-${i}`,translation:`释义${i}`}))
 const entries=withLearningEntries([],records),results=filterLearningEntries(entries,'','word')
 assert.equal(results.length,135);assert.equal(results.slice(0,30).length,30);assert.equal(results.slice(120,150).length,15)
 assert.equal(filterLearningEntries(entries,'释义134','all')[0].id,'entry-134')
})
test('阅读卡片保存准确类型与完整英文，不把sentence编号写成文本',()=>{
 for(const entry of [word,phrase,sentence]){
  const run={entryId:entry.id,english:entry.word,chinese:entry.translation,sentence:entry.kind==='sentence'}
  const record=learningEntryForWord(run,null)
  assert.equal(record.kind,entry.kind);assert.equal(record.word,entry.word);assert.equal(record.translation,entry.translation)
 }
})
test('真实译文的每个点词可收藏同一完整英文句组，保存对应中文，不编造逐词对齐',async()=>{
 const chapter={id:'chapter',title:'来信',order:0,paragraphs:['他点了点头。']}
 const translation={segments:[{id:'one',source:{paragraph:0,start:0,end:7},sourceText:'他点了点头。',targetText:'He nodded.'}]}
 // Source lengths must match; real packages have already been validated before display.
 translation.segments[0].source.end=chapter.paragraphs[0].length
 const base=buildDisplayText(chapter.paragraphs[0],[],{concentration:100,seed:'x'})
 const display=withOriginalEnglishLookup(buildBilingualDisplay(chapter,base,translation,100,'x').model)
 const tokens=display.runs.filter(run=>run.lookup);assert.ok(tokens.length>=2)
 const a=await contextEntryForWord(tokens[0]),b=await contextEntryForWord(tokens[1])
 assert.deepEqual(a,b);assert.equal(a.word,'He nodded.');assert.equal(a.translation,'他点了点头。');assert.equal(a.kind,'sentence')
 assert.notEqual(a.id,(await contextEntryForWord({...tokens[0],contextChinese:'她点了点头。'})).id)
 assert.equal(await contextEntryForWord({sentence:true,contextEnglish:'He nodded.',contextChinese:'他点了点头。'}),null)
 assert.equal(await contextEntryForWord({english:'moon'}),null)
})
test('刷新／关闭后的新连接读取三类收藏与掌握，取消收藏独立于掌握且保留书库和词典',async()=>{
 const previous=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory()
 try{
  const book={schemaVersion:1,id:'keep-book',title:'保留小说',source:'txt',chapters:[]}
  await saveBook(book);await cacheDictionary('keep',[])
  for(const entry of [word,phrase,sentence]){await setFavorite(entry,true);await setMastered(entry.id,true,entry)}
  // Storage helpers close each connection: all following reads reopen the databases.
  const records=await listFavorites();assert.equal(records.length,3)
  assert.deepEqual(new Set(records.map(learningKind)),new Set(['word','phrase','sentence']))
  await setFavorite(sentence,false)
  assert.equal((await listFavorites()).length,2);assert.equal((await listMastery()).find(entry=>entry.id===sentence.id).mastered,true)
  assert.equal((await listMastery()).find(entry=>entry.id===sentence.id).entry.kind,'sentence')
  await setMastered(sentence.id,false);assert.equal((await listMastery()).find(entry=>entry.id===sentence.id).entry.word,sentence.word)
  await setFavorite(sentence,true);assert.equal((await listFavorites()).find(entry=>entry.id===sentence.id).translation,'别担心。')
  assert.deepEqual(await listBooks(),[book]);assert.equal((await readCachedDictionary()).version,'keep')
 }finally{globalThis.indexedDB=previous}
})
