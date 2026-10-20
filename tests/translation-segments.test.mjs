import test from 'node:test'
import assert from 'node:assert/strict'
import {translationRanges} from '../src/features/translation/automatic/segments.ts'
import {missingSegments} from '../src/features/translation/automatic/engine.ts'

const groups=text=>translationRanges(text).map(range=>text.slice(range.start,range.end))
test('自动翻译保留完整引语及明确的短说话标记，避免独立He said句组',()=>{
 const text='“别担心。我会回来。”他说。她点了点头。“你保证吗？”她低声问。'
 assert.deepEqual(groups(text),['“别担心。我会回来。”他说。','她点了点头。','“你保证吗？”她低声问。'])
 assert.deepEqual(groups('“你在等谁？”男人忽然问。林澈没有回答。'),['“你在等谁？”男人忽然问。','林澈没有回答。'])
 for(const value of ['「别担心。明天见！」她回答。','『他说：“回来！”』他解释道。','"Stay here. Wait!"她说。','没有引语。他说。','“没有闭合。她走了。','\n“你好。”  她说。 \n'])assert.equal(groups(value).join(''),value)
})
test('缓存与人工范围不变，新分组不跨过已有译文',()=>{
 const text='“别担心。”他说。她点头。',book={chapters:[{id:'a',paragraphs:[text]}]}
 const cached={segments:[{id:'manual',source:{paragraph:0,start:0,end:6},sourceText:text.slice(0,6),targetText:'Do not worry.'}]}
 const before=JSON.stringify({book,cached})
 const missing=missingSegments(book,0,cached)
 assert.ok(missing.every(item=>item.source.start>=6))
 assert.equal(missing.map(item=>item.sourceText).join(''),text.slice(6))
 assert.equal(JSON.stringify({book,cached}),before)
})
