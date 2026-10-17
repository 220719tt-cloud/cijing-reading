import type { WordEntry } from './types'
export interface VocabularyLoad { entries: WordEntry[]; offlineReady: boolean; warning: string }
interface DictionaryCache { version: string; entries: WordEntry[] }
interface DictionaryAccess {
  readCache: () => Promise<DictionaryCache | undefined>
  readAsset: () => Promise<WordEntry[]>
  writeCache: (version: string, entries: WordEntry[]) => Promise<unknown>
}
/** Cache first: a prepared dictionary can be queried with no network request. */
export async function resolveVocabulary(version: string, count: number, access: DictionaryAccess): Promise<VocabularyLoad> {
  try {
    const cached = await access.readCache()
    if (cached?.version === version && cached.entries.length === count) return { entries: cached.entries, offlineReady: true, warning: '' }
  } catch { /* Restricted storage may still allow querying the bundled asset. */ }
  const entries = await access.readAsset()
  if (!Array.isArray(entries) || entries.length !== count) throw new Error('词库文件不完整，请刷新后重试。')
  try {
    await access.writeCache(version, entries)
    return { entries, offlineReady: true, warning: '' }
  } catch {
    return { entries, offlineReady: false, warning: '词库可查询，但浏览器未能缓存离线数据；请允许网站存储后重新打开页面。' }
  }
}
