import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {buildBilingualDisplay} from '../src/features/translation/display.ts'
import {sourceCoverage,displayCoverage} from '../src/features/translation/coverage.ts'
import {buildDisplayText,sourceToDisplay,displayToSource} from '../src/features/replacement/displayText.ts'
import {applySentenceLibrary} from '../src/features/sentences/display.ts'
import {withOriginalEnglishLookup} from '../src/features/replacement/originalEnglish.ts'
import {sentenceRanges} from '../src/features/translation/package.ts'
const rules=JSON.parse(await readFile(new URL('../src/features/replacement/data/rules.json',import.meta.url)))
const sentences=JSON.parse(await readFile(new URL('../src/features/sentences/data/sentences.json',import.meta.url)))
const story=await readFile(new URL('fixtures/sentence-story.txt',import.meta.url),'utf8')
const ch={id:'six-levels',title:'来信',order:0,paragraphs:story.split('\n')}
// Deliberate translation doubles: test range selection, not literary translation quality.
const ready={segments:ch.paragraphs.flatMap((text,paragraph)=>sentenceRanges(text).map((r,i)=>({id:`${paragraph}-${i}`,source:{paragraph,...r},sourceText:text.slice(r.start,r.end),targetText:`This is an English protocol test sentence for paragraph ${paragraph}, group ${i}.`})))}
const baseline=c=>applySentenceLibrary(c,buildDisplayText(c.paragraphs.join('\n\n'),rules,{concentration:40,seed:'six'}),sentences,{concentration:40,seed:'six'}).model
const render=(level,translation=ready,c=ch,base=baseline(c))=>buildBilingualDisplay(c,base,translation,level,'six')
function selected(model){const result=new Set();for(const r of model.runs)if(r.translation||r.replacement)for(let i=r.sourceStart;i<r.sourceEnd;i++)if(/\p{L}/u.test(model.original[i]))result.add(i);return result}
function unchangedRanges(result){
 const {model}=result
 assert.equal(model.runs.map(r=>model.original.slice(r.sourceStart,r.sourceEnd)).join(''),model.original)
 assert.equal(model.runs.map(r=>model.text.slice(r.displayStart,r.displayEnd)).join(''),model.text)
 for(let i=1;i<model.runs.length;i++){assert.equal(model.runs[i-1].sourceEnd,model.runs[i].sourceStart);assert.equal(model.runs[i-1].displayEnd,model.runs[i].displayStart)}
 for(const r of model.runs){assert.equal(displayToSource(model,r.displayStart),r.sourceStart);assert.equal(sourceToDisplay(model,r.sourceStart),r.displayStart)}
}
test('统一六档按原文范围接近目标，20/40复用真句段；单词/句型/AI只计一次',()=>{
 const before=JSON.stringify(ch),base=baseline(ch);let previous=new Set()
 for(const level of [0,20,40,60,80,100]){
  const result=render(level,ready,ch,base)
  assert.ok(Math.abs(result.coveredPercent-level)<1,`${level}: ${result.coveredPercent}`)
  if(level>0)assert.ok(result.translated>0)
  const independent=selected(result.model)
  assert.equal(independent.size,result.covered)
  assert.equal(result.coveredPercent,Math.round(independent.size/result.total*1000)/10)
  for(const offset of previous)assert.ok(independent.has(offset),`level ${level} lost ${offset}`)
  previous=independent;unchangedRanges(result)
  assert.deepEqual(render(level,ready,ch,base),result)
 }
 assert.equal(render(0,ready,ch,base).model.text,ch.paragraphs.join('\n\n'))
 assert.equal(JSON.stringify(ch),before)
})
test('实际覆盖不受英文长度、中文括注、掌握/查词拆词影响，重复原文范围只计一次',()=>{
 const a=render(40),long={segments:ready.segments.map(s=>({...s,targetText:s.targetText.repeat(3)}))}
 assert.equal(render(40,long).coveredPercent,a.coveredPercent)
 const hintBase=applySentenceLibrary(ch,buildDisplayText(ch.paragraphs.join('\n\n'),rules,{concentration:40,seed:'six',showChineseHints:true}),sentences,{concentration:40,seed:'six'}).model
 const hinted=render(40,ready,ch,hintBase)
 assert.equal(hinted.coveredPercent,a.coveredPercent)
 const lookup=withOriginalEnglishLookup(a.model,['English protocol'])
 assert.deepEqual(displayCoverage(ch,lookup),{covered:a.covered,total:a.total,percent:a.coveredPercent})
})
test('无缓存不伪装达标，部分译文只用已完成内容；100%显示全部已有译文',()=>{
 const partial={segments:ready.segments.slice(0,3)}
 for(const level of [20,40,60,80]){
  const result=render(level,partial)
  assert.equal(result.complete,false);assert.match(result.message,/未有可靠英文的范围保留中文/)
  assert.equal(result.covered,selected(result.model).size);assert.ok(result.coveredPercent<=level+1);unchangedRanges(result)
 }
 for(const level of [20,40]){const result=render(level,null);assert.match(result.message,/暂无句子译文/);assert.equal(result.translated,0);assert.equal(result.covered,selected(result.model).size)}
 const all=render(100,partial);assert.ok(all.coveredPercent>0);assert.equal(all.translated,partial.segments.length);assert.match(all.badge,/部分译文/);unchangedRanges(all)
})
test('EPUB标题/pre/图片/标点/数字不虚增英文覆盖，不改变原始块或文字',()=>{
 const c={id:'protected',title:'正文',order:0,paragraphs:['章标题','代码','\uFFFC','2026？！','𠮷村推开窗。她笑了。'],blocks:[{kind:'heading'},{kind:'pre'},{kind:'image'},{kind:'paragraph'},{kind:'paragraph'}]}
 const coverage=sourceCoverage(c);assert.equal(coverage.total,8)
 const translated={segments:c.paragraphs.filter((_,i)=>i!==2).map(text=>({id:text,source:{paragraph:c.paragraphs.indexOf(text),start:0,end:text.length},sourceText:text,targetText:'Yoshimura opened the window. She smiled.'}))}
 const result=render(100,translated,c)
 assert.equal(result.coveredPercent,100);assert.ok(result.model.text.includes('章标题\n\n代码\n\n\uFFFC\n\n2026？！'))
 assert.ok(!result.model.runs.filter(r=>r.translation).some(r=>r.sourceStart<coverage.original.indexOf('𠮷')))
 unchangedRanges(result)
})
test('部分范围边界交叉不截断本地短语，已有整句取代内部词组无重复',()=>{
 const c={id:'overlap',title:'正文',order:0,paragraphs:['月亮挂在天空。他走进邮局。她推开窗户。']}
 const base=baseline(c),translation={segments:[{id:'a',source:{paragraph:0,start:0,end:8},sourceText:c.paragraphs[0].slice(0,8),targetText:'The moon hung in the sky.'},{id:'b',source:{paragraph:0,start:8,end:c.paragraphs[0].length},sourceText:c.paragraphs[0].slice(8),targetText:'He entered the post office. She opened the window.'}]}
 for(const level of [20,40,60,80,100])unchangedRanges(render(level,translation,c,base))
})
test('六千句组只处理当前章，六档单调稳定且无需整本书渲染',()=>{
 const c={id:'bounded',title:'长章',order:0,paragraphs:Array.from({length:6000},()=> '雨停了。')}
 const t={segments:c.paragraphs.map((sourceText,paragraph)=>({id:`p${paragraph}`,source:{paragraph,start:0,end:sourceText.length},sourceText,targetText:'The rain had stopped.'}))}
 const base=buildDisplayText(c.paragraphs.join('\n\n'),[],{concentration:0,seed:'six'})
 for(const level of [0,20,40,60,80,100]){const result=render(level,t,c,base);assert.equal(result.coveredPercent,level)}
})

test('中文提示按最终显示的首次词语计算，候选中更早但未显示的词不吞掉提示',()=>{
 const c={id:'hints',title:'正文',order:0,paragraphs:Array.from({length:30},()=> '月亮挂在天空，邮局的柜台旁放着花盆。她走进旧屋。')}
 const base=buildDisplayText(c.paragraphs.join('\n\n'),rules,{concentration:40,seed:'six',showChineseHints:false})
 for(const level of [20,40]){
  const result=buildBilingualDisplay(c,base,undefined,level,'six',{showChineseHints:true})
  const seen=new Set()
  for(const run of result.model.runs.filter(r=>r.replacement)){
   assert.equal(run.hint,!seen.has(run.entryId));seen.add(run.entryId)
  }
  assert.ok(seen.size>0)
  const off=buildBilingualDisplay(c,base,undefined,level,'six',{showChineseHints:false})
  assert.equal(off.coveredPercent,result.coveredPercent);assert.ok(!off.model.text.includes('（'))
  const mastered=buildBilingualDisplay(c,base,undefined,level,'six',{showChineseHints:true,mastered:seen})
  assert.equal(mastered.coveredPercent,result.coveredPercent);assert.ok(!mastered.model.text.includes('（'))
 }
})
