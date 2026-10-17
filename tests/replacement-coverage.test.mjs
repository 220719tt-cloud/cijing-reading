import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {buildDisplayText,sourceToDisplay,displayToSource} from '../src/features/replacement/displayText.ts'
import {sampleBooks} from '../src/features/reading/sampleBooks.ts'
import {chapterText,offsetToPosition,positionToOffset,pageForOffset} from '../src/features/reading/readingPosition.ts'
const raw=await readFile(new URL('../src/features/replacement/data/rules.json',import.meta.url))
const rules=JSON.parse(raw)
const evidence=JSON.parse(await readFile(new URL('../data/replacement/source-evidence.json',import.meta.url)))
const report=JSON.parse(await readFile(new URL('../data/replacement/build-report.json',import.meta.url)))
const licenseNotice=await readFile(new URL('../public/licenses/REPLACEMENT-NOTICE.txt',import.meta.url),'utf8')
const story=await readFile(new URL('fixtures/replacement-story.txt',import.meta.url),'utf8')
const settings={seed:'daily:chapter-1',concentration:40,titles:['第一章 雨后的邮局']}
const single=(text,chinese)=>buildDisplayText(text,rules.filter(rule=>rule.chinese===chinese),settings)
const selected=model=>model.runs.filter(run=>run.replacement)
test('编辑精选映射与许可来源证据逐项对应，不反转查询词典',()=>{
 const notice=licenseNotice
 assert.ok(notice.includes('CC BY-SA 4.0') && notice.includes('MIT'))
 assert.equal(rules.length,report.rules)
 assert.ok(rules.length>=300)
 assert.equal(new Set(rules.map(rule=>rule.chinese)).size,rules.length)
 assert.equal(createHash('sha256').update(raw).digest('hex'),report.sha256)
 for (const rule of rules){
  const source=evidence.find(item=>item.id===rule.id)
  assert.ok(source && source.sources.length>0)
  assert.equal(source.english,rule.english)
  for(const sense of source.evidence.split(';'))assert.ok(source.sources.some(item=>item.meaning.includes(sense)),`${rule.chinese}:${sense}`)
 }
})
test('原创日常小说两档密度明显递增，选取嵌套，0%原样恢复',()=>{
 const before=story, snapshot=JSON.stringify(rules)
 const a=buildDisplayText(story,rules,{...settings,concentration:20}),b=buildDisplayText(story,rules,settings)
 assert.ok(a.replaced>=15,`20%=${a.replaced}`)
 assert.ok(b.replaced>=a.replaced*1.5,`${a.replaced}/${b.replaced}`)
 assert.ok(selected(a).every(run=>selected(b).some(other=>run.sourceStart===other.sourceStart)))
 assert.deepEqual(buildDisplayText(story,rules,settings),b)
 assert.equal(buildDisplayText(story,rules,{...settings,concentration:0}).text,story)
 assert.equal(story,before);assert.equal(JSON.stringify(rules),snapshot)
 console.log(`原创日常小说：候选${b.eligible}，20%=${a.replaced}，40%=${b.replaced}`)
})
test('月亮邮局真实示例覆盖首段，40%不再只有一两处',()=>{
 const book=sampleBooks.find(book=>book.id==='moon'),chapter=book.chapters[0]
 const source=chapterText(chapter), saved=JSON.stringify(book)
 const options={seed:`${book.id}:${chapter.id}`,titles:[book.title,chapter.title]}
 const a=buildDisplayText(source,rules,{...options,concentration:20}), b=buildDisplayText(source,rules,{...options,concentration:40})
 assert.ok(a.replaced>=12 && b.replaced>=25 && b.replaced>a.replaced)
 const first=selected(b).filter(run=>run.sourceStart<chapter.paragraphs[0].length)
 assert.ok(first.length>=6)
 assert.equal(JSON.stringify(book),saved)
 console.log(`月亮邮局：候选${b.eligible}，20%=${a.replaced}，40%=${b.replaced}，首段40%=${first.length}`)
})
test('完整短语最长匹配，不拆分、不嵌套，也不重写生成的英文/提示',()=>{
 const text='他会毫不犹豫地走向神秘的旧屋。他看见深绿色的花盆和栀子花，清清楚楚地想起了过去。'
 const model=buildDisplayText(text,rules,settings), spans=selected(model)
 assert.equal(new Set(spans.map(run=>run.sourceStart)).size,spans.length)
 for(let i=1;i<model.runs.length;i++)assert.equal(model.runs[i-1].sourceEnd,model.runs[i].sourceStart)
 for (const [zh,en] of [['邮局','post office'],['花盆','flowerpot'],['旧屋','old house'],['月亮','moon'],['神秘的','mysterious'],['毫不犹豫地','without hesitation'],['突然','suddenly']]){
  const result=single(`他看着那里。${zh}${zh==='神秘的'?'旧屋':''}。身后的往事依然让他觉得那天十分特别。`,zh)
  assert.equal(result.replaced,1);assert.ok(result.text.includes(en))
 }
 for(const run of spans){
  const zh=text.slice(run.sourceStart,run.sourceEnd)
  assert.ok(!['犹豫','绿色的','栀子','清楚地'].includes(zh),zh)
 }
 // The original is exactly reconstructed from all runs, including untouched punctuation.
 assert.equal(model.runs.map(run=>text.slice(run.sourceStart,run.sourceEnd)).join(''),text)
})
test('普通对话可替换，姓名、书名、章节、地名与公司名保持中文',()=>{
 const text='第一章 月亮和邮局\n他名叫月亮。月亮站在门口。“当然可以，地址在地图上。”\n《神秘的邮局》在书架上。她名为森林。森林穿过月亮城。她去了森林月亮城。苹果公司很远。'
 const result=buildDisplayText(text,rules,{...settings,titles:['第一章 月亮和邮局']})
 assert.ok(result.text.startsWith('第一章 月亮和邮局'))
 assert.ok(result.text.includes('《神秘的邮局》'))
 assert.ok(!result.text.includes('moon'));assert.ok(!result.text.includes('forest'));assert.ok(!result.text.includes('apple'))
 assert.ok(result.text.includes('月亮城') && result.text.includes('森林月亮城'))
 assert.ok(['of course','address','map'].some(word=>result.text.includes(word)))
})
test('谨慎处理动词语法、固定搭配、物主代词与数量，不机械翻译',()=>{
 for (const [text,term] of [['他放弃了计划。','放弃'],['他想起了过去。','想起'],['他沉默着。','沉默着'],['最后一页是空白。','最后'],['他想起初的约定。','起初'],['她的眼睛充满恐惧。','充满恐惧'],['他非常悲伤。','悲伤'],['她耐心等待。','耐心'],['她回忆往事。','回忆'],['他发送消息。','消息'],['他骑在马上看着远处。','马上'],['她不小心地碰到了杯子。','小心地']])assert.equal(single(text,term).text,text)
 assert.ok(single('他决定放弃这条旧路，身后的故事还没有结束。','放弃').text.includes('give up'))
 assert.ok(single('几盏灯笼照亮了前面的道路。','灯笼').text.includes('lanterns'))
 assert.ok(!single('几盏灯笼照亮了前面的道路。','灯笼').text.includes('lantern（'))
 assert.equal(single('几个老人走了过来。','老人').text,'几个老人走了过来。') // no invented plural for an unverified phrase
})
test('重排、左右翻页和刷新使用原文锚点，浓度切换不累计偏移',()=>{
 const chapter={id:'daily',order:0,title:'',paragraphs:story.trimEnd().split('\n\n')}
 const original=chapterText(chapter), target=original.indexOf('照片里的孩子')
 const position=offsetToPosition(chapter,target)
 const models=[0,20,40,0,40].map(concentration=>buildDisplayText(original,rules,{...settings,concentration}))
 for (const model of models){
  const anchor=positionToOffset(chapter,JSON.parse(JSON.stringify(position))) // persisted source position
  assert.equal(anchor,target)
  const displayOffset=sourceToDisplay(model,anchor)
  const back=displayToSource(model,displayOffset)
  assert.ok(Math.abs(back-target)<=4) // inside a replacement goes to that source token's beginning
  for(const pageWidth of [60,100,180]){
   const starts=Array.from({length:Math.ceil(model.text.length/pageWidth)},(_,i)=>i*pageWidth)
   const page=pageForOffset(starts,displayOffset)
   assert.ok(starts[page]<=displayOffset && displayOffset<(starts[page+1]??Infinity))
  }
 }
 assert.equal(models[0].text,models[3].text)
})
test('一万两千字单章保留连续原文范围，不依赖查询库加载或在线服务',()=>{
 const source=story.repeat(Math.ceil(12000/story.length)).slice(0,12000)
 const before=performance.now(), model=buildDisplayText(source,rules,settings)
 assert.equal(model.runs[0].sourceStart,0)
 assert.equal(model.runs.at(-1).sourceEnd,source.length)
 assert.equal(model.runs.map(run=>source.slice(run.sourceStart,run.sourceEnd)).join(''),source)
 console.log(`12000字符显示模型：${Math.round(performance.now()-before)}ms（开发机，非手机性能保证）`)
})
