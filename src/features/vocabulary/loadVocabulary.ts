import manifest from './data/manifest.json'
import lookupUrl from './data/lookup.json?url'
import phrasesUrl from './data/phrases.json?url'
import { mergeVocabulary } from './query'
import { cacheDictionary, readCachedDictionary } from './storage'
import { resolveVocabulary } from './repository'
import type { VocabularyLoad } from './repository'
import type { WordEntry } from './types'
export { default as vocabularyManifest } from './data/manifest.json'
let loading: Promise<VocabularyLoad> | undefined
export function loadVocabulary(): Promise<VocabularyLoad> {
  loading ??= resolveVocabulary(manifest.version, manifest.count, {
    readCache: readCachedDictionary,
    writeCache: cacheDictionary,
    readAsset: async () => {
      const [base, phrases] = await Promise.all([lookupUrl, phrasesUrl].map(async url => {
        const response = await fetch(url)
        if (!response.ok) throw new Error('词库下载失败')
        return await response.json() as WordEntry[]
      }))
      return mergeVocabulary(base, phrases)
    },
  }).catch(error => { loading = undefined; throw error })
  return loading
}
