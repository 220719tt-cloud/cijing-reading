import type { Book } from '../../shared/types/book'
import type { BookImporter, TextEncoding } from './types'

export const MAX_TXT_BYTES = 15 * 1024 * 1024
export function decodeText(bytes: ArrayBuffer, encoding: TextEncoding = 'auto') {
  const candidates = encoding === 'auto' ? ['utf-8', 'gb18030', 'gbk'] : [encoding]
  for (const candidate of candidates) {
    try {
      const text = new TextDecoder(candidate, { fatal: true }).decode(bytes)
      if (text.includes('\u0000')) throw new Error('binary')
      if (!text.trim()) throw new Error('empty')
      return { text: text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), encoding: candidate }
    } catch { /* Try the next supported Chinese encoding. */ }
  }
  throw new Error('无法读取正文：文件可能为空、编码不受支持或不是纯文本。请尝试另选编码，或另存为 UTF-8 TXT。')
}
export function inferTitle(fileName: string, text: string) {
  const firstLine = text.split('\n').find(line => line.trim())?.trim() ?? ''
  const markedTitle = firstLine.match(/^《([^》\n]{1,80})》(?:\s*(?:作者[：:].*)?)?$/)?.[1]
  return markedTitle || fileName.replace(/\.txt$/i, '').trim() || '未命名小说'
}
/** 按显示分段限制单页 DOM 大小，保留每一个字符；这些分段不是章节识别结果。 */
export function splitText(text: string): Book['chapters'] {
  const chunks: string[] = []
  let rest = text
  while (rest.length > 12000) {
    let end = rest.lastIndexOf('\n', 11999)
    if (end < 6000) end = 12000
    else end += 1
    const code = rest.charCodeAt(end - 1)
    if (code >= 0xd800 && code <= 0xdbff) end -= 1
    chunks.push(rest.slice(0, end))
    rest = rest.slice(end)
  }
  if (rest) chunks.push(rest)
  return chunks.map((chunk, order) => ({ id: `part-${order + 1}`, order, title: chunks.length === 1 ? '正文' : `正文 · 第 ${order + 1} 段`, paragraphs: [chunk] }))
}
export const txtImporter: BookImporter = {
  format: 'txt',
  accepts: file => /\.txt$/i.test(file.name),
  async parse(file, options) {
    if (!this.accepts(file)) throw new Error('本次仅支持 .txt 文件。')
    if (file.size > MAX_TXT_BYTES) throw new Error('当前单本支持最大 15 MB 的 TXT，请拆分后导入。')
    const decoded = decodeText(await file.arrayBuffer(), options?.encoding)
    return {
      schemaVersion: 1, id: `local-${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('')}`,
      title: inferTitle(file.name, decoded.text), author: '本地导入', source: 'txt',
      originalFileName: file.name, encoding: decoded.encoding, importedAt: new Date().toISOString(),
      palette: 'mist', genre: '本地小说', chapters: splitText(decoded.text),
    }
  },
}
