import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {IDBFactory,IDBKeyRange,IDBObjectStore} from 'fake-indexeddb'
import {sha256Fallback,contentHash} from '../src/features/translation/hash.ts'
import {createTranslationTemplate,validateTranslationPackage,parseTranslationFile,translationBlob,translationCoverage,bookIdentity,sentenceRanges} from '../src/features/translation/package.ts'
import {saveTranslationPackage,readChapterTranslation,exportCachedTranslations,deleteBookTranslations,translationError} from '../src/features/translation/storage.ts'
import {buildBilingualDisplay} from '../src/features/translation/display.ts'
import {buildDisplayText,sourceToDisplay,displayToSource} from '../src/features/replacement/displayText.ts'
import {withOriginalEnglishLookup} from '../src/features/replacement/originalEnglish.ts'
import {fragmentsForBlock} from '../src/features/reading/epubDisplay.ts'
import {chapterText,positionToOffset,offsetToPosition,pageForOffset} from '../src/features/reading/readingPosition.ts'
import {saveBook,listBooks} from '../src/shared/storage/books.ts'
import {setFavorite,setMastered,listFavorites,listMastery} from '../src/features/vocabulary/storage.ts'
const rules=JSON.parse(await readFile(new URL('../src/features/replacement/data/rules.json',import.meta.url)))
const clone=value=>JSON.parse(JSON.stringify(value))
const chapter={id:'chapter-a',title:'第一章 雨后的邮局',order:0,paragraphs:Array.from({length:12},(_,i)=>`${i+1}。李明走进邮局，看见柜台旁的花盆。月亮挂在天空，他毫不犹豫地拿出信封。`)}
const book={schemaVersion:1,id:'translation-test',title:'原创译文验证',source:'txt',importedAt:'before',chapters:[chapter,{id:'chapter-b',title:'第二章 归途',order:1,paragraphs:['李明把信交给朋友。两个人一起离开邮局。']}]}
async function readyPackage(target=book){
 const value=await createTranslationTemplate(target)
 for(const translation of value.chapters) {
  translation.identity.modelVersion='original-test-fixture'
  for(const segment of translation.segments) segment.targetText=`Li Ming is at the post office. This is translated test segment ${segment.id}.`
 }
 return validateTranslationPackage(value,target)
}
const ready=await readyPackage()
function model(concentration,translation=ready.chapters[0],hints=false) {
 const baseline=buildDisplayText(chapterText(chapter),rules,{concentration:concentration===0?0:40,seed:'test',showChineseHints:hints})
 return buildBilingualDisplay(chapter,baseline,translation,concentration,'test')
}
test('SHA256原生与无安全上下文回退一致，覆盖中文、代理对和区块边界',async()=>{
 for(const value of ['', 'abc','月亮𠮷','x'.repeat(55),'x'.repeat(64),'雨'.repeat(1000)]) {
  const expected=createHash('sha256').update(value).digest('hex')
  assert.equal(sha256Fallback(new TextEncoder().encode(value)),expected)
  assert.equal(await contentHash(value),'sha256:'+expected)
 }
})
test('模板按原文句组生成，不生成英文，章节身份不依赖本机书籍ID',async()=>{
 const template=await createTranslationTemplate(book)
 assert.ok(template.chapters[0].segments.length>12)
 assert.ok(template.chapters.every(chapter=>chapter.status==='partial'&&chapter.segments.every(segment=>segment.targetText==='')))
 const other=clone(book);other.id='another-device';other.chapters.forEach((chapter,i)=>chapter.id=`device-${i}`)
 assert.deepEqual((await bookIdentity(other)).sourceHash,template.book.sourceHash)
 const imported=await validateTranslationPackage(ready,other)
 assert.equal(imported.chapters[0].chapterId,'device-0')
 assert.ok(imported.chapters[0].segments.every(segment=>segment.chapterId==='device-0'))
})
test('句组切分保留引号和标点，不拆开代理对，也不漏中文原句',()=>{
 const text='“你会来吗？”她问。“会！”他说。𠮷村的月亮很亮。'
 const ranges=sentenceRanges(text)
 assert.equal(ranges.map(range=>text.slice(range.start,range.end)).join(''),text)
 assert.ok(text.slice(ranges[0].start,ranges[0].end).endsWith('？”'))
})
test('六档使用同一译文缓存，40有句子，60/80英文覆盖递增，100只有真实译文',()=>{
 const before=JSON.stringify(book),states=[0,20,40,60,80,100].map(level=>model(level))
 assert.equal(states[0].model.text,chapterText(chapter))
 assert.ok(states[1].translated>0);assert.ok(Math.abs(states[1].coveredPercent-20)<=1)
 assert.ok(states[2].translated>0);assert.ok(states[2].model.replaced>0)
 const weight=state=>state.model.runs.filter(run=>run.translation).reduce((n,run)=>n+run.sourceEnd-run.sourceStart,0)
 assert.ok(weight(states[3])>weight(states[2]));assert.ok(weight(states[4])>weight(states[3]));assert.ok(weight(states[5])>=weight(states[4]))
 assert.ok(!/[\u3400-\u9fff]/u.test(states[5].model.text))
 assert.equal(states[5].model.replaced,0)
 assert.equal(JSON.stringify(book),before)
 assert.equal(model(80).model.text,states[4].model.text)
})
test('缺失或部分译文绝不伪装100%，高档未译范围保持原文且明确提示',()=>{
 for(const concentration of [60,80,100]){
  const baseline=buildDisplayText(chapterText(chapter),rules,{concentration,seed:'test'})
  const missing=buildBilingualDisplay(chapter,baseline,undefined,concentration,'test')
  assert.equal(missing.model.text,chapterText(chapter));assert.ok(missing.badge.includes('原文'))
 }
 const partial={...ready.chapters[0],status:'partial',segments:ready.chapters[0].segments.slice(0,2)}
 assert.equal(model(100,partial).translated,1); // The other cached group is a numeric marker, not English coverage.
 assert.ok(model(100,partial).coveredPercent>0);assert.match(model(100,partial).message,/全部可用的缓存英文译文/)
 const mixed=model(80,partial);assert.ok(mixed.translated>0);assert.ok(/[\u3400-\u9fff]/u.test(mixed.model.text));assert.match(mixed.badge,/部分译文/)
 const baseline=buildDisplayText(chapterText(chapter),rules,{concentration:40,seed:'test'})
 const low=buildBilingualDisplay(chapter,baseline,undefined,40,'test')
 assert.ok(low.model.replaced>0);assert.ok(low.coveredPercent<=40.5);assert.match(low.message,/暂无句子译文/)
})
test('完整译句的点词／短语使用独立显示位置，原文锚点不混用英文偏移',()=>{
 const full=model(100).model,lookup=withOriginalEnglishLookup(full,['post office'],new Map([['post office','邮局']]))
 assert.equal(lookup.text,full.text)
 const words=lookup.runs.filter(run=>run.lookup)
 assert.ok(words.some(run=>run.english==='post office'&&run.lookupMeaning==='邮局'))
 assert.equal(new Set(words.map(run=>run.displayStart)).size,words.length)
 const first=full.runs.find(run=>run.translation)
 const same=words.filter(run=>run.sourceStart===first.sourceStart)
 assert.ok(same.length>1);assert.ok(same.every(run=>run.contextChinese===first.contextChinese))
 for(const run of words){assert.equal(displayToSource(lookup,run.displayStart),run.sourceStart);assert.ok(sourceToDisplay(lookup,run.sourceStart)<=run.displayStart)}
 assert.ok(!lookup.text.includes('（'))
 const position=offsetToPosition(chapter,same[1].sourceStart)
 const original=positionToOffset(chapter,position)
 assert.equal(original,same[1].sourceStart)
 assert.ok(pageForOffset([0,100,200,400],sourceToDisplay(lookup,original))>=0)
})
test('EPUB文字块、标题和图片不重复、不漏字，原文强调不错误扩散到整句',async()=>{
 const epub=clone(book);epub.source='epub';epub.chapters=[{id:'epub-chapter',title:'开篇',order:0,paragraphs:['第一章','李明走进邮局。','\ufffc','他拿出信封。'],blocks:[{kind:'heading',text:'第一章',level:1},{kind:'paragraph',text:'李明走进邮局。',marks:[{start:4,end:6,kind:'strong'}]},{kind:'image',text:'\ufffc',resourceId:'image-0'},{kind:'paragraph',text:'他拿出信封。'}]}]
 const prepared=await readyPackage(epub),ch=epub.chapters[0]
 const display=buildBilingualDisplay(ch,buildDisplayText(chapterText(ch),rules,{concentration:100,seed:'epub'}),prepared.chapters[0],100,'epub')
 assert.equal(display.complete,true)
 const lookup=withOriginalEnglishLookup(display.model,['post office']);let offset=0;const texts=[]
 for(const [i,block] of ch.blocks.entries()){
  if(i)texts.push('\n\n')
  const fragments=fragmentsForBlock(lookup,offset,offset+block.text.length,block.marks??[])
  texts.push(fragments.map(fragment=>fragment.text).join(''));offset+=block.text.length+2
  if(i===1)assert.ok(fragments.every(fragment=>!fragment.marks.includes('strong')))
 }
 assert.equal(texts.join(''),lookup.text)
 assert.equal((lookup.text.match(/\ufffc/g)||[]).length,1)
 assert.ok(prepared.chapters[0].segments.every(segment=>segment.source.paragraph!==2))
})
test('拒绝错书、错章节、改原文、越界、重复和重叠片段，拒绝冒充完整译文',async()=>{
 const mutations=[
  value=>value.book.sourceHash='wrong',
  value=>value.chapters[0].identity.sourceHash='wrong',
  value=>value.chapters[0].segments[0].sourceText='伪造原文',
  value=>value.chapters[0].segments[0].source.end=99999,
  value=>value.chapters.push(value.chapters[0]),
  value=>value.chapters[0].segments.push({...value.chapters[0].segments[0],id:'different-id'}),
  value=>value.chapters[0].segments[1].id=value.chapters[0].segments[0].id,
  value=>{value.chapters[0].segments.pop();value.chapters[0].status='complete'},
  value=>value.schemaVersion=2,
  value=>{const segment=value.chapters[0].segments.find(item=>/[\u3400-\u9fff]/u.test(item.sourceText));segment.targetText=segment.sourceText},
 ]
 for(const mutate of mutations){const value=clone(ready);mutate(value);await assert.rejects(validateTranslationPackage(value,book))}
})
test('空模板拒绝导入，半填模板只保存有英文的章节，覆盖状态按实际范围计算',async()=>{
 const blank=await createTranslationTemplate(book)
 await assert.rejects(validateTranslationPackage(blank,book),/尚未填写/)
 blank.chapters[0].segments[0].targetText='Li Ming visits the post office.'
 const partial=await validateTranslationPackage(blank,book)
 assert.equal(partial.chapters.length,1);assert.equal(partial.chapters[0].status,'partial')
 assert.equal(partial.chapters[0].segments.length,1)
 assert.ok(translationCoverage(chapter,partial.chapters[0].segments).percent<100)
})
test('不接受UTF16代理对内部范围，译文JSON损坏／过大明确报错',async()=>{
 const special=clone(book);special.chapters=[{id:'unicode',title:'文字',order:0,paragraphs:['𠮷村的信。']}]
 const value=await readyPackage(special);value.chapters[0].segments[0].source.start=1;value.chapters[0].segments[0].sourceText=special.chapters[0].paragraphs[0].slice(1)
 await assert.rejects(validateTranslationPackage(value,special),/拆开了字符/)
 await assert.rejects(parseTranslationFile(new File(['{'],'bad.json'),book),/损坏/)
 await assert.rejects(parseTranslationFile({size:21*1024*1024},book),/20 MB/)
 const parsed=await parseTranslationFile(new File(['\ufeff'+JSON.stringify(ready)],'translations.json'),book)
 assert.equal(parsed.chapters[0].status,'complete')
})
test('译文更新原子保存，刷新连接可读；原书、其他书与学习记录保留',async()=>{
 const original=globalThis.indexedDB,oldRange=globalThis.IDBKeyRange
 globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange
 try {
  await saveBook(book);await setMastered('moon',true);await setFavorite({id:'moon',word:'moon',translation:'月亮',phonetic:''},true)
  await saveTranslationPackage(book,ready)
  const other={...book,id:'other-book'};await saveTranslationPackage(other,ready)
  const loaded=await readChapterTranslation(book,chapter);assert.equal(loaded.status,'complete')
  const updated=clone(ready);updated.chapters=[updated.chapters[0]];updated.chapters[0].segments[0].targetText='Li Ming returns to the post office.'
  await saveTranslationPackage(book,updated)
  assert.equal((await readChapterTranslation(book,chapter)).segments[0].targetText,updated.chapters[0].segments[0].targetText)
  assert.equal((await readChapterTranslation(other,chapter)).segments[0].targetText,ready.chapters[0].segments[0].targetText)
  const invalid=clone(ready);invalid.chapters[1].segments[0].sourceText='wrong'
  await assert.rejects(saveTranslationPackage(book,invalid))
  assert.equal((await readChapterTranslation(book,chapter)).segments[0].targetText,updated.chapters[0].segments[0].targetText)
  assert.deepEqual(await listBooks(),[book]);assert.equal((await listMastery())[0].mastered,true);assert.equal((await listFavorites()).length,1)
  const exported=await exportCachedTranslations(book)
  const roundtrip=await parseTranslationFile(new File([translationBlob(exported)],'roundtrip.json'),book)
  assert.equal(roundtrip.chapters.length,2)
  await deleteBookTranslations(book.id)
  assert.equal(await readChapterTranslation(book,chapter),undefined)
  assert.ok(await readChapterTranslation(other,chapter))
 } finally{globalThis.indexedDB=original;globalThis.IDBKeyRange=oldRange}
})
test('存储不可用、配额不足和空缓存导出明确失败，不伪称保存成功',async()=>{
 const original=globalThis.indexedDB
 try {
  globalThis.indexedDB=undefined
  await assert.rejects(saveTranslationPackage(book,ready),/无法保存译文/)
  globalThis.indexedDB=new IDBFactory()
  await assert.rejects(exportCachedTranslations(book),/尚无已保存/)
  assert.match(translationError({name:'QuotaExceededError'}),/未保存.*仍保留/)
 } finally{globalThis.indexedDB=original}
})
test('译文内容始终是惰性文本，不作为HTML模板；不接受以大量中文冒充英文',async()=>{
 const value=clone(ready);value.chapters[0].segments[1].targetText='The page reads <script>doNotRun()</script> in plain text.'
 const checked=await validateTranslationPackage(value,book)
 const display=model(100,checked.chapters[0]);assert.ok(display.model.text.includes('<script>'))
 assert.equal(globalThis.doNotRun,undefined)
 value.chapters[0].segments[0].targetText='这是一大段没有翻译的中文原文用来冒充全文英文 translation'
 await assert.rejects(validateTranslationPackage(value,book),/仍以中文为主/)
})


