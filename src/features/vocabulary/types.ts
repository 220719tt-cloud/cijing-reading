export type LearningKind = 'word' | 'phrase' | 'sentence'
export interface WordEntry {
  /** Personal learning metadata, independent of the query dictionary kind. */
  learningKind?: LearningKind
  id: string
  word: string
  phonetic: string
  translation: string
  tags: string[]
  kind: 'word' | 'phrase'
  /** Query metadata only; never used as a Chinese-text replacement rule. */
  meanings?: string[]
  difficulty?: ('common' | 'cet6' | 'postgraduate')[]
  phraseType?: 'verb-phrase' | 'prepositional-phrase' | 'fixed-expression'
  category?: 'common-verb' | 'cet6' | 'postgraduate' | 'daily-reading'
  sources?: string[]
  sourceEntries?: Record<string, string | string[]>
  forms?: string[]
  editorialNote?: string
}
export type LearningWord = Pick<WordEntry, 'id' | 'word' | 'translation' | 'phonetic'> & { kind?: LearningKind }
export interface MasteryRecord { id: string; mastered: boolean; updatedAt: string; entry?: LearningWord }
export interface ReplacementCandidate {
  id: string; chinese: string; entryId: string; english: string; partOfSpeech: string;
  context: string; exclude: string; status: 'candidate'; enabled: false; sourceMeaning: string;
}

export interface FavoriteRecord extends LearningWord { createdAt: string }
