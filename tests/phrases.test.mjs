import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mergeVocabulary, normalizeQuery, queryVocabulary } from '../src/features/vocabulary/query.ts'
import { resolveVocabulary } from '../src/features/vocabulary/repository.ts'
const data=new URL('../src/features/vocabulary/data/',import.meta.url)
const base=JSON.parse(await readFile(new URL('lookup.json',data)))
const raw=await readFile(new URL('phrases.json',data)), phrases=JSON.parse(raw)
const manifest=JSON.parse(await readFile(new URL('manifest.json',data)))
const legacy=JSON.parse(await readFile(new URL('../data/vocabulary/legacy-phrases.json',import.meta.url)))
const entries=mergeVocabulary(base,phrases)
const required=['think of','think about','figure out','give up','carry out','account for','be aware of','in terms of','give rise to','without hesitation']
test('1300条短语、原77条保留，合并后无重复且不删除6923个单词',()=>{
 assert.equal(phrases.length,1300)
 assert.equal(new Set(phrases.map(entry=>entry.id)).size,1300)
 for(const key of legacy)assert.ok(phrases.some(entry=>entry.id===key),key)
 assert.equal(entries.length,8223)
 assert.equal(manifest.count,entries.length)
 assert.equal(entries.filter(entry=>entry.kind==='word').length,6923)
 assert.equal(entries.filter(entry=>entry.kind==='phrase').length,1300)
})
test('必测10条短语完整匹配第一项、多个关键词与部分关键词可检索',()=>{
 for(const key of required)assert.equal(queryVocabulary(entries,key.toUpperCase())[0].id,key)
 assert.ok(queryVocabulary(entries,'hesitation').some(entry=>entry.id==='without hesitation'))
 assert.ok(queryVocabulary(entries,'terms of').some(entry=>entry.id==='in terms of'))
 assert.ok(queryVocabulary(entries,'of think').some(entry=>entry.id==='think of'))
 assert.equal(queryVocabulary(entries,'  THINK   OF  ')[0].id,'think of')
})
test('多义查询及中文释义显示数据完整，不为单义表达编造额外释义',()=>{
 const think=queryVocabulary(entries,'think of')[0]
 for(const meaning of ['想到','想起','考虑','认为'])assert.ok(think.meanings.includes(meaning))
 assert.ok(queryVocabulary(entries,'想到').some(entry=>entry.id==='think of'))
 const account=queryVocabulary(entries,'account for')[0]
 assert.ok(account.meanings.some(meaning=>meaning.includes('比例')))
 assert.ok(account.meanings.some(meaning=>meaning.includes('原因')))
 assert.ok(queryVocabulary(entries,'毫不犹豫').some(entry=>entry.id==='without hesitation'))
 for(const entry of phrases){assert.ok(entry.meanings.length>0);assert.ok(entry.meanings.every(meaning=>meaning.trim()))}
})
test('规范化重复条目合并释义和标签，不丢失来源，词条ID稳定',()=>{
 const a={id:'wrong',word:' THINK  OF ',kind:'phrase',translation:'想到',meanings:['想到'],tags:['cet6'],sources:['one'],sourceEntries:{list:['cet6']},forms:['thought of']}
 const b={...a,id:'think of',word:'think of',translation:'考虑',meanings:['考虑'],tags:['ky'],sources:['two'],sourceEntries:{list:['npee']}}
 const merged=mergeVocabulary([a],[b])
 assert.equal(merged.length,1)
 assert.equal(merged[0].id,'think of')
 assert.deepEqual(merged[0].meanings,['想到','考虑'])
 assert.deepEqual(merged[0].tags,['cet6','ky'])
 assert.deepEqual(merged[0].sources,['one','two'])
 assert.deepEqual(merged[0].sourceEntries.list,['cet6','npee'])
})
test('源词形支持查询别名，不生成独立重复短语',()=>{
 for(const [form,canonical]of [['thought of','think of'],['thinking about','think about'],['gave up','give up'],['carried out','carry out'],['was aware of','be aware of']])assert.equal(queryVocabulary(entries,form)[0].id,canonical)
 assert.equal(entries.filter(entry=>entry.id==='gave up').length,0)
})
test('每条短语包含类型、难度、来源，去重主分类与重叠考试标签分别可核对',()=>{
 const counts={}
 for(const entry of phrases){
  assert.equal(entry.word,normalizeQuery(entry.word))
  assert.ok(entry.difficulty.length>0)
  assert.ok(entry.phraseType)
  assert.ok(entry.sources.length>0 && entry.sourceEntries)
  counts[entry.category]=(counts[entry.category]??0)+1
  if(entry.tags.includes('cet6'))assert.ok(entry.sourceEntries['english-phrases'].includes('cet6'))
  if(entry.tags.includes('ky'))assert.ok(entry.sourceEntries['english-phrases'].includes('npee'))
 }
 assert.deepEqual(counts,manifest.phraseCategories)
 assert.equal(counts['common-verb'],400);assert.equal(counts.cet6,350);assert.equal(counts.postgraduate,350);assert.equal(counts['daily-reading'],200)
})
test('增量短语数据的哈希、体积预算、许可和跳过记录齐全',async()=>{
 assert.equal(raw.length,manifest.phraseBytes)
 assert.equal(createHash('sha256').update(raw).digest('hex'),manifest.phraseSha256)
 assert.ok(raw.length<700_000);assert.ok(gzipSync(raw).length<100_000)
 const notice=await readFile(new URL('../public/licenses/PHRASE-NOTICE.txt',import.meta.url),'utf8')
 assert.match(notice,/CC BY-SA 4.0/);assert.match(notice,/ECDICT/);assert.match(notice,/CC-CEDICT/)
 const excluded=JSON.parse(await readFile(new URL('../data/vocabulary/phrase-exclusions.json',import.meta.url)))
 assert.equal(excluded.length,manifest.phraseExcludedCount)
 assert.ok(excluded.some(entry=>entry.phrase==='a chance of lifetime'))
 assert.ok(excluded.some(entry=>entry.phrase==='be good for'&&entry.reason==='editorial-review'))
})
test('合并后的短语库离线缓存可完整查询，不请求网络',async()=>{
 const result=await resolveVocabulary(manifest.version,manifest.count,{
  readCache:async()=>({version:manifest.version,entries}),
  readAsset:async()=>assert.fail('有效缓存不应联网'),writeCache:async()=>assert.fail('无需重写'),
 })
 assert.equal(result.offlineReady,true)
 for(const key of required)assert.equal(queryVocabulary(result.entries,key)[0].id,key)
})
