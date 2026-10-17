import { learningKind } from './favorites.ts'
import { contentHash } from '../translation/hash.ts'
import type { DisplayRun } from '../replacement/displayText'
import type { LearningWord, WordEntry } from '../vocabulary/types'
/** Learning IDs can be namespaced; never use the ID as a sentence's display text. */
export function learningEntryForWord(word:DisplayRun,entry:WordEntry|null):LearningWord {
  return {id:word.entryId!,word:entry?.word??word.english??word.entryId!,translation:word.chinese||entry?.translation||word.lookupMeaning||'',phonetic:entry?.phonetic??'',kind:word.sentence?'sentence':learningKind({id:word.entryId!,word:word.english??word.entryId!,kind:entry?.kind})}
}

/** A translated unit has reliable group correspondence, not invented word-to-word alignment. */
export async function contextEntryForWord(word:DisplayRun):Promise<LearningWord|null> {
  if(word.sentence||!word.contextEnglish?.trim()||!word.contextChinese?.trim()) return null
  const english=word.contextEnglish.trim(),chinese=word.contextChinese.trim()
  return {id:`sentence:context:${await contentHash(JSON.stringify([english,chinese]))}`,word:english,translation:chinese,phonetic:'',kind:'sentence'}
}
