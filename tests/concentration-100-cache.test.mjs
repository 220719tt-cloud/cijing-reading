import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {IDBFactory} from 'fake-indexeddb'
import {buildBilingualDisplay} from '../src/features/translation/display.ts'
import {buildDisplayText,displayToSource,sourceToDisplay} from '../src/features/replacement/displayText.ts'
import {withOriginalEnglishLookup} from '../src/features/replacement/originalEnglish.ts'
import {createTranslationTemplate} from '../src/features/translation/package.ts'
import {saveChapterTranslation,readChapterTranslation} from '../src/features/translation/storage.ts'
const rules=JSON.parse(await readFile(new URL('../src/features/replacement/data/rules.json',import.meta.url)))
const chapter={id:'hundred-cache',title:'正文',order:0,paragraphs:Array(10).fill('邮局旁的月亮十分明亮。')}
// Deliberate translation doubles test cached rendering, not AI translation quality.
const partial={segments:chapter.paragraphs.slice(0,9).map((sourceText,paragraph)=>({id:`p${paragraph}`,chapterId:chapter.id,source:{paragraph,start:0,end:sourceText.length},sourceText,targetText:`The moon shone over the post office, scene ${paragraph}.`}))}
const baseline=buildDisplayText(chapter.paragraphs.join('\n\n'),rules,{concentration:40,seed:'display100'})
const render=(level,value=partial,ch=chapter,base=baseline)=>buildBilingualDisplay(ch,base,value,level,'display100')
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')

test('90%缓存切100%显示全部九句英文和一段原文，缺口不套本地词组，不冒充完整译文',()=>{
 const before=JSON.stringify({chapter,partial,baseline}),value=render(100)
 assert.equal(value.coveredPercent,90);assert.equal(value.translated,9);assert.equal(value.complete,false);assert.equal(value.localCount,0)
 assert.equal(value.model.text.split('The moon shone').length-1,9)
 assert.ok(value.model.text.endsWith(chapter.paragraphs[9]));assert.match(value.message,/全部可用的缓存英文译文/);assert.match(value.badge,/实际 90%.*部分译文/)
 assert.equal(value.model.runs.map(r=>value.model.original.slice(r.sourceStart,r.sourceEnd)).join(''),value.model.original)
 for(const r of value.model.runs){assert.equal(displayToSource(value.model,r.displayStart),r.sourceStart);assert.equal(sourceToDisplay(value.model,r.sourceStart),r.displayStart)}
 assert.equal(JSON.stringify({chapter,partial,baseline}),before)
})
test('0/20/40/60/80的完整显示结果与修改前指纹一致，反复切换不影响源位置',()=>{
 const expected=['22380c48e03add732022664a2ad787e3d3bc491877bbd8c62781b27f4b7d0be7','dfd6a6c687d10768cb7594dacfd861a4c76a18af7dc5da4e404674bb599a4deb','2d55a5453ab0ffda3c33ce2a7c1dafc7e80e47ba69a4ef44f07580fc9253eb12','f9e1c92e606ce034ea980b7ec058a5b76e17b65b3373440aa0acaedfd96d0a9b','3d787101580131995500decb754bd73021e8a9185828cef0137e29d13275e372']
 for(const [index,level]of [0,20,40,60,80].entries()){assert.equal(digest(render(level)),expected[index]);render(100);assert.equal(digest(render(level)),expected[index])}
})
test('100%缺缓存如实显示0%；完整缓存显示100%，不受英文长度或提示开关影响',()=>{
 const missing=render(100,{segments:[]});assert.equal(missing.coveredPercent,0);assert.equal(missing.model.text,baseline.original)
 const complete={segments:[...partial.segments,{...partial.segments[0],id:'p9',source:{paragraph:9,start:0,end:chapter.paragraphs[9].length},targetText:'The final moonlit scene.'}]}
 assert.equal(render(100,complete).coveredPercent,100)
 const long={segments:partial.segments.map(s=>({...s,targetText:s.targetText.repeat(3)}))};assert.equal(render(100,long).coveredPercent,90)
 const hinted=buildBilingualDisplay(chapter,baseline,partial,100,'display100',{showChineseHints:true})
 assert.equal(hinted.coveredPercent,90);assert.equal(hinted.model.text,render(100).model.text)
})
test('EPUB保护标题/插图/pre；部分100%英文可查词且中文原句和位置仍准确',()=>{
 const ch={...chapter,paragraphs:['章标题','\uFFFC','保留代码',...chapter.paragraphs],blocks:[{kind:'heading'},{kind:'image'},{kind:'pre'},...chapter.paragraphs.map(()=>({kind:'paragraph'}))]}
 const cache={segments:partial.segments.map(s=>({...s,source:{...s.source,paragraph:s.source.paragraph+3}}))}
 const base=buildDisplayText(ch.paragraphs.join('\n\n'),[],{concentration:40,seed:'display100'}),value=render(100,cache,ch,base)
 assert.equal(value.coveredPercent,90);assert.ok(value.model.text.startsWith('章标题\n\n\uFFFC\n\n保留代码'))
 const lookup=withOriginalEnglishLookup(value.model,['post office'],new Map([['post office','邮局']]))
 const word=lookup.runs.find(r=>r.lookup&&r.english==='post office');assert.ok(word);assert.equal(word.lookupMeaning,'邮局');assert.equal(word.contextChinese,chapter.paragraphs[0])
})
test('保存的部分译文重开后切档仅使用缓存，原译文/失败记录不变且零fetch',async()=>{
 const oldDB=globalThis.indexedDB,oldFetch=globalThis.fetch;globalThis.indexedDB=new IDBFactory();let requests=0
 globalThis.fetch=async()=>{requests++;throw new Error('Display must not fetch')}
 try{
  const book={schemaVersion:1,id:'hundred-cache-book',title:'缓存测试',source:'txt',chapters:[chapter]}
  const cache=(await createTranslationTemplate(book)).chapters[0];cache.segments=partial.segments
  cache.failures=[{source:{paragraph:9,start:0,end:chapter.paragraphs[9].length},code:'MODEL_ALIGNMENT_INVALID',attempts:1,failedAt:'2026-10-20T00:00:00Z'}]
  const saved=await saveChapterTranslation(book,0,cache),before=JSON.stringify(saved)
  for(const level of [80,100,20,100,0,100]){const loaded=await readChapterTranslation(book,chapter);const value=render(level,loaded);if(level===100)assert.equal(value.coveredPercent,90)}
  assert.equal(JSON.stringify(await readChapterTranslation(book,chapter)),before);assert.equal(requests,0)
 }finally{globalThis.indexedDB=oldDB;globalThis.fetch=oldFetch}
})
