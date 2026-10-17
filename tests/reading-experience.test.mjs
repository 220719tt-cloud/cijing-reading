import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import {readerGesture,readingTapZone,readerTargetBlocked,inReadingBand} from '../src/features/reading/readerGesture.ts'
import {buildDisplayText} from '../src/features/replacement/displayText.ts'
import {applySentenceLibrary} from '../src/features/sentences/display.ts'
import {buildBilingualDisplay} from '../src/features/translation/display.ts'
import {withOriginalEnglishLookup} from '../src/features/replacement/originalEnglish.ts'
const rules=JSON.parse(await readFile(new URL('../src/features/replacement/data/rules.json',import.meta.url)))
const entries=JSON.parse(await readFile(new URL('../src/features/sentences/data/sentences.json',import.meta.url)))
test('手机和桌面按屏幕左右20%分区，边缘留白也有效，中心60%只切工具栏',()=>{
 for(const [left,width] of [[0,390],[0,1024],[10,820]]){
  for(const x of [0,1,width*.19,width*.2])assert.equal(readingTapZone(left+x,left,width),'previous')
  for(const x of [width*.21,width*.3,width*.5,width*.7,width*.79])assert.equal(readingTapZone(left+x,left,width),'toolbar')
  for(const x of [width*.8,width*.95,width-1,width])assert.equal(readingTapZone(left+x,left,width),'next')
  assert.equal(readingTapZone(left-1,left,width),'ignore');assert.equal(readingTapZone(left+width+1,left,width),'ignore')
  assert.equal(readingTapZone(left+1,left,width,true),'toolbar')
 }
 assert.equal(inReadingBand(85,86,700),false);assert.equal(inReadingBand(86,86,700),true);assert.equal(inReadingBand(699,86,700),true);assert.equal(inReadingBand(700,86,700),false)
})
test('英文词语／整句可识别点击且不屏蔽滑动，其他所有交互和工具栏留白排除翻页',()=>{
 const dom=new JSDOM(`<main><span data-word-start="0" role="button">He nodded.</span><button><span>Aa</span></button><input type="range"><label>进度</label><dialog open><p>释义</p></dialog><div class="reader-bottom-tools"><div>留白</div></div><header class="reading-toolbar">留白</header><footer class="reading-page-footer">页码</footer><p>普通中文</p></main>`)
 const doc=dom.window.document
 for(const selector of ['button span','input','label','dialog p','.reader-bottom-tools div','.reading-toolbar','.reading-page-footer'])assert.equal(readerTargetBlocked(doc.querySelector(selector)),true,selector)
 assert.equal(readerTargetBlocked(doc.querySelector('[data-word-start]')),false);assert.equal(readerTargetBlocked(doc.querySelector('main > p')),false)
 for(const wordStart of [undefined,0,120]){
  const start={x:388,y:300,time:0,wordStart}
  assert.equal(readerGesture(start,{x:388,y:301,time:90},false),wordStart===undefined?'tap':'word')
  assert.equal(readerGesture(start,{x:270,y:303,time:200},false),'next')
  assert.equal(readerGesture(start,{x:430,y:300,time:200},false),'previous')
  assert.equal(readerGesture(start,{x:388,y:400,time:200},false),'ignore')
  assert.equal(readerGesture(start,{x:388,y:300,time:800},false),'ignore')
 }
 dom.window.close()
})
test('词内不同词义和固定表达不拆碎，否定及名词化形容词保留中文',()=>{
 const protectedText='眼镜蛇钻过面包车。咖啡色的笔记本电脑放在汽车站旁。他翻开回忆录，摸了摸手指头。老人家说他有些孩子气。她谈到孤独症、恐惧症与呼吸道。她轻轻松松地离开，慢慢悠悠地走着，说起悄悄话。忽然间，她想慢慢来。重要的是，不是越快越好。他选择了安静的。朋友们和孩子们都在这里。'
 for(const concentration of [20,40]){
  const model=buildDisplayText(protectedText,rules,{concentration,seed:'boundary'})
  for(const expression of ['眼镜蛇','面包车','咖啡色','笔记本电脑','汽车站','回忆录','手指头','老人家','孩子气','孤独症','恐惧症','呼吸道','轻轻松松','慢慢悠悠','悄悄话','忽然间','慢慢来','重要的是','安静的。','朋友们','孩子们'])assert.ok(model.text.includes(expression),expression)
  assert.equal(model.original,protectedText)
 }
 const pair=buildDisplayText('他拿起一双手套和一对靴子。她看见一副翅膀。',rules,{concentration:40,seed:'pair'})
 const selected=pair.runs.filter(run=>run.replacement)
 assert.equal(selected.find(run=>run.chinese==='手套')?.english,'gloves');assert.equal(selected.find(run=>run.chinese==='靴子')?.english,'boots');assert.equal(selected.find(run=>run.chinese==='翅膀')?.english,'wings')
})
test('20/40混合词语、整句与真实译文不重叠不漏字，不对生成英文再次替换',()=>{
 const c={id:'quality',title:'第一章',order:0,paragraphs:['雨停了。她深吸了一口气。“别担心。”她说。他拿出一双手套。','窗外的月亮照亮了邮局，眼镜蛇钻到了面包车下面。']}
 const original=c.paragraphs.join('\n\n'),snapshot=JSON.stringify(c)
 const translation={segments:[{id:'rain',source:{paragraph:0,start:0,end:4},sourceText:'雨停了。',targetText:'The rain stopped.'}]}
 for(const concentration of [20,40]){
  const base=buildDisplayText(original,rules,{concentration,seed:'quality'})
  const bilingual=buildBilingualDisplay(c,base,translation,concentration,'quality')
  const model=applySentenceLibrary(c,bilingual.model,entries,{concentration,seed:'quality'}).model
  assert.equal(model.runs.map(run=>original.slice(run.sourceStart,run.sourceEnd)).join(''),original)
  assert.equal(model.runs.map(run=>model.text.slice(run.displayStart,run.displayEnd)).join(''),model.text)
  assert.equal(withOriginalEnglishLookup(model).text,model.text)
  assert.ok(model.text.includes('眼镜蛇'));assert.ok(model.text.includes('面包车'))
  assert.ok((model.text.match(/The rain stopped\./g)||[]).length<=1)
 }
 assert.equal(JSON.stringify(c),snapshot)
})
