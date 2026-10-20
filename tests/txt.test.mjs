import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { decodeText, inferTitle, splitText, txtImporter, MAX_TXT_BYTES } from '../src/features/importing/txtImporter.ts'
const fixtures = new URL('./fixtures/', import.meta.url)
const bufferOf = data => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
for (const encoding of ['utf8', 'gbk', 'gb18030']) {
  test(`正确解码 ${encoding}`, async () => {
    const data = await readFile(new URL(`${encoding}.txt`, fixtures))
    const result = decodeText(bufferOf(data))
    assert.ok(result.text.startsWith('《导入验证小说》'))
    assert.ok(result.text.includes('全书最后一句：星光照亮了归途。'))
    if (encoding === 'gb18030') assert.ok(result.text.includes('𠮷'))
  })
}
test('识别标题并以文件名回退', () => {
  assert.equal(inferTitle('test.txt', '《一本小说》\n正文'), '一本小说')
  assert.equal(inferTitle('我的书.TXT', '第一章\n正文'), '我的书')
})
test('长文分段保留全部内容，包含空行和代理对', () => {
  const text = '开始\n\n' + '𠮷山水'.repeat(20000) + '\n末尾'
  const chapters = splitText(text)
  assert.ok(chapters.length > 1)
  assert.equal(chapters.flatMap(chapter => chapter.paragraphs).join(''), text)
  for (const chapter of chapters) assert.ok(!/[\uD800-\uDBFF]$/.test(chapter.paragraphs[0]))
})
test('拒绝空白、二进制和错误的 UTF-8', () => {
  for (const bytes of [new Uint8Array(), new TextEncoder().encode(' \n '), new Uint8Array([0, 0, 0]), new Uint8Array([255])]) {
    assert.throws(() => decodeText(bytes.buffer, 'utf-8'))
  }
})
test('导入器输出统一 Book 并保留完整正文', async () => {
  const book = await txtImporter.parse(new File(['开头\r\n正文\r\n最后'], '书名.txt'))
  assert.equal(book.title, '书名')
  assert.equal(book.source, 'txt')
  assert.equal(book.chapters[0].paragraphs[0], '开头\n正文\n最后')
  assert.ok(book.id.startsWith('local-'))
})
test('拒绝非 TXT 与超限文件', async () => {
  await assert.rejects(txtImporter.parse(new File(['内容'], 'book.epub')))
  await assert.rejects(txtImporter.parse(new File([new Uint8Array(MAX_TXT_BYTES + 1)], 'large.txt')))
})
test('换行在12000边界时新导入不超限，原字符及换行全部保留',()=>{
 const text='甲'.repeat(12000)+'\n'+'尾声'
 const chapters=splitText(text)
 assert.equal(chapters.flatMap(c=>c.paragraphs).join(''),text)
 assert.ok(chapters.every(c=>c.paragraphs[0].length<=12000))
})
