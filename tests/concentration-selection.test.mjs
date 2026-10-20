import test from 'node:test'
import assert from 'node:assert/strict'
import {closestGroups} from '../src/features/translation/selection.ts'
import {buildBilingualDisplay} from '../src/features/translation/display.ts'
import {buildDisplayText} from '../src/features/replacement/displayText.ts'
import {chapterText} from '../src/features/reading/readingPosition.ts'
const weights=[40,30,20,10]
const sum=values=>values.reduce((n,item)=>n+item.size,0)
test('位集跨32位边界与重复重量不复用片段；与穷举最接近结果一致',()=>{
 for(const sizes of [[31,32,33,63,64,65],[1,1,2,4,8,16,32],[40,30,20,10],[90,5,5]]){
  const list=sizes.map((size,id)=>({size,id})),total=sum(list)
  for(const target of [0,1,17,total*.2,total*.6,total*.8,total]){
   const chosen=closestGroups(list,item=>item.size,target,total),actual=sum(chosen),goal=Math.round(target)
   let best=0
   for(let mask=0;mask<(1<<sizes.length);mask++){
    const candidate=sizes.reduce((n,size,i)=>n+((mask&(1<<i))?size:0),0)
    if(Math.abs(candidate-goal)<Math.abs(best-goal)||Math.abs(candidate-goal)===Math.abs(best-goal)&&candidate<best)best=candidate
   }
   assert.equal(actual,best,`${sizes}: ${target}`);assert.equal(new Set(chosen).size,chosen.length)
  }
 }
})
test('部分译文不冒充目标比例，大句组无法接近时明确解释，不机械拆译句',()=>{
 const ch={id:'coarse',title:'正文',order:0,paragraphs:['她走进邮局，放下手中的信封。']}
 const original=chapterText(ch),baseline=buildDisplayText(original,[],{concentration:60,seed:'coarse'})
 const translation={segments:[{id:'group',chapterId:ch.id,source:{paragraph:0,start:0,end:ch.paragraphs[0].length},sourceText:ch.paragraphs[0],targetText:'She entered the post office and set down the envelope.'}]}
 const result=buildBilingualDisplay(ch,baseline,translation,60,'coarse')
 assert.equal(result.coveredPercent,100);assert.match(result.message,/句组不可拆分/)
 assert.equal(result.model.runs.filter(run=>run.translation).length,1);assert.equal(result.model.original,original)
 const missing=buildBilingualDisplay(ch,baseline,undefined,80,'coarse')
 assert.equal(missing.coveredPercent,0);assert.match(missing.message,/自动翻译/);assert.equal(missing.model.text,original)
})
test('真实显示模型中60/80选完整对应句组，原文位置连续且100仍须完整',()=>{
 const ch={id:'weighted',title:'算法测试',order:0,paragraphs:weights.map(size=>'文'.repeat(size))}
 const translation={segments:ch.paragraphs.map((sourceText,paragraph)=>({id:`p${paragraph}`,chapterId:ch.id,source:{paragraph,start:0,end:sourceText.length},sourceText,targetText:`English test group ${paragraph}.`}))}
 const original=chapterText(ch),before=JSON.stringify(ch)
 for(const level of [60,80,100]){
  const result=buildBilingualDisplay(ch,buildDisplayText(original,[],{concentration:level,seed:'weighted'}),translation,level,'weighted')
  assert.equal(result.coveredPercent,level);assert.equal(result.availablePercent,100)
  if(level===100)assert.equal(result.coveredPercent,100)
  assert.equal(result.model.runs.map(run=>original.slice(run.sourceStart,run.sourceEnd)).join(''),original)
  assert.ok(result.model.runs.filter(run=>run.translation).every(run=>translation.segments.some(segment=>segment.targetText===run.contextEnglish)))
 }
 const partial={segments:translation.segments.slice(0,2)}
 const result=buildBilingualDisplay(ch,buildDisplayText(original,[],{concentration:100,seed:'weighted'}),partial,100,'weighted')
 assert.equal(result.model.text,original);assert.equal(result.availablePercent,70);assert.equal(result.coveredPercent,0)
 assert.equal(JSON.stringify(ch),before)
})

test('粗句组可达到目标时不为强求嵌套停在60%，调整句组必须如实解释',()=>{
 const chapter={id:'coarse-ladder',title:'正文',order:0,paragraphs:weights.map(weight=>'文'.repeat(weight))}
 const source=chapterText(chapter),baseline=buildDisplayText(source,[],{concentration:40,seed:'coarse-ladder'})
 const cached={segments:chapter.paragraphs.map((sourceText,paragraph)=>({id:`p${paragraph}`,source:{paragraph,start:0,end:sourceText.length},sourceText,targetText:`An English test group for paragraph ${paragraph}.`}))}
 for(const level of [0,20,40,60,80,100]){
  const result=buildBilingualDisplay(chapter,baseline,cached,level,'coarse-ladder')
  assert.equal(result.coveredPercent,level)
  assert.equal(result.model.runs.map(r=>source.slice(r.sourceStart,r.sourceEnd)).join(''),source)
  if(level===40||level===80)assert.match(result.message,/逐档包含/)
 }
})