test('整段译文跨页时额外保存显示锚点，字号重排／刷新不退回段首，切浓度仍回原文定位',async()=>{
 const {displayFingerprint,positionForDisplay,displayOffsetForPosition}=await import('../src/features/translation/position.ts')
 const ch={id:'long',title:'长句组',order:0,paragraphs:['李明走进邮局。他看见朋友正在等他。']}
 const model={original:chapterText(ch),text:'A long translated paragraph. '.repeat(100),runs:[{sourceStart:0,sourceEnd:chapterText(ch).length,displayStart:0,displayEnd:2800,replacement:false,translation:true}],eligible:0,replaced:0}
 model.runs[0].displayEnd=model.text.length
 const fingerprint=displayFingerprint(model),saved=positionForDisplay(ch,model,900,fingerprint)
 assert.equal(saved.offset,0)
 const refreshed=JSON.parse(JSON.stringify(saved))
 assert.equal(displayOffsetForPosition(ch,model,refreshed,fingerprint),900)
 assert.equal(pageForOffset([0,400,800,1200],displayOffsetForPosition(ch,model,refreshed,fingerprint)),2)
 const chinese=buildDisplayText(chapterText(ch),rules,{concentration:0,seed:'test'})
 assert.equal(displayOffsetForPosition(ch,chinese,refreshed,displayFingerprint(chinese)),0)
 const malformed={...saved,rendition:{fingerprint,offset:999999}}
 assert.equal(displayOffsetForPosition(ch,model,malformed,fingerprint),0)
})


