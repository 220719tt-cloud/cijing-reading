import {learningEntryForWord} from '../src/features/learning/cardEntry.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import {IDBFactory} from 'fake-indexeddb'
import {buildDisplayText,sourceToDisplay,displayToSource} from '../src/features/replacement/displayText.ts'
import {applySentenceLibrary} from '../src/features/sentences/display.ts'
import {searchSentences} from '../src/features/sentences/library.ts'
import {chapterText} from '../src/features/reading/readingPosition.ts'
import {fragmentsForBlock} from '../src/features/reading/epubDisplay.ts'
import {withOriginalEnglishLookup} from '../src/features/replacement/originalEnglish.ts'
import {buildBilingualDisplay} from '../src/features/translation/display.ts'
import {positionForDisplay,displayOffsetForPosition,displayFingerprint} from '../src/features/translation/position.ts'
import {createTranslationTemplate,validateTranslationPackage} from '../src/features/translation/package.ts'
import {setFavorite,listFavorites,setMastered,listMastery} from '../src/features/vocabulary/storage.ts'
import {withLearningEntries} from '../src/features/learning/favorites.ts'
import {queryVocabulary} from '../src/features/vocabulary/query.ts'
const raw=await readFile(new URL('../src/features/sentences/data/sentences.json',import.meta.url))
const entries=JSON.parse(raw)
const manifest=JSON.parse(await readFile(new URL('../src/features/sentences/data/manifest.json',import.meta.url)))
const rules=JSON.parse(await readFile(new URL('../src/features/replacement/data/rules.json',import.meta.url)))
const story=await readFile(new URL('./fixtures/sentence-story.txt',import.meta.url),'utf8')
const chapter={id:'story',title:'第一章 来信',order:0,paragraphs:story.split('\n')}
function render(chapter,concentration,seed='sentence-test',translation){
 const baseline=buildDisplayText(chapterText(chapter),rules,{concentration,seed})
 const bilingual=buildBilingualDisplay(chapter,baseline,translation,concentration,seed)
 return applySentenceLibrary(chapter,bilingual.model,entries,{concentration,seed,titles:['夜里的来信',chapter.title]})
}
test('200条原创句型唯一、分类齐全、完整英文及来源明确，文件大小与校验和可复现',async()=>{
 assert.equal(entries.length,200);assert.equal(new Set(entries.map(e=>e.id)).size,200);assert.equal(new Set(entries.map(e=>e.chinese)).size,200)
 assert.equal(new Set(entries.map(e=>e.english.toLowerCase())).size,200)
 for(const category of ['conversation','thought','action','emotion','setting'])assert.equal(entries.filter(e=>e.category===category).length,40)
 for(const entry of entries){assert.equal(entry.source,manifest.source);assert.match(entry.chinese,/[。？！]$/);assert.match(entry.english,/^[A-Z].*[.!?]$/);assert.doesNotMatch(entry.english,/[\u3400-\u9fff{}<>]/)}
 assert.equal(raw.length,manifest.bytes);assert.equal(gzipSync(raw).length,manifest.gzipBytes)
 assert.ok(raw.length<35000);assert.equal(createHash('sha256').update(raw).digest('hex'),manifest.sha256)
 const source=await readFile(new URL('../src/features/sentences/data/editorial.tsv',import.meta.url))
 assert.equal(createHash('sha256').update(source).digest('hex'),manifest.sourceSha256)
})
test('每条句型均可在独立叙述或对话边界匹配，不改动或漏掉其余原文',()=>{
 for(const entry of entries){
  const source=entry.category==='conversation'?`“${entry.chinese}”`:entry.chinese
  const c={...chapter,paragraphs:[source]};const result=render(c,40)
  assert.equal(result.eligible,1,entry.id);assert.equal(result.replaced,1,entry.id)
  assert.equal(result.model.original,source);assert.equal(result.model.text,entry.category==='conversation'?`“ ${entry.english} ”`:` ${entry.english} `)
  assert.equal(result.model.runs.filter(r=>r.sentence).length,1)
 }
})
test('原创小说20/40均有整句，40覆盖更多；稳定、嵌套选取，不改写原文',()=>{
 const before=JSON.stringify(chapter),a=render(chapter,20),b=render(chapter,40)
 assert.ok(a.replaced>=2);assert.ok(b.replaced>a.replaced);assert.ok(b.eligible>=20)
 const keys=new Set(b.model.runs.filter(r=>r.sentence).map(r=>r.sourceStart))
 for(const run of a.model.runs.filter(r=>r.sentence))assert.ok(keys.has(run.sourceStart))
 assert.deepEqual(a,render(chapter,20));assert.deepEqual(b,render(chapter,40));assert.equal(JSON.stringify(chapter),before)
 for(const result of [a,b]){
  const runs=result.model.runs;assert.equal(runs.map(r=>result.model.text.slice(r.displayStart,r.displayEnd)).join(''),result.model.text)
  assert.equal(runs.map(r=>result.model.original.slice(r.sourceStart,r.sourceEnd)).join(''),result.model.original)
  for(let i=1;i<runs.length;i++){assert.equal(runs[i-1].sourceEnd,runs[i].sourceStart);assert.equal(runs[i-1].displayEnd,runs[i].displayStart)}
 }
 console.log(`原创《夜里的来信》：可匹配${b.eligible}处，20%整句${a.replaced}处、其他词语${a.model.runs.filter(r=>r.replacement&&!r.sentence).length}处；40%整句${b.replaced}处、其他词语${b.model.runs.filter(r=>r.replacement&&!r.sentence).length}处。`)
})
test('否定、主语、修饰、未完整结束、句内子串、书名及章标题不误套句型',()=>{
 const title='他点了点头。',c={...chapter,paragraphs:[title]}
 assert.equal(applySentenceLibrary(c,buildDisplayText(title,[],{concentration:40,seed:'x'}),entries,{concentration:40,seed:'x',titles:[title]}).replaced,0)
 for(const text of ['他没有点头。','她点了点头。','他轻轻点了点头。','也许他点了点头。','他点了点头','他问她，别担心。','《别担心。》','第一章 他点了点头。'])assert.equal(render({...chapter,paragraphs:[text]},40).replaced,0,text)
})
test('引语保留；叙述句在引语中不擅自指定过去时；对话整句可替换',()=>{
 const text='“别担心。”她说。“他点了点头。”她继续念信。「请进。」'
 const result=render({...chapter,paragraphs:[text]},40)
 assert.equal(result.eligible,2);assert.ok(result.model.text.includes('他点了点头。'));assert.equal(result.model.text.split('“').length,text.split('“').length)
 assert.equal(render({...chapter,paragraphs:['“他点了点头。']},40).replaced,0)
 assert.equal(render({...chapter,paragraphs:['我不知道。']},40).replaced,0)
 const block={...chapter,paragraphs:['别担心。'],blocks:[{kind:'quote',text:'别担心。'}]};assert.equal(render(block,40).replaced,1)
})
test('0%原样恢复，60/80/100仍使用真实译文链路，不用200例句伪装整章翻译',()=>{
 for(const concentration of [0,60,80,100]){
  const original=chapterText(chapter),result=render(chapter,concentration)
  assert.equal(result.replaced,0);assert.equal(result.model.text,original)
 }
})
test('已导入的整句译文优先，不在其中二次替换或拆分；未译范围可补句型',async()=>{
 const c={...chapter,paragraphs:['他点了点头。她摇了摇头。雨停了。别担心。请进。']}
 const book={schemaVersion:1,id:'sentence-cache',title:'来信',source:'txt',chapters:[c]}
 const pkg=await createTranslationTemplate(book);pkg.chapters[0].segments[0].targetText='He gave a nod.'
 const cached=(await validateTranslationPackage(pkg,book)).chapters[0]
 const result=render(c,40,'sentence-test',cached)
 assert.ok(result.model.text.includes('He gave a nod.'));assert.ok(!result.model.text.includes('He nodded.'))
 assert.ok(result.replaced>0)
})
test('整句点击元数据保留中文与收藏ID；英语分词不拆开句型；无默认中文括注',()=>{
 const result=render({...chapter,paragraphs:['他点了点头。']},40)
 const lookup=withOriginalEnglishLookup(result.model)
 assert.equal(lookup.runs.length,1)
 const run=lookup.runs[0];assert.equal(run.sentence,true);assert.equal(run.english,'He nodded.');assert.equal(run.chinese,'他点了点头。');assert.match(run.entryId,/^sentence:/)
 assert.doesNotMatch(lookup.text,/[（(][\u3400-\u9fff]/)
})
test('句型保留UTF16原文坐标，字级显示辅助锚点支持重排／刷新，切0%回原文',()=>{
 const c={...chapter,paragraphs:['😀他点了点头。','她摇了摇头。']}
 const result=render(c,40),run=result.model.runs.find(r=>r.sentence);assert.ok(run)
 assert.equal(displayToSource(result.model,run.displayStart+4),run.sourceStart);assert.equal(sourceToDisplay(result.model,run.sourceStart),run.displayStart)
 const fp=displayFingerprint(result.model),saved=positionForDisplay(c,result.model,run.displayStart+4,fp)
 assert.equal(displayOffsetForPosition(c,result.model,JSON.parse(JSON.stringify(saved)),fp),run.displayStart+4)
 const zero=render(c,0).model;assert.equal(displayOffsetForPosition(c,zero,saved,displayFingerprint(zero)),run.sourceStart)
})
test('EPUB正文整句替换不扩散局部粗体，标题、图片锚点与原目录范围保留',()=>{
 const texts=['他点了点头。','她摇了摇头。','\ufffc','雨停了。']
 const c={...chapter,paragraphs:texts,blocks:texts.map((text,i)=>({kind:i===0?'heading':i===2?'image':'paragraph',text,marks:i===1?[{kind:'strong',start:0,end:1}]:[]}))}
 const result=render(c,40);assert.ok(!result.model.runs.some(r=>r.sentence&&r.sourceStart===0));assert.ok(result.model.text.includes('\ufffc'))
 let start=0;for(const text of texts){const fragments=fragmentsForBlock(result.model,start,start+text.length,c.blocks[texts.indexOf(text)].marks??[]);if(text==='她摇了摇头。'){const sentence=fragments.find(f=>f.run?.sentence);assert.ok(sentence);assert.deepEqual(sentence.marks,[])}start+=text.length+2}
 assert.deepEqual(c.paragraphs,texts)
})
test('离线查询、分类与整句精确优先，收藏句型可在既有生词本中按英文／中文搜索',()=>{
 assert.equal(searchSentences(entries,"Don't worry.").entries[0].chinese,'别担心。')
 assert.equal(searchSentences(entries,'点了点头').entries[0].english,'He nodded.')
 assert.equal(searchSentences(entries,'','setting').total,40);assert.equal(searchSentences(entries,'').entries.length,20)
 const e=entries[0],record=learningEntryForWord({entryId:e.id,english:e.english,chinese:e.chinese,sentence:true},null)
 assert.equal(record.word,e.english);assert.equal(record.id,e.id)
 const available=withLearningEntries([], [record]);assert.equal(queryVocabulary(available,e.english)[0].id,e.id);assert.equal(queryVocabulary(available,e.chinese)[0].id,e.id)
})
test('句型收藏与掌握复用学习库，刷新连接保留；不删除旧词条',async()=>{
 const previous=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory()
 try{
  await setFavorite({id:'moon',word:'moon',translation:'月亮',phonetic:''},true)
  const e=entries[0],record=learningEntryForWord({entryId:e.id,english:e.english,chinese:e.chinese,sentence:true},null)
  await setFavorite(record,true);await setMastered(e.id,true,record)
  assert.equal((await listFavorites()).length,2);assert.equal((await listFavorites()).find(r=>r.id===e.id).translation,e.chinese)
  assert.equal((await listMastery())[0].entry.word,e.english)
  await setFavorite(record,false);assert.equal((await listFavorites())[0].id,'moon')
 }finally{globalThis.indexedDB=previous}
})
test('句型查询和匹配断网运行，不请求在线翻译或词典',()=>{
 const previous=globalThis.fetch;let requests=0;globalThis.fetch=()=>{requests++;throw Error('Offline')}
 try{assert.ok(render(chapter,40).replaced>0);assert.equal(searchSentences(entries,'别担心。').total,1);assert.equal(requests,0)}finally{globalThis.fetch=previous}
})
test('当前章12000字符句型匹配不使用网络、模型或全书DOM，耗时仅报告开发机值',()=>{
 const c={...chapter,paragraphs:[story.repeat(60).slice(0,12000)]};const before=performance.now();const result=render(c,40)
 assert.ok(result.replaced>0);assert.equal(result.model.original.length,12000)
 console.log(`12000字符当前章句型与替换组合：${Math.round(performance.now()-before)}ms（开发机，非手机性能保证）；JSON ${manifest.bytes}字节，gzip ${manifest.gzipBytes}字节。`)
})
test('实际TXT和EPUB解析输出共用句型链路，EPUB引语／标题／插图／目录不丢失',async()=>{
 const {JSDOM}=await import('jsdom'),{ZipReader,ZipWriter,Uint8ArrayReader,Uint8ArrayWriter}=await import('@zip.js/zip.js')
 const {txtImporter}=await import('../src/features/importing/txtImporter.ts'),{epubImporter}=await import('../src/features/importing/epubImporter.ts')
 const window=new JSDOM('').window,previous={document:globalThis.document,DOMParser:globalThis.DOMParser,XMLSerializer:globalThis.XMLSerializer}
 Object.assign(globalThis,{document:window.document,DOMParser:window.DOMParser,XMLSerializer:window.XMLSerializer})
 try{
  const txt=await txtImporter.parse(new File([story],'story.txt'))
  assert.equal(txt.title,'夜里的来信');assert.ok(render(txt.chapters[0],40).replaced>0)
  const reader=new ZipReader(new Uint8ArrayReader(await readFile(new URL('fixtures/epub/chinese-epub3.epub',import.meta.url))),{useWebWorkers:false})
  const zipEntries=await reader.getEntries(),writer=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false})
  for(const entry of zipEntries)if(!entry.directory){
   let bytes=await entry.getData(new Uint8ArrayWriter())
   if(entry.filename==='OEBPS/Text/one.xhtml')bytes=new TextEncoder().encode(new TextDecoder().decode(bytes).replace('</h1>','</h1><h2>他点了点头。</h2><p>他点了点头。她摇了摇头。雨停了。</p><blockquote><p>别担心。</p></blockquote>'))
   await writer.add(entry.filename,new Uint8ArrayReader(bytes),{level:0})
  }
  await reader.close()
  const book=await epubImporter.parse(new File([await writer.close()],'sentences.epub')),c=book.chapters[0],snapshot=JSON.stringify(book)
  const result=render(c,40);assert.equal(result.eligible,4);assert.equal(result.replaced,4)
  assert.ok(result.model.text.includes("Don't worry."));assert.ok(c.blocks.some(block=>block.kind==='quote'));assert.ok(c.blocks.some(block=>block.kind==='image'))
  assert.ok(result.model.text.includes('他点了点头。')) // Identical heading is preserved.
  const target=book.toc.find(item=>item.title==='雨中的约定');assert.ok(target);assert.equal(book.chapters.find(item=>item.id===target.chapterId).paragraphs[target.paragraph].slice(target.offset),'雨中的约定')
  assert.equal(JSON.stringify(book),snapshot)
 }finally{Object.assign(globalThis,previous);window.close()}
})
