import test from 'node:test'
import assert from 'node:assert/strict'
import { chapterText, offsetToPosition, positionToOffset, pageForOffset } from '../src/features/reading/readingPosition.ts'
const chapter = { id: 'chapter-1', title: '测试', order: 0, paragraphs: ['第一段文字', '第二段文字𠮷', '末尾'] }
test('原文位置往返，段落内容不被改写', () => {
  const original = JSON.stringify(chapter)
  for (let paragraph = 0; paragraph < chapter.paragraphs.length; paragraph++) {
    for (let offset = 0; offset <= chapter.paragraphs[paragraph].length; offset++) {
      const position = { chapterId: chapter.id, paragraph, offset }
      assert.deepEqual(offsetToPosition(chapter, positionToOffset(chapter, position)), position)
    }
  }
  assert.equal(JSON.stringify(chapter), original)
})
test('字号重排后用原文偏移定位所在页，而非旧页码', () => {
  assert.equal(pageForOffset([0, 100, 200, 300], 210), 2)
  assert.equal(pageForOffset([0, 60, 120, 180, 240], 210), 3)
  assert.equal(pageForOffset([0], 210), 0)
})
test('越界位置钳制到正文范围', () => {
  assert.equal(positionToOffset(chapter, { chapterId: chapter.id, paragraph: 999, offset: 999 }), chapterText(chapter).length)
  assert.deepEqual(offsetToPosition(chapter, -1), { chapterId: chapter.id, paragraph: 0, offset: 0 })
})
