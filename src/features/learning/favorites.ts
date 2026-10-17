import type { LearningKind, LearningWord, WordEntry } from '../vocabulary/types'
/** Old records have no kind; sentence namespaces and terminal punctuation are safe fallbacks. */
export function learningKind(entry:{id:string;word:string;kind?:string;learningKind?:LearningKind}):LearningKind {
  if(entry.learningKind) return entry.learningKind
  if(entry.kind==='sentence'||entry.id.startsWith('sentence:')) return 'sentence'
  if(entry.kind==='word'||entry.kind==='phrase') return entry.kind
  if(/[.!?]["'”’)]*$/u.test(entry.word.trim()) && /\s/u.test(entry.word.trim())) return 'sentence'
  return /\s/u.test(entry.word.trim())?'phrase':'word'
}
export const learningKindLabels:Record<LearningKind,string>={word:'单词',phrase:'短语',sentence:'句子'}
export function filterLearningEntries(entries:WordEntry[],query:string,kind:LearningKind|'all') {
  const normalized=query.normalize('NFKC').trim().toLowerCase().replace(/’/g,"'")
  const tokens=normalized.split(/\s+/u).filter(Boolean)
  return entries.filter(entry=>(kind==='all'||learningKind(entry)===kind)&&(!normalized||[entry.word,entry.translation].some(value=>{
    const text=value.normalize('NFKC').toLowerCase().replace(/’/g,"'")
    return tokens.every(token=>text.includes(token))
  })))
}
/** User learning records may include curated reader expressions outside the query shortlist. */
export function withLearningEntries(entries: WordEntry[], records: LearningWord[]): WordEntry[] {
  const ids = new Set(entries.map(entry => entry.id))
  const additions: WordEntry[] = []
  for (const entry of records) if (!ids.has(entry.id)) {
    ids.add(entry.id)
    additions.push({ id: entry.id, word: entry.word, phonetic: entry.phonetic, translation: entry.translation,
      tags: [], learningKind:learningKind(entry), kind: learningKind(entry)==='word'?'word':'phrase' })
  }
  return [...entries, ...additions]
}