test('多章节保存中途遇到配额错误时整批回滚，不提前提交第一个章节',async()=>{
 const original=globalThis.indexedDB,put=IDBObjectStore.prototype.put
 globalThis.indexedDB=new IDBFactory()
 try {
  await saveTranslationPackage(book,ready)
  const updated=clone(ready);updated.chapters[0].segments[0].targetText='A replacement that must not be partially saved.'
  IDBObjectStore.prototype.put=function(value,...args){
   if(this.name==='chapters'&&value.translation?.chapterIndex===1)throw new DOMException('full','QuotaExceededError')
   return put.call(this,value,...args)
  }
  await assert.rejects(saveTranslationPackage(book,updated),{name:'QuotaExceededError'})
  IDBObjectStore.prototype.put=put
  assert.equal((await readChapterTranslation(book,chapter)).segments[0].targetText,ready.chapters[0].segments[0].targetText)
 }finally{IDBObjectStore.prototype.put=put;globalThis.indexedDB=original}
})


test('单章英文总量受限，防止许多小原文范围扩张为巨型正文',async()=>{
 const small={...book,chapters:[{id:'oversized',title:'长度测试',order:0,paragraphs:['月'.repeat(10000)]}]}
 const value=await createTranslationTemplate(small)
 value.chapters[0].segments=Array.from({length:1000},(_,i)=>({id:`s${i}`,chapterId:'oversized',source:{paragraph:0,start:i*10,end:i*10+10},sourceText:'月'.repeat(10),targetText:'English '.repeat(20)}))
 await assert.rejects(validateTranslationPackage(value,small),/120,000/)
})
test('可供人工验收的原创小说译文夹具与实际书籍结构完全匹配',async()=>{
 const {sampleBooks}=await import('../src/features/reading/sampleBooks.ts')
 const value=JSON.parse(await readFile(new URL('fixtures/translations/moon-en.json',import.meta.url)))
 const moon=sampleBooks.find(book=>book.id==='moon')
 const validated=await validateTranslationPackage(value,moon)
 assert.equal(validated.chapters[0].status,'complete')
 assert.equal(validated.chapters[0].segments.length,9)
 assert.ok(validated.chapters[0].segments[1].targetText.includes('Zhou Ning'))
 assert.ok(validated.chapters[0].segments[3].targetText.includes('Can I send a letter here?'))
})


