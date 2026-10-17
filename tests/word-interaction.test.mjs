import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {buildDisplayText,sourceToDisplay,displayToSource} from '../src/features/replacement/displayText.ts'
import {readerGesture} from '../src/features/reading/readerGesture.ts'
import {locateTextOffset} from '../src/features/reading/textNodes.ts'
import {startEnglishSpeech} from '../src/features/learning/pronunciation.ts'
import {withLearningEntries} from '../src/features/learning/favorites.ts'
const rules=JSON.parse(await readFile(new URL('../src/features/replacement/data/rules.json',import.meta.url)))
const source='他推开邮局的木门（门上的字是原文）(收信说明)，柜台旁摆着一个花盆。他忽然发现一张地图。'.repeat(5)
const options={seed:'word-card',concentration:40}
test('默认不生成中文括注，开关不改变匹配范围，原文括号与0%完整保留',()=>{
 const off=buildDisplayText(source,rules,options),on=buildDisplayText(source,rules,{...options,showChineseHints:true})
 assert.ok(off.replaced>0);assert.equal(off.replaced,on.replaced)
 assert.deepEqual(off.runs.filter(run=>run.replacement).map(run=>run.sourceStart),on.runs.filter(run=>run.replacement).map(run=>run.sourceStart))
 assert.ok(off.text.includes('(收信说明)'));assert.ok(on.text.includes('(收信说明)'));
 assert.ok(off.text.includes('（门上的字是原文）'));assert.ok(on.text.includes('（门上的字是原文）'))
 assert.ok(off.runs.filter(run=>run.replacement).every(run=>!run.hint))
 assert.ok(on.runs.some(run=>run.hint))
 for(const model of [off,on]){
  for(const run of model.runs){
   if(run.replacement){assert.ok(run.english && run.chinese && run.entryId); assert.equal(run.chinese,source.slice(run.sourceStart,run.sourceEnd))}
   assert.equal(displayToSource(model,sourceToDisplay(model,run.sourceStart)),run.sourceStart)
  }
  assert.equal(model.runs.map(run=>source.slice(run.sourceStart,run.sourceEnd)).join(''),source)
 }
 assert.equal(buildDisplayText(source,rules,{...options,concentration:0,showChineseHints:true}).text,source)
})
test('左右边缘的英文点击优先查义，英文上的滑动仍翻页，滚动与长按不误查',()=>{
 for(const x of [5,190,380]){
  const start={x,y:100,time:0,wordStart:8}
  assert.equal(readerGesture(start,{x,y:100,time:100},false),'word')
  assert.equal(readerGesture({...start,wordStart:undefined},{x,y:100,time:100},false),'tap')
  assert.equal(readerGesture(start,{x:x-80,y:102,time:100},false),'next')
  assert.equal(readerGesture(start,{x:x+80,y:102,time:100},false),'previous')
  assert.equal(readerGesture(start,{x,y:160,time:100},true),'ignore')
  assert.equal(readerGesture(start,{x,y:100,time:800},false),'ignore')
 }
})
test('多文本节点测量支持换行短语、原有括号、代理对及节点边界',()=>{
 const pieces=['原文（提示） ', 'old house', '（旧屋）', ' 𠮷 后文']
 const starts=pieces.map((_,i)=>pieces.slice(0,i).join('').length),lengths=pieces.map(p=>p.length)
 for(let offset=0;offset<=pieces.join('').length;offset++){
  const endpoint=locateTextOffset(starts,lengths,offset)
  assert.equal(starts[endpoint.index]+endpoint.offset,offset)
 }
 assert.equal(locateTextOffset(starts,lengths,starts[1]).index,1)
 assert.deepEqual(locateTextOffset([],[],0),null)
 assert.deepEqual(locateTextOffset(starts,lengths,-20),{index:0,offset:0})
})
test('优先英语本地语音，不使用中文语音；发音失败可报告且可取消',()=>{
 const calls=[],voices=[{lang:'zh-CN',localService:true},{lang:'en-US',localService:false},{lang:'en-GB',localService:true}]
 let utterance
 const environment={synthesis:{getVoices:()=>voices,cancel:()=>calls.push('cancel'),speak:word=>calls.push(word.text)},createUtterance:text=>(utterance={text})}
 let error='',ended=false
 const stop=startEnglishSpeech('old house',environment,message=>{error=message},()=>{ended=true})
 assert.equal(utterance.voice,voices[2]);assert.equal(utterance.lang,'en-GB')
 assert.deepEqual(calls,['cancel','old house'])
 utterance.onerror({error:'network'});assert.ok(error);assert.equal(ended,true)
 stop();assert.equal(calls.at(-1),'cancel');assert.equal(utterance.onerror,null)
})
test('词库以外的收藏也能在生词本展示，已有词典条目不重复或被简义覆盖',()=>{
 const entry={id:'moon',word:'moon',translation:'n. 月亮',phonetic:'mu:n',kind:'word',tags:[]}
 const favorites=[{id:'moon',word:'moon',translation:'月亮',phonetic:'',createdAt:'now'},{id:'old house',word:'old house',translation:'旧屋',phonetic:'',createdAt:'now'}]
 const result=withLearningEntries([entry],[...favorites,...favorites])
 assert.equal(result.length,2);assert.equal(result[0],entry)
 assert.equal(result[1].kind,'phrase');assert.equal(result[1].translation,'旧屋')
})
test('只有中文语音时明确降级，不强行以中文朗读英语',()=>{
 let error='',ended=false
 startEnglishSpeech('moon',{synthesis:{getVoices:()=>[{lang:'zh-CN',localService:true}],speak:()=>assert.fail('不能使用中文语音冒充英语'),cancel:()=>{}},createUtterance:text=>({text})},message=>{error=message},()=>{ended=true})
 assert.ok(error.includes('英语语音'));assert.equal(ended,true)
})
