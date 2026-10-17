import { useEffect, useMemo, useState } from 'react'
import data from './data/sentences.json'
import { searchSentences, sentenceCategories } from './library'
import type { SentenceEntry } from './library'
import { WordMeaningCard } from '../learning/WordMeaningCard'
import { listMastery } from '../vocabulary/storage'
import type { DisplayRun } from '../replacement/displayText'
const entries=data as SentenceEntry[]
export function SentenceLibrary({onLearningChange}:{onLearningChange?:()=>void}) {
  const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[limit,setLimit]=useState(20)
  const [selected,setSelected]=useState<SentenceEntry|null>(null),[mastered,setMastered]=useState(new Set<string>())
  useEffect(()=>{let active=true;listMastery().then(records=>{if(active)setMastered(new Set(records.filter(item=>item.mastered).map(item=>item.id)))}).catch(()=>{});return()=>{active=false}},[])
  const result=useMemo(()=>searchSentences(entries,query,category,limit),[query,category,limit])
  const word:DisplayRun|undefined=selected?{sourceStart:0,sourceEnd:selected.chinese.length,displayStart:0,displayEnd:selected.english.length,replacement:true,sentence:true,entryId:selected.id,english:selected.english,chinese:selected.chinese}:undefined
  return <section className="sentence-library" aria-labelledby="sentence-library-title">
    <h2 id="sentence-library-title">常见句型库 · {entries.length}</h2>
    <p className="muted">人物对话、心理、动作、情绪与环境的完整例句。支持中英文查询、分类和收藏。</p>
    <label className="field-label">查句型或中文原句<input type="search" value={query} onChange={event=>{setQuery(event.target.value);setLimit(20)}} placeholder="试试 Don't worry 或 点了点头" autoCapitalize="none" autoCorrect="off" /></label>
    <label className="field-label">句型分类<select value={category} onChange={event=>{setCategory(event.target.value);setLimit(20)}}><option value="all">全部分类</option>{Object.entries(sentenceCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <p className="micro" role="status">找到 {result.total} 条，显示 {result.entries.length} 条</p>
    <ul className="sentence-results">{result.entries.map(entry=><li key={entry.id}><button onClick={()=>setSelected(entry)} aria-label={`查看并收藏句型：${entry.english}`}><span className="micro">{sentenceCategories[entry.category]}</span><strong>{entry.english}</strong><span>{entry.chinese}</span><span className="micro">查看原句与收藏 ›</span></button></li>)}</ul>
    {limit<result.total&&<button className="text-button" onClick={()=>setLimit(value=>Math.min(200,value+20))}>查看更多句型</button>}
    <p className="micro">20%／40% 使用整句匹配，保留原文。对话用于引语，叙述用于引语之外；相似句不会强行套用。</p>
    <a className="text-button" href={`${import.meta.env.BASE_URL}licenses/SENTENCE-NOTICE.txt`} target="_blank" rel="noreferrer">句型来源与使用说明</a>
    {word&&<WordMeaningCard onLearningChange={onLearningChange} key={word.entryId} word={word} mastered={mastered.has(word.entryId!)} onMasteryChange={(id,value)=>setMastered(previous=>{const next=new Set(previous);if(value)next.add(id);else next.delete(id);return next})} onClose={()=>setSelected(null)} />}
  </section>
}
