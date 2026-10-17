import type { WordEntry } from './types'
export function normalizeQuery(value: string) { return value.normalize('NFKC').trim().toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ') }
/** Merge overlays by the same stable ID, retaining meanings and mastery associations. */
export function mergeVocabulary(base: WordEntry[], additions: WordEntry[]): WordEntry[] {
  const merged = new Map<string, WordEntry>()
  for (const entry of [...base, ...additions]) {
    const id = normalizeQuery(entry.word)
    const previous = merged.get(id)
    if (!previous) { merged.set(id, { ...entry, id }); continue }
    const sourceEntries = { ...previous.sourceEntries }
    for (const [source, reference] of Object.entries(entry.sourceEntries ?? {})) {
      const before = sourceEntries[source]
      sourceEntries[source] = before === undefined ? reference : [...new Set([...(Array.isArray(before) ? before : [before]), ...(Array.isArray(reference) ? reference : [reference])])]
    }
    merged.set(id, {
      ...previous, ...entry, id,
      translation: [...new Set([...previous.translation.split('\n'), ...entry.translation.split('\n')])].join('\n'),
      tags: [...new Set([...previous.tags, ...entry.tags])],
      meanings: [...new Set([...(previous.meanings ?? []), ...(entry.meanings ?? [])])],
      forms: [...new Set([...(previous.forms ?? []), ...(entry.forms ?? [])].map(normalizeQuery))],
      sources: [...new Set([...(previous.sources ?? []), ...(entry.sources ?? [])])],
      sourceEntries,
    })
  }
  return [...merged.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
export function queryVocabulary(entries: WordEntry[], input: string, limit = 30): WordEntry[] {
  const query = normalizeQuery(input)
  if (!query) return []
  const exact: WordEntry[] = [], aliases: WordEntry[] = [], prefix: WordEntry[] = [], other: WordEntry[] = []
  const chinese = /[\u3400-\u9fff]/.test(query)
  const tokens = query.split(' ')
  for (const entry of entries) {
    const searchable=normalizeQuery(entry.word)
    if (searchable === query) exact.push(entry)
    else if (entry.forms?.includes(query)) aliases.push(entry)
    else if (!chinese && searchable.startsWith(query)) prefix.push(entry)
    else if ((chinese && (normalizeQuery(entry.translation).includes(query) || entry.meanings?.some(meaning => normalizeQuery(meaning).includes(query)))) ||
      (!chinese && query.length >= 3 && (searchable.includes(query) || (tokens.length > 1 && tokens.every(token => searchable.split(' ').includes(token)))))) other.push(entry)
  }
  return [...exact, ...aliases, ...prefix, ...other].slice(0, Math.max(0, Math.min(limit, 100)))
}

/** Exact dictionary senses first; a unique lemma may come from existing sourced phrase aliases. */
export function lookupVocabularyEntry(entries:WordEntry[],input:string):WordEntry|null {
  const id=normalizeQuery(input)
  const exact=entries.find(entry=>entry.id===id)
  if(exact) return exact
  const aliases=entries.filter(entry=>entry.forms?.includes(id))
  if(aliases.length===1) return aliases[0]
  if(!/^[a-z]+$/.test(id)) return null
  const roots=new Set<string>()
  for(const phrase of entries) if(phrase.kind==='phrase'&&phrase.forms?.some(form=>form.split(' ')[0]===id)) roots.add(phrase.id.split(' ')[0])
  const words=entries.filter(entry=>entry.kind==='word'&&roots.has(entry.id))
  return words.length===1?words[0]:null
}
