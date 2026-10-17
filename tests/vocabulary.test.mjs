import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { queryVocabulary, normalizeQuery } from '../src/features/vocabulary/query.ts'
const data = new URL('../src/features/vocabulary/data/',import.meta.url)
const raw = await readFile(new URL('lookup.json',data))
const entries = JSON.parse(raw), replacements = JSON.parse(await readFile(new URL('replacements.json',data)))
const manifest = JSON.parse(await readFile(new URL('manifest.json',data)))
test('基础词库7000条去重、字段完整，体积与校验清单一致', () => {
  assert.equal(entries.length,7000)
  assert.equal(new Set(entries.map(entry=>entry.id)).size,7000)
  assert.equal(manifest.baseCount,entries.length)
  assert.equal(manifest.bytes,raw.length)
  assert.equal(manifest.sha256,createHash('sha256').update(raw).digest('hex'))
  assert.ok(raw.length < 1_500_000)
  assert.ok(gzipSync(raw).length < 400_000)
  for (const entry of entries) {
    assert.equal(entry.id,normalizeQuery(entry.word))
    assert.match(entry.translation,/[\u4e00-\u9fff]/)
    assert.ok(entry.translation.length > 0)
    assert.ok(['word','phrase'].includes(entry.kind))
  }
})
test('精确词优先，大小写与多空格规范化，中文及短语查询有效', () => {
  assert.equal(queryVocabulary(entries,' SECRET ')[0].id,'secret')
  assert.equal(queryVocabulary(entries,'IN  THE END')[0].id,'in the end')
  assert.ok(queryVocabulary(entries,'勇气').some(entry=>entry.id==='courage'))
  assert.ok(queryVocabulary(entries,'secret').every(entry=>entry.translation))
  assert.equal(queryVocabulary(entries,'').length,0)
  assert.equal(queryVocabulary(entries,'nonexistent-word-zz').length,0)
  assert.ok(queryVocabulary(entries,'a').length <= 30)
})
test('来源许可保留，考试标签只作参考，短语真实存在', async () => {
  const license = await readFile(new URL('../public/licenses/ECDICT-MIT.txt',import.meta.url),'utf8')
  assert.match(license,/MIT License/)
  assert.match(license,/Permission is hereby granted/)
  assert.match(manifest.source.commit,/^[a-f0-9]{40}$/)
  assert.equal(entries.filter(entry=>entry.kind==='phrase').length,77)
  assert.ok(entries.some(entry=>entry.id==='conspiracy'))
})
test('独立替换表30条，引用查询词并保留语境约束，全部未启用', async () => {
  const ids = new Set(entries.map(entry=>entry.id))
  assert.equal(replacements.length,30)
  assert.equal(new Set(replacements.map(item=>item.id)).size,30)
  for (const item of replacements) {
    assert.ok(ids.has(item.entryId))
    assert.equal(item.enabled,false)
    assert.equal(item.status,'candidate')
    assert.ok(item.context && item.exclude && item.sourceMeaning)
  }
  const published = JSON.parse(await readFile(new URL('../public/vocabulary/replacements.json',import.meta.url)))
  assert.deepEqual(published,replacements)
})
