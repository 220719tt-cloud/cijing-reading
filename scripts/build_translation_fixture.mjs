// Original story translations for manual acceptance only; never bundled or auto-installed.
import {writeFile,mkdir,readFile} from 'node:fs/promises'
import {sampleBooks} from '../src/features/reading/sampleBooks.ts'
import {createTranslationTemplate,validateTranslationPackage} from '../src/features/translation/package.ts'
import {txtImporter} from '../src/features/importing/txtImporter.ts'
const english=[
 'The post office at the end of the alley opened only after the moon had risen. By day, it was an old house with its doors and windows shut. In a flowerpot by the entrance grew a gardenia that never bloomed.',
 'It was not until her third day in the neighborhood that Zhou Ning noticed the opening hours on the door. Instead of numbers, there was a small silver crescent moon.',
 'That night, she came home late from work and saw warm yellow light spilling out of the house. An elderly man with round glasses sat behind the counter, stamping a stack of envelopes. With each stamp, a faint sound drifted down from the roof, as though someone had touched a wind chime.',
 '"Can I send a letter here?" she asked from the doorway.',
 'The old man looked up. "Of course. As long as you know whom you want to send it to."',
 '"Even if I do not know the address?"',
 '"Some people have addresses you will not find on a map." He took a sheet of writing paper from a drawer and slid it to the edge of the counter. "Sit down. Take your time."',
 'Zhou Ning sat by the window. She had not meant to write a letter, but the instant her pen touched the paper, a name she had not spoken aloud for a long time came clearly to mind.',
 'Outside the window, the gardenia opened its first flower.',
]
const dir=new URL('../tests/fixtures/translations/',import.meta.url);await mkdir(dir,{recursive:true})
const book=sampleBooks.find(book=>book.id==='moon'),value=await createTranslationTemplate(book)
value.chapters[0].segments=book.chapters[0].paragraphs.map((sourceText,paragraph)=>({id:`paragraph-${paragraph}`,chapterId:book.chapters[0].id,source:{paragraph,start:0,end:sourceText.length},sourceText,targetText:english[paragraph]}))
value.chapters[0].status='complete';value.chapters[0].identity.provider='original-story-test-fixture';value.chapters[0].identity.modelVersion='no-ai-model'
await writeFile(new URL('moon-en.json',dir),JSON.stringify(await validateTranslationPackage(value,book),null,2)+'\n')
const txt=await txtImporter.parse(new File([await readFile(new URL('../tests/fixtures/utf8.txt',import.meta.url))],'utf8.txt'))
const small=await createTranslationTemplate(txt)
const txtLines=new Map([
 ['《导入验证小说》','The Import Test Novel'],
 ['第一章 清晨','Chapter One: Morning'],
 ['这是一段原创测试文字。','This is an original passage written for testing.'],
 ['第二章 夜晚','Chapter Two: Night'],
 ['全书最后一句：星光照亮了归途。','The final sentence of the book: Starlight lit the way home.'],
])
for(const segment of small.chapters[0].segments){const text=txtLines.get(segment.sourceText.trim());if(!text)throw new Error('Unknown TXT fixture line');segment.targetText=text}
small.chapters[0].status='complete';small.chapters[0].identity.provider='original-story-test-fixture';small.chapters[0].identity.modelVersion='no-ai-model'
await writeFile(new URL('utf8-en.json',dir),JSON.stringify(await validateTranslationPackage(small,txt),null,2)+'\n')
console.log('Created explicit test translations: moon-en.json and utf8-en.json')

const {JSDOM}=await import('jsdom'),dom=new JSDOM('').window
Object.assign(globalThis,{document:dom.document,DOMParser:dom.DOMParser,XMLSerializer:dom.XMLSerializer})
const {epubImporter}=await import('../src/features/importing/epubImporter.ts')
const epub=await epubImporter.parse(new File([await readFile(new URL('../tests/fixtures/epub/chinese-epub3.epub',import.meta.url))],'chinese-epub3.epub'))
const epubValue=await createTranslationTemplate(epub)
const daily='邮局的柜台旁放着一个花盆，月亮挂在天空。她毫不犹豫地走进神秘的旧屋，看见一位老人戴着眼镜，正在抽屉里寻找信纸。窗外的风铃轻轻响起，她忽然鼓起勇气，准备寻找自己的朋友。'
const dailyEnglish='A flowerpot stood beside the post office counter, and the moon hung in the sky. Without hesitation, she entered the mysterious old house and saw an elderly person wearing glasses, searching a drawer for writing paper. The wind chime outside the window rang softly. She suddenly mustered her courage and prepared to look for her friend.'
const meanings=new Map([
 ['第一章 雨夜邮局','Chapter One: The Post Office on a Rainy Night'],
 ['这是一篇原创测试小说（原文括号必须保留）。邮局里的神秘的旧屋十分安静。\n雨已经停了。','This is an original test story (the parentheses in the original must be preserved). The mysterious old house in the post office was very quiet. The rain had stopped.'],
 ['雨中的约定','A Promise in the Rain'],
 ['第二节的准确锚点：她想起那封信，决定毫不犹豫地走向柜台。','The exact anchor for the second section: She remembered the letter and decided to walk to the counter without hesitation.'],
 ['本章结尾：她终于找到了地址。','The end of this chapter: She finally found the address.'],
 ['安全正文保留。','The safe body text is preserved.'],
 ['第二章 清晨来信','Chapter Two: A Letter in the Morning'],
 ['第二章开头：阳光照亮窗户，邮局门口出现一个陌生人。','The beginning of chapter two: Sunlight lit the window, and a stranger appeared at the entrance to the post office.'],
 ['[图片暂不可用：外部图片]','[Image unavailable: external image]'],
 ['全书最后一句：月光照亮了归途。','The final sentence of the book: Moonlight lit the way home.'],
 [daily,dailyEnglish],
])
for(const [index,translation] of epubValue.chapters.entries()) {
 translation.segments=[]
 epub.chapters[index].paragraphs.forEach((sourceText,paragraph)=>{
  if(epub.chapters[index].blocks[paragraph].kind==='image')return
  const numbered=sourceText.match(/^(\d+)。(.*)$/s)
  const targetText=numbered&&numbered[2]===daily?`${numbered[1]}. ${dailyEnglish}`:meanings.get(sourceText)
  if(!targetText)throw new Error(`No verified fixture translation for paragraph ${index}:${paragraph}`)
  translation.segments.push({id:`paragraph-${paragraph}`,chapterId:translation.chapterId,source:{paragraph,start:0,end:sourceText.length},sourceText,targetText})
 })
 translation.status='complete';translation.identity.provider='original-story-test-fixture';translation.identity.modelVersion='no-ai-model'
}
await writeFile(new URL('epub-en.json',dir),JSON.stringify(await validateTranslationPackage(epubValue,epub),null,2)+'\n')
console.log('Created explicit EPUB test translation: epub-en.json')
