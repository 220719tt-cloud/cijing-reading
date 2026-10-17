import { Fragment } from 'react'
import type { Chapter } from '../../shared/types/book'
import type { DisplayRun, DisplayText } from '../replacement/displayText'
import { fragmentsForBlock } from './epubDisplay'
export function ChapterContent({chapter,display,urls,pageStart,pageEnd,scrolling,onWord,onImageLayout}:{
  chapter:Chapter;display:DisplayText;urls:Record<string,string>;pageStart:number;pageEnd:number;scrolling:boolean;onWord:(word:DisplayRun)=>void;onImageLayout:()=>void;
}) {
  function word(run:DisplayRun,value:string,marks:string[]=[]) {
    return <span key={run.displayStart} className={`reader-word ${marks.map(mark=>`epub-${mark}`).join(' ')}`} role="button"
      data-word-start={run.displayStart} aria-label={`查看 ${run.english} 的释义`} aria-haspopup="dialog"
      tabIndex={scrolling || run.displayStart>=pageStart&&run.displayStart<pageEnd ? 0 : -1}
      onClick={event=>{event.stopPropagation();if(event.detail===0) onWord(run)}}
      onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();onWord(run)}}}
    >{value}</span>
  }
  if(!chapter.blocks) return <>{display.runs.map(run=>(run.replacement || run.lookup) ? word(run,display.text.slice(run.displayStart,run.displayEnd)) : display.text.slice(run.displayStart,run.displayEnd))}</>
  let offset=0
  return <>{chapter.blocks.map((block,index)=>{
    const start=offset;offset+=block.text.length+2
    return <Fragment key={index}>{index>0?'\n\n':null}{block.kind==='image' ? <span className="epub-image" data-reader-image="" data-alt={block.alt||'正文插图'}>
      <span className="epub-image-anchor">{block.text}</span>
      {urls[block.resourceId??'']&&<img src={urls[block.resourceId!]} alt={block.alt||'正文插图'} onLoad={onImageLayout} onError={event=>{event.currentTarget.style.display='none';event.currentTarget.parentElement?.setAttribute('data-failed','true');onImageLayout()}} />}
    </span> : <span className={`epub-block epub-${block.kind}`} data-heading-level={block.level}>
      {fragmentsForBlock(display,start,start+block.text.length,block.marks).map((fragment,i)=>fragment.run ? word(fragment.run,fragment.text,fragment.marks) : fragment.marks.length ? <span key={i} className={fragment.marks.map(mark=>`epub-${mark}`).join(' ')}>{fragment.text}</span> : fragment.text)}
    </span>}</Fragment>
  })}</>
}
