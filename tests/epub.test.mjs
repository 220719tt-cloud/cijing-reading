import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import 'fake-indexeddb/auto'
import {epubImporter,EPUB_LIMITS} from '../src/features/importing/epubImporter.ts'
import {archivePath,parseEpubXml,decodeEpubXml} from '../src/features/importing/epubSafety.ts'
import {extractEpubContent,splitEpubContent} from '../src/features/importing/epubContent.ts'
import {buildDisplayText,sourceToDisplay,displayToSource} from '../src/features/replacement/displayText.ts'
import {fragmentsForBlock} from '../src/features/reading/epubDisplay.ts'
import {chapterText,offsetToPosition,positionToOffset} from '../src/features/reading/readingPosition.ts'
import {saveBook,listBooks} from '../src/shared/storage/books.ts'
import {setMastered,listMastery,setFavorite,listFavorites} from '../src/features/vocabulary/storage.ts'
const window=new JSDOM('').window
Object.assign(globalThis,{document:window.document,DOMParser:window.DOMParser,XMLSerializer:window.XMLSerializer})
const fixture=async(name)=>new File([await readFile(new URL(`fixtures/epub/${name}`,import.meta.url))],name)
const rules=JSON.parse(await readFile(new URL('../src/features/replacement/data/rules.json',import.meta.url)))
const chinese=await epubImporter.parse(await fixture('chinese-epub3.epub'))
const english=await epubImporter.parse(await fixture('english-epub2.epub'))
test('EPUB3中文书名、作者、封面、spine顺序、嵌套目录和锚点',()=>{
 assert.equal(chinese.title,'雨后的邮局 · EPUB 验证');assert.equal(chinese.author,'词境测试作者')
 assert.equal(chinese.source,'epub');assert.equal(chinese.chapters.length,2)
 assert.deepEqual(chinese.chapters.map(chapter=>chapter.title),['第一章 雨夜邮局','第二章 清晨来信'])
 assert.ok(chinese.coverResourceId);assert.ok(chinese.resources.some(resource=>resource.id===chinese.coverResourceId&&resource.blob.type==='image/png'))
 assert.deepEqual(chinese.toc.map(item=>item.title),['第一章 雨夜邮局','雨中的约定','第二章 清晨来信'])
 const target=chinese.toc[1],chapter=chinese.chapters.find(chapter=>chapter.id===target.chapterId)
 assert.equal(target.depth,1);assert.equal(chapter.paragraphs[target.paragraph].slice(target.offset),'雨中的约定')
})
test('EPUB2英文、NCX与未知作者回退，长章节分段而不合并全书',()=>{
 assert.equal(english.title,'The Letter at Dawn');assert.equal(english.author,'未知作者');assert.equal(english.coverResourceId,undefined)
 assert.ok(english.chapters.length>=3);assert.ok(english.chapters.every(chapter=>chapterText(chapter).length<=12000))
 assert.equal(english.chapters[0].title,'Chapter One: A Letter')
 assert.equal(english.chapters.at(-1).title,'Chapter Two: The Reply')
 const all=english.chapters.map(chapter=>chapterText(chapter)).join('\n')
 assert.equal((all.match(/At the post office/g)||[]).length,100)
 assert.ok(english.toc.some(item=>item.title==='Chapter Two: The Reply'))
})
test('导航版权辅助页与脚本不混入正文；标题段落、换行、粗斜体保留',()=>{
 const all=chinese.chapters.map(chapter=>chapterText(chapter)).join('\n')
 for(const excluded of ['版权页不进入正文','辅助页面不进入正文','EPUB_PWNED','不安全内容']) assert.ok(!all.includes(excluded))
 assert.ok(all.includes('安全正文保留'));assert.ok(all.includes('（原文括号必须保留）'))
 assert.ok(chinese.chapters[0].blocks.some(block=>block.kind==='heading'))
 assert.ok(chinese.chapters[0].blocks.some(block=>block.marks?.some(mark=>mark.kind==='strong')))
 assert.ok(chinese.chapters[0].blocks.some(block=>block.marks?.some(mark=>mark.kind==='em')))
 assert.ok(chinese.chapters[0].blocks.some(block=>block.text.includes('\n雨已经停了。')))
 assert.equal(globalThis.EPUB_PWNED,undefined)
})
test('本地正文图片和内嵌SVG保留，远程图片不下载，SVG危险内容剔除',async()=>{
 assert.ok(chinese.chapters[0].blocks.filter(block=>block.kind==='image').length>=2)
 assert.ok(chinese.chapters[1].paragraphs.some(text=>text.includes('图片暂不可用')))
 for(const resource of chinese.resources.filter(resource=>resource.blob.type==='image/svg+xml')){
  const svg=await resource.blob.text()
  assert.ok(svg.includes('<rect'));assert.ok(svg.includes('data:image/png;base64,'))
  assert.ok(!/script|foreignObject|https?:\/\/example|onload|onclick/.test(svg))
 }
})
test('EPUB与既有0/20/40替换、提示和原文位置映射共用且无漏字',()=>{
 const chapter=chinese.chapters[0],source=chapterText(chapter),snapshot=JSON.stringify(chapter)
 let previous=0
 for(const level of [0,20,40,60,80,100]){
  const model=buildDisplayText(source,rules,{seed:'epub:test',concentration:level,titles:chapter.blocks.filter(block=>block.kind==='heading').map(block=>block.text)})
  if(level===20||level===40){assert.ok(model.replaced>previous);previous=model.replaced}
  else assert.equal(model.text,source)
  let start=0, rendered=''
  for(const [index,block] of chapter.blocks.entries()){
   if(index) rendered+='\n\n'
   rendered+=block.kind==='image'?block.text:fragmentsForBlock(model,start,start+block.text.length,block.marks).map(fragment=>fragment.text).join('')
   start+=block.text.length+2
  }
  assert.equal(rendered,model.text)
  for(const run of model.runs) assert.equal(displayToSource(model,sourceToDisplay(model,run.sourceStart)),run.sourceStart)
 }
 assert.equal(JSON.stringify(chapter),snapshot)
 const anchor=offsetToPosition(chapter,200), saved=JSON.parse(JSON.stringify(anchor))
 assert.equal(positionToOffset(chapter,saved),200)
})
test('导入EPUB不会覆盖TXT、学习记录，图片Blob和目录新连接可读取',async()=>{
 const txt={schemaVersion:1,id:'epub-regression-txt',title:'原TXT',author:'本地',source:'txt',importedAt:'before',palette:'mist',genre:'本地小说',chapters:[{id:'one',title:'正文',order:0,paragraphs:['原文不可覆盖']}]}
 await saveBook(txt);await setMastered('moon',true);await setFavorite({id:'moon',word:'moon',translation:'月亮',phonetic:''},true)
 await saveBook(chinese)
 const books=await listBooks(),restored=books.find(book=>book.id===chinese.id)
 assert.deepEqual(books.find(book=>book.id===txt.id),txt)
 assert.deepEqual(restored.chapters,chinese.chapters);assert.deepEqual(restored.toc,chinese.toc)
 assert.equal(await restored.resources[0].blob.arrayBuffer().then(bytes=>bytes.byteLength),chinese.resources[0].blob.size)
 assert.ok((await listMastery()).some(record=>record.id==='moon'&&record.mastered));assert.equal((await listFavorites())[0].id,'moon')
})
test('损坏、伪装、超限、越界资源、非法XML实体均明确拒绝',async()=>{
 await assert.rejects(epubImporter.parse(await fixture('damaged.epub')),/损坏|解析/)
 await assert.rejects(epubImporter.parse(new File(['not a zip'],'wrong.epub')),/EPUB/)
 await assert.rejects(epubImporter.parse({name:'large.epub',size:EPUB_LIMITS.file+1}),/40 MB/)
 for(const href of ['https://example.invalid/a','javascript:alert(1)','../../escape','..%2F..%2Fescape','..\\escape']) assert.throws(()=>archivePath('OEBPS/book.opf',href))
 assert.equal(archivePath('OEBPS/Text/a.xhtml','../Images/a%20b.png#fragment'),'OEBPS/Images/a b.png')
 assert.throws(()=>parseEpubXml('<!DOCTYPE x [<!ENTITY evil SYSTEM "file:///etc/passwd">]><x>&evil;</x>','测试'),/实体/)
 const escaped=parseEpubXml('<x>&nbsp;&lt;script&gt;文本&lt;/script&gt;</x>','测试')
 assert.equal(escaped.documentElement.textContent,'\u00a0<script>文本</script>')
})
test('UTF16 XML、超长段落样式与锚点按原文位置拆分',async()=>{
 const text='<html><body><h1 id="start">标题</h1><p><strong>'+('文字𠮷'.repeat(4000))+'</strong><em id="later">最后文字</em></p></body></html>'
 const bytes=new Uint8Array(Buffer.from('\ufeff'+text,'utf16le'))
 const content=await extractEpubContent(parseEpubXml(decodeEpubXml(bytes),'测试'),async()=>null)
 const divided=splitEpubContent(content,'test','章',0)
 assert.ok(divided.chapters.length>1)
 assert.equal(divided.chapters.flatMap(chapter=>chapter.paragraphs).join(''),content.blocks.map(block=>block.text).join(''))
 const target=divided.anchors.later,chapter=divided.chapters.find(chapter=>chapter.id===target.chapterId)
 assert.ok(chapter.paragraphs[target.paragraph].slice(target.offset).startsWith('最后文字'))
 assert.ok(divided.chapters.every(chapter=>!/[\uD800-\uDBFF]$/.test(chapter.paragraphs.at(-1))))
})
test('英文EPUB原文也复用释义卡元数据，不影响中文浓度选取或原文偏移',async()=>{
 const {withOriginalEnglishLookup}=await import('../src/features/replacement/originalEnglish.ts')
 for(const concentration of [0,20,40,60,80,100]){
  const source=chapterText(english.chapters[0]),base=buildDisplayText(source,rules,{concentration,seed:'english'})
  const model=withOriginalEnglishLookup(base)
  assert.equal(model.text,source);assert.equal(model.replaced,base.replaced)
  assert.ok(model.runs.some(run=>run.lookup && run.entryId==='envelope'))
  for(const run of model.runs) assert.equal(displayToSource(model,sourceToDisplay(model,run.sourceStart)),run.sourceStart)
  let offset=0,all=''
  for(const [i,block] of english.chapters[0].blocks.entries()) {if(i)all+='\n\n';all+=fragmentsForBlock(model,offset,offset+block.text.length,block.marks).map(fragment=>fragment.text).join('');offset+=block.text.length+2}
  assert.equal(all,source)
 }
})
async function alterEpub(original,changes) {
 const {ZipReader,ZipWriter,Uint8ArrayReader,Uint8ArrayWriter}=await import('@zip.js/zip.js')
 const reader=new ZipReader(new Uint8ArrayReader(new Uint8Array(await original.arrayBuffer())),{useWebWorkers:false})
 const entries=await reader.getEntries(),files=new Map()
 for(const entry of entries) if(!entry.directory) files.set(entry.filename,await entry.getData(new Uint8ArrayWriter()))
 await reader.close()
 for(const [path,value] of Object.entries(changes)) files.set(path,typeof value==='function'?new TextEncoder().encode(value(new TextDecoder().decode(files.get(path)))):typeof value==='string'?new TextEncoder().encode(value):value)
 const output=new Uint8ArrayWriter(),writer=new ZipWriter(output,{useWebWorkers:false})
 for(const [path,value] of files) await writer.add(path,new Uint8ArrayReader(value),{level:0})
 return new File([await writer.close()],'modified.epub')
}
test('EPUB2旧封面元数据、DRM／固定版式拒绝与取消导入',async()=>{
 const original=await fixture('english-epub2.epub')
 const legacy=await alterEpub(original,{'OEBPS/book.opf':text=>text.replace('</metadata>','<meta name="cover" content="legacy-cover"/></metadata>').replace('<manifest>','<manifest><item id="legacy-cover" href="cover.png" media-type="image/png"/>'),'OEBPS/cover.png':new Uint8Array(await chinese.resources.find(resource=>resource.id===chinese.coverResourceId).blob.arrayBuffer())})
 assert.ok((await epubImporter.parse(legacy)).coverResourceId)
 const drm=await alterEpub(original,{'META-INF/encryption.xml':'<encryption><EncryptedData><EncryptionMethod Algorithm="urn:unsupported-drm"/></EncryptedData></encryption>'})
 await assert.rejects(epubImporter.parse(drm),/DRM/)
 const fixed=await alterEpub(original,{'OEBPS/book.opf':text=>text.replace('</metadata>','<meta property="rendition:layout">pre-paginated</meta></metadata>')})
 await assert.rejects(epubImporter.parse(fixed),/固定版式/)
 const controller=new AbortController();controller.abort()
 await assert.rejects(epubImporter.parse(original,{signal:controller.signal}),/取消/)
})
test('解压体积预检在大资源解压前拒绝，存储不足不修改已有书库',async()=>{
 const bytes=new Uint8Array(await (await fixture('english-epub2.epub')).arrayBuffer())
 const view=new DataView(bytes.buffer)
 for(let i=0;i<bytes.length-30;i++) if(view.getUint32(i,true)===0x02014b50){view.setUint32(i+24,EPUB_LIMITS.expanded+1,true);break}
 await assert.rejects(epubImporter.parse(new File([bytes],'bomb.epub')),/过大|资源过多/)
 const saved=Object.getOwnPropertyDescriptor(globalThis,'navigator'),before=await listBooks()
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{storage:{estimate:async()=>({quota:1,usage:1})}}})
 try {await assert.rejects(saveBook(chinese),error=>error.name==='QuotaExceededError')}
 finally {if(saved)Object.defineProperty(globalThis,'navigator',saved);else delete globalThis.navigator}
 assert.deepEqual(await listBooks(),before)
})
test('EPUB内嵌data图片本地保存，拒绝HTML伪装图片',async()=>{
 const cover=chinese.resources.find(resource=>resource.id===chinese.coverResourceId)
 const uri='data:image/png;base64,'+Buffer.from(await cover.blob.arrayBuffer()).toString('base64')
 const file=await alterEpub(await fixture('english-epub2.epub'),{'OEBPS/two.xhtml':text=>text.replace('</body>',`<img src="${uri}" alt="内嵌图片"/><img src="data:text/html;base64,PHNjcmlwdD4="/></body>`)})
 const book=await epubImporter.parse(file)
 assert.ok(book.resources.some(resource=>resource.blob.type==='image/png'))
 assert.ok(book.chapters.at(-1).blocks.some(block=>block.kind==='image'))
 assert.ok(book.chapters.at(-1).paragraphs.some(text=>text.includes('图片暂不可用')))
})
test('EPUB2 guide的XHTML封面可提取，破损nav能回退NCX目录',async()=>{
 const cover=chinese.resources.find(resource=>resource.id===chinese.coverResourceId)
 const file=await alterEpub(await fixture('english-epub2.epub'),{
  'OEBPS/book.opf':text=>text.replace('<manifest>','<manifest><item id="nav" href="broken-nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>').replace('</package>','<guide><reference type="cover" href="cover.xhtml"/></guide></package>'),
  'OEBPS/broken-nav.xhtml':'<html broken',
  'OEBPS/cover.xhtml':'<html><body><img src="cover.png"/></body></html>',
  'OEBPS/cover.png':new Uint8Array(await cover.blob.arrayBuffer()),
 })
 const book=await epubImporter.parse(file)
 assert.ok(book.coverResourceId)
 assert.ok(book.toc.some(entry=>entry.title==='Chapter Two: The Reply'))
})

test('过深或过多的XML节点明确拒绝，避免递归耗尽手机调用栈',()=>{
 assert.throws(()=>parseEpubXml('<r>'+ '<p>'.repeat(140)+'字'+'</p>'.repeat(140)+'</r>','深层正文'),/结构过于复杂/)
 assert.throws(()=>parseEpubXml('<r>'+'<p/>'.repeat(60001)+'</r>','巨大目录'),/结构过于复杂/)
})
test('SVG的CSS转义和事件属性不能绕过本地资源限制',async()=>{
 const {safeSvg}=await import('../src/features/importing/epubSafety.ts')
 const svg=parseEpubXml('<svg xmlns="http://www.w3.org/2000/svg" onload="evil()"><rect fill="u\\72l(https\\3a //example.com/x)"/><use href="javascript:evil()"/><foreignObject><p>unsafe</p></foreignObject></svg>','转义图片')
 const cleaned=await safeSvg(svg,async()=>{assert.fail('不应请求网络')})
 assert.ok(!/example|onload|javascript|foreignObject|fill=/.test(cleaned))
})
