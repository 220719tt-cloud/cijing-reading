import test from 'node:test'
import assert from 'node:assert/strict'
import { backgrounds, normalizePreferences, loadPreferences } from '../src/features/reading/readerPreferences.ts'
import { loadFontSize, loadPosition } from '../src/features/reading/readingPosition.ts'
const values = new Map()
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
test('默认覆盖翻页、0% 英语；损坏设置安全回退', () => {
  assert.equal(normalizePreferences(null).mode, 'cover')
  assert.equal(normalizePreferences({ english: 30, mode: 'invalid', background: 'pink' }).english, 0)
  values.set('cijing-reader-preferences','{invalid')
  assert.equal(loadPreferences(true).background, 'black')
})
test('六档英语和四种模式可序列化恢复', () => {
  for (const english of [0,20,40,60,80,100]) for (const mode of ['cover','slide','scroll','none']) {
    const preferences = { english, mode, background: 'blue', lastLight: 'blue', chineseHints: false }
    values.set('cijing-reader-preferences',JSON.stringify(preferences))
    assert.deepEqual(loadPreferences(),preferences)
  }
})
test('六种背景均有效，夜间记住的浅色不接受深色值', () => {
  for (const background of backgrounds) assert.equal(normalizePreferences({ background: background.id }).background,background.id)
  assert.equal(normalizePreferences({ lastLight: 'black' }).lastLight, 'cream')
})
test('字体与原文位置恢复不依赖翻页模式', () => {
  values.set('cijing-font-size','26')
  assert.equal(loadFontSize(),26)
  values.set('cijing-font-size','100')
  assert.equal(loadFontSize(),18)
  const position = { chapterId: 'one', paragraph: 0, offset: 18 }
  values.set('cijing-position:test',JSON.stringify(position))
  for (const mode of ['cover','slide','scroll','none']) {
    values.set('cijing-reader-preferences',JSON.stringify({mode}))
    assert.deepEqual(loadPosition('test',[{id:'one',title:'章',order:0,paragraphs:['文字'.repeat(100)]}]),position)
  }
})

test('中文提示默认关闭，旧偏好安全迁移，只有布尔 true 开启并可恢复', () => {
  for (const value of [undefined, null, 'true', 'false', 0, 1, false]) assert.equal(normalizePreferences({ chineseHints: value, english: 40 }).chineseHints, false)
  values.set('cijing-reader-preferences',JSON.stringify({english:40,chineseHints:true,mode:'slide'}))
  assert.equal(loadPreferences().chineseHints,true)
  assert.equal(loadPreferences().english,40)
  assert.equal(loadPreferences().mode,'slide')
  values.set('cijing-reader-preferences',JSON.stringify({...loadPreferences(),chineseHints:false}))
  assert.equal(loadPreferences().chineseHints,false)
})
