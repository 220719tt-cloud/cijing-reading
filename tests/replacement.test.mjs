import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildDisplayText, sourceToDisplay, displayToSource } from '../src/features/replacement/displayText.ts'
const candidates=JSON.parse(await readFile(new URL('../src/features/replacement/data/rules.json',import.meta.url)))
const source=Array.from({length:20},(_,i)=>`第${i+1}夜，他突然发现一盏灯笼。她鼓起勇气，走进森林。月亮升起，他沉默着，迟早会抵达。\n`).join('')
const options={seed:'test:chapter',concentration:20,showChineseHints:true}
test('0%完整恢复，60/80/100保持原文；源字符串和候选数据不变',()=>{
 const before=JSON.stringify(candidates)
 for(const level of [0,60,80,100])assert.equal(buildDisplayText(source,candidates,{...options,concentration:level}).text,source)
 assert.equal(JSON.stringify(candidates),before)
})
test('20/40稳定选取，增加浓度增加候选，未使用随机数',()=>{
 const a=buildDisplayText(source,candidates,options), b=buildDisplayText(source,candidates,{...options,concentration:40})
 assert.ok(a.replaced>0 && b.replaced>a.replaced)
 assert.deepEqual(buildDisplayText(source,candidates,options),a)
 assert.ok(a.runs.filter(run=>run.replacement).every(run=>b.runs.some(other=>other.replacement&&other.sourceStart===run.sourceStart)))
})
test('跳过多义候选、书名、地名后缀、章节标题及已介绍人名',()=>{
 const text='第一章 突然之间，月亮升起\n他名叫月亮。月亮升起，他突然发现《突然之间，月亮升起》这本书。希望、世界、秘密、发现不自动替换。月亮城很远。'
 const result=buildDisplayText(text,candidates,{...options,concentration:40,titles:['第一章 突然之间，月亮升起']})
 assert.ok(result.text.startsWith('第一章 突然之间，月亮升起'))
 assert.ok(result.text.includes('《突然之间，月亮升起》'))
 assert.ok(result.text.includes('月亮升起'))
 assert.ok(!result.text.includes('moon'))
 assert.ok(result.text.includes('希望、世界、秘密、发现'))
 const none=buildDisplayText('月亮城在远处。秘密计划被发现了。',candidates,{...options,concentration:40})
 assert.ok(none.text.includes('月亮城') && none.text.includes('秘密计划被发现了'))
 assert.ok(!none.text.includes('moon'))
})
test('重复词只在本章首次选中时提示，已掌握词不显示提示',()=>{
 const a=buildDisplayText(source,candidates,{...options,concentration:40})
 for(const id of new Set(a.runs.filter(run=>run.replacement).map(run=>run.entryId)))assert.equal(a.runs.filter(run=>run.entryId===id&&run.hint).length,1)
 const known=buildDisplayText(source,candidates,{...options,concentration:40,mastered:new Set(candidates.map(rule=>rule.entryId))})
 assert.ok(known.runs.filter(run=>run.replacement).every(run=>!run.hint))
})
test('显示坐标映射回原文，分页和滚动可使用原文锚点',()=>{
 const result=buildDisplayText(source,candidates,{...options,concentration:40})
 for(const run of result.runs){
  assert.equal(displayToSource(result,run.displayStart),run.sourceStart)
  assert.equal(sourceToDisplay(result,run.sourceStart),run.displayStart)
  assert.equal(displayToSource(result,run.displayEnd),run.sourceEnd)
 }
 for(let offset=0;offset<=source.length;offset++){
  const roundTrip=displayToSource(result,sourceToDisplay(result,offset))
  const covering=result.runs.find(run=>run.replacement&&run.sourceStart<=offset&&run.sourceEnd>offset)
  assert.equal(roundTrip,covering?covering.sourceStart:offset)
 }
})
test('介词短语仅替换行动状语，复数名词不强行替成单数',()=>{
 const invalid='他沉默着。几位陌生人提着几盏灯笼。'
 const display=buildDisplayText(invalid,candidates,{...options,concentration:40}); assert.ok(!display.text.includes('in silence')); assert.ok(!/stranger（|lantern（/.test(display.text))
 const valid='他沉默着走过长廊。'
 assert.ok(buildDisplayText(valid,candidates,{...options,concentration:20}).text.includes('in silence'))
})
