export const backgrounds = [
  { id: 'white', name: '白色', bg: '#ffffff', text: '#292d2b', muted: '#67716b' },
  { id: 'cream', name: '米黄色', bg: '#f5efdc', text: '#393b30', muted: '#74715e' },
  { id: 'green', name: '浅绿色', bg: '#e5efdf', text: '#2e4033', muted: '#61745f' },
  { id: 'blue', name: '浅蓝色', bg: '#e3edf5', text: '#2e3d4a', muted: '#627688' },
  { id: 'gray', name: '深灰色', bg: '#292d30', text: '#e3e5e4', muted: '#acb3b0' },
  { id: 'black', name: '黑色', bg: '#101312', text: '#d7dfd8', muted: '#a0aea3' },
] as const
export type Background = typeof backgrounds[number]['id']
export type PageMode = 'cover' | 'slide' | 'scroll' | 'none'
export interface ReaderPreferences { background: Background; mode: PageMode; english: number; lastLight: Background; chineseHints: boolean }
export function normalizePreferences(value: unknown, dark = false): ReaderPreferences {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<ReaderPreferences>
  return {
    background: backgrounds.some(item => item.id === input.background) ? input.background! : dark ? 'black' : 'cream',
    mode: ['cover', 'slide', 'scroll', 'none'].includes(input.mode ?? '') ? input.mode! : 'cover',
    chineseHints: input.chineseHints === true,
    english: [0, 20, 40, 60, 80, 100].includes(input.english ?? -1) ? input.english! : 0,
    lastLight: ['white', 'cream', 'green', 'blue'].includes(input.lastLight ?? '') ? input.lastLight! : 'cream',
  }
}
export function loadPreferences(dark = false) {
  try { return normalizePreferences(JSON.parse(localStorage.getItem('cijing-reader-preferences') ?? 'null'), dark) }
  catch { return normalizePreferences(null, dark) }
}
export const englishDescriptions = ['完全中文原文', '中文为主，英文词组、短句与少量整句', '英文短语与完整句子', '中英文句子混合，以英文为主', '大部分英文，少量中文辅助', '完整英文译文']
