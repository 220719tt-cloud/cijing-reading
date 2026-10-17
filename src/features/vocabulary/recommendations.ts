import type { WordEntry } from './types'
// Editorial ordering, not corpus frequency. Only existing entries can be returned.
export const practicalPhrasePriority = [
  'give up', 'give in', 'give away', 'give rise to', 'give a hand', 'give way to',
  'think of', 'think about', 'think over', 'think highly of',
  'figure out', 'carry out', 'look for', 'look after', 'look forward to',
  'come back', 'find out', 'take care of', 'get up', 'turn around',
]
export function relatedPhrases(entries: WordEntry[], input: string): { roots: string[]; phrases: WordEntry[] } {
  const query = input.normalize('NFKC').trim().toLowerCase()
  if (!/^[a-z]+(?:[-'][a-z]+)*$/.test(query)) return { roots: [], phrases: [] }
  const roots = new Set([query])
  const phrases = entries.filter(entry => entry.kind === 'phrase' && !entry.id.startsWith('sentence:'))
  // The existing phrase aliases originate in ECDICT exchange fields. No suffix guessing.
  for (const phrase of phrases) {
    if (phrase.forms?.some(form => form.split(' ')[0] === query)) roots.add(phrase.id.split(' ')[0])
  }
  const priority = new Map(practicalPhrasePriority.map((phrase, index) => [phrase, index]))
  return {
    roots: [...roots],
    phrases: phrases.filter(phrase => phrase.id.split(' ').some(token => roots.has(token)))
      .sort((a, b) => (priority.get(a.id) ?? 1000) - (priority.get(b.id) ?? 1000) ||
        Number(b.difficulty?.includes('common') ?? false) - Number(a.difficulty?.includes('common') ?? false) ||
        a.id.split(' ').length - b.id.split(' ').length || a.id.localeCompare(b.id)),
  }
}