test('真实TXT与EPUB夹具可以导入完整译文，实际EPUB图片和全部段落仍正确对应',async()=>{
 const {txtImporter}=await import('../src/features/importing/txtImporter.ts')
 const txt=await txtImporter.parse(new File([await readFile(new URL('fixtures/utf8.txt',import.meta.url))],'utf8.txt'))
 const txtValue=await validateTranslationPackage(JSON.parse(await readFile(new URL('fixtures/translations/utf8-en.json',import.meta.url))),txt)
 const txtDisplay=buildBilingualDisplay(txt.chapters[0],buildDisplayText(chapterText(txt.chapters[0]),rules,{concentration:100,seed:'txt'}),txtValue.chapters[0],100,'txt')
 assert.equal(txtDisplay.complete,true);assert.ok(!/[\u3400-\u9fff]/u.test(txtDisplay.model.text));assert.ok(txtDisplay.model.text.includes('Starlight lit the way home.'))
 const {JSDOM}=await import('jsdom'),window=new JSDOM('').window
 const saved={document:globalThis.document,DOMParser:globalThis.DOMParser,XMLSerializer:globalThis.XMLSerializer}
 Object.assign(globalThis,{document:window.document,DOMParser:window.DOMParser,XMLSerializer:window.XMLSerializer})
 try {
  const {epubImporter}=await import('../src/features/importing/epubImporter.ts')
  const epub=await epubImporter.parse(new File([await readFile(new URL('fixtures/epub/chinese-epub3.epub',import.meta.url))],'chinese-epub3.epub'))
  const translations=await validateTranslationPackage(JSON.parse(await readFile(new URL('fixtures/translations/epub-en.json',import.meta.url))),epub)
  assert.equal(translations.chapters.length,2)
  for(const [i,ch] of epub.chapters.entries()){
   const result=buildBilingualDisplay(ch,buildDisplayText(chapterText(ch),rules,{concentration:100,seed:'epub'}),translations.chapters[i],100,'epub')
   assert.equal(result.complete,true);assert.equal(result.coveredPercent,100)
   for(const [index,block] of ch.blocks.entries())if(['heading','pre'].includes(block.kind))assert.ok(result.model.text.includes(ch.paragraphs[index]))
   let offset=0;const pieces=[]
   for(const [index,block] of ch.blocks.entries()){if(index)pieces.push('\n\n');pieces.push(fragmentsForBlock(result.model,offset,offset+block.text.length,block.marks).map(fragment=>fragment.text).join(''));offset+=block.text.length+2}
   assert.equal(pieces.join(''),result.model.text)
  }
  assert.equal((translations.chapters[0].segments.filter(segment=>segment.source.paragraph===3)).length,0)
 }finally{for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value}
})


