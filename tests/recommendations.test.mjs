import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { relatedPhrases } from '../src/features/vocabulary/recommendations.ts'
import { mergeVocabulary, queryVocabulary } from '../src/features/vocabulary/query.ts'
const root=new URL('../src/features/vocabulary/data/',import.meta.url)
const entries=mergeVocabulary(JSON.parse(await readFile(new URL('lookup.json',root))),JSON.parse(await readFile(new URL('phrases.json',root))))
test('give 优先显示六个现有实用短语，单词本身仍排第一',()=>{
 assert.equal(queryVocabulary(entries,'give')[0].id,'give')
 assert.deepEqual(relatedPhrases(entries,'give').phrases.slice(0,6).map(entry=>entry.id),['give up','give in','give away','give rise to','give a hand','give way to'])
 assert.ok(relatedPhrases(entries,'give').phrases.length>6)
})
test('think 与 thinking 关联已有短语，完整短语优先且不展示单词推荐区',()=>{
 for(const query of ['think','thinking']){
  const result=relatedPhrases(entries,query)
  assert.ok(result.phrases.some(entry=>entry.id==='think of'))
  assert.ok(result.phrases.some(entry=>entry.id==='think about'))
 }
 assert.equal(queryVocabulary(entries,'think of')[0].id,'think of')
 assert.equal(relatedPhrases(entries,'think of').phrases.length,0)
})
test('推荐按词边界关联，不以相同字母错误关联',()=>{
 const give=relatedPhrases(entries,'give').phrases
 assert.ok(give.every(entry=>entry.id.split(' ').includes('give')))
 assert.equal(relatedPhrases(entries,'hink').phrases.length,0)
 assert.equal(relatedPhrases(entries,'forgive').phrases.some(entry=>entry.id==='give up'),false)
 const ids=new Set(entries.map(entry=>entry.id))
 for(const entry of give)assert.ok(ids.has(entry.id))
})
