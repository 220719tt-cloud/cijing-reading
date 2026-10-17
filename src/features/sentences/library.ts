export type SentenceCategory = 'conversation' | 'thought' | 'action' | 'emotion' | 'setting'
export interface SentenceEntry {
  id: string
  category: SentenceCategory
  chinese: string
  english: string
  source: string
}
export const sentenceCategories: Record<SentenceCategory,string> = {
  conversation:'人物对话', thought:'心理活动', action:'动作描写', emotion:'情绪表达', setting:'环境描写',
}
export function searchSentences(entries:readonly SentenceEntry[],query:string,category='all',limit=20) {
  const normalized=query.normalize('NFKC').trim().toLowerCase().replace(/’/g,"'")
  const tokens=normalized.split(/\s+/u).filter(Boolean)
  const matches=entries.filter(entry=>(category==='all'||entry.category===category)&&(!normalized||entry.chinese.normalize('NFKC').includes(normalized)||tokens.every(token=>entry.english.toLowerCase().includes(token))))
  const exact=matches.filter(entry=>entry.chinese.normalize('NFKC')===normalized||entry.english.toLowerCase()===normalized)
  return {total:matches.length,entries:[...exact,...matches.filter(entry=>!exact.includes(entry))].slice(0,limit)}
}