test('英文译文点击可复用已有来源词形关联，不凭后缀猜造词义',async()=>{
 const {lookupVocabularyEntry,mergeVocabulary}=await import('../src/features/vocabulary/query.ts')
 const entries=mergeVocabulary(JSON.parse(await readFile(new URL('../src/features/vocabulary/data/lookup.json',import.meta.url))),JSON.parse(await readFile(new URL('../src/features/vocabulary/data/phrases.json',import.meta.url))))
 assert.equal(lookupVocabularyEntry(entries,'opened')?.id,'open')
 assert.equal(lookupVocabularyEntry(entries,'thinking')?.id,'thinking')
 assert.equal(lookupVocabularyEntry(entries,'give up')?.id,'give up')
 assert.equal(lookupVocabularyEntry(entries,'notarealword'),null)
 const ambiguous=[{id:'a',word:'a',kind:'word'},{id:'b',word:'b',kind:'word'},{id:'a up',kind:'phrase',forms:['imaginary up']},{id:'b in',kind:'phrase',forms:['imaginary in']}]
 assert.equal(lookupVocabularyEntry(ambiguous,'imaginary'),null)
})


test('TXT原有换行在译句边界保留，模板按行及句组拆分，译文缓存不裁掉用户换行',async()=>{
 const value={...book,chapters:[{id:'lines',title:'正文',order:0,paragraphs:['标题\n李明来了。\n\n他走了。']}]}
 const template=await createTranslationTemplate(value)
 assert.equal(template.chapters[0].segments.length,3)
 const targets=['A Title','Li Ming arrived.','He left.']
 template.chapters[0].segments.forEach((segment,i)=>segment.targetText=targets[i])
 const valid=await validateTranslationPackage(template,value),ch=value.chapters[0]
 const displayed=buildBilingualDisplay(ch,buildDisplayText(chapterText(ch),rules,{concentration:100,seed:'lines'}),valid.chapters[0],100,'lines').model.text
 assert.match(displayed,/A Title\n/);assert.match(displayed,/arrived\.\s*\n\n/)
 template.chapters[0].segments[0].targetText='\nA Title\n'
 assert.equal((await validateTranslationPackage(template,value)).chapters[0].segments[0].targetText,'\nA Title\n')
})
