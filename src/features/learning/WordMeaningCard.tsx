import { contextEntryForWord, learningEntryForWord } from './cardEntry'
import { lookupVocabularyEntry } from '../vocabulary/query'
import { useEffect, useRef, useState } from 'react'
import type { DisplayRun } from '../replacement/displayText'
import type { LearningWord, WordEntry } from '../vocabulary/types'
import { listFavorites, setFavorite, setMastered } from '../vocabulary/storage'
import { startEnglishSpeech } from './pronunciation'

export function WordMeaningCard({ word, mastered, onMasteryChange, onClose, onLearningChange }: {
  word: DisplayRun; mastered: boolean; onMasteryChange: (id: string, value: boolean) => void; onClose: () => void; onLearningChange?:()=>void;
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [entry, setEntry] = useState<WordEntry | null>(null)
  const [favorite, setFavoriteState] = useState(false)
  const [contextEntry,setContextEntry]=useState<LearningWord|null>(null)
  const [contextFavorite,setContextFavorite]=useState(false)
  const [recordsReady, setRecordsReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lookupNotice, setLookupNotice] = useState('')
  const [speechNotice, setSpeechNotice] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const stopSpeech = useRef<(() => void) | null>(null)
  const id = word.entryId!
  const meaning=word.chinese || entry?.translation.split('\n')[0] || word.lookupMeaning || ''
  const speechAvailable = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined'
  useEffect(() => {
    const element = dialog.current!
    if (!element.open) element.showModal()
    return () => { element.close(); stopSpeech.current?.() }
  }, [])
  useEffect(() => {
    let active = true
    Promise.all([listFavorites(),contextEntryForWord(word)]).then(([records,context]) => {
      if (active) { setFavoriteState(records.some(record => record.id === id)); setContextEntry(context);setContextFavorite(!!context&&records.some(record=>record.id===context.id));setRecordsReady(true) }
    }).catch(() => { if (active) setError('无法读取收藏记录，请关闭卡片后重试。') })
    if (word.sentence) { setLoading(false); return () => { active = false } }
    // Only opening a card loads the query dictionary; the reader itself stays light.
    import('../vocabulary/loadVocabulary').then(module => module.loadVocabulary()).then(result => {
      if (active) setEntry(lookupVocabularyEntry(result.entries, id))
    }).catch(() => { if (active) setLookupNotice(word.chinese || word.lookupMeaning ? '查询词库暂不可用，仍可查看已有的本地释义。' : '查询词库暂不可用，请联网准备词库后重试。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])
  async function toggleFavorite() {
    setBusy(true); setError('')
    try {
      await setFavorite(learningEntryForWord(word,entry), !favorite)
      setFavoriteState(!favorite);onLearningChange?.()
    } catch { setError('收藏保存失败，请检查浏览器本地存储权限后重试。') }
    finally { setBusy(false) }
  }
  async function toggleContextFavorite() {
    if(!contextEntry) return
    setBusy(true);setError('')
    try {await setFavorite(contextEntry,!contextFavorite);setContextFavorite(!contextFavorite);onLearningChange?.()}
    catch {setError('句子收藏保存失败，请检查浏览器本地存储权限后重试。')}
    finally {setBusy(false)}
  }
  async function toggleMastery() {
    setBusy(true); setError('')
    try { await setMastered(id, !mastered, learningEntryForWord(word,entry)); onMasteryChange(id, !mastered);onLearningChange?.() }
    catch { setError('掌握状态保存失败，请检查浏览器本地存储权限后重试。') }
    finally { setBusy(false) }
  }
  function pronounce() {
    setSpeechNotice(''); setSpeaking(true)
    try {
      stopSpeech.current?.()
      stopSpeech.current = startEnglishSpeech(word.english!, {
        synthesis: window.speechSynthesis,
        createUtterance: text => new window.SpeechSynthesisUtterance(text),
      }, setSpeechNotice, () => setSpeaking(false))
    } catch { setSpeaking(false); setSpeechNotice('当前浏览器无法发音，请在其他浏览器或设备上重试。') }
  }
  return <dialog ref={dialog} className="import-dialog meaning-card" aria-labelledby="word-meaning-title"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => {
      event.stopPropagation()
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <div className="section-heading"><p className="eyebrow">故事里的英语</p><button className="text-button" onClick={onClose} aria-label="关闭释义卡片">关闭</button></div>
    <h2 id="word-meaning-title">{word.english}</h2>
    {entry?.phonetic && <p className="word-phonetic">{entry.word !== word.english ? `原形 ${entry.word} ` : ''}/{entry.phonetic}/</p>}
    {word.sentence && <p className="micro">本项目原创句型 · 完整句匹配，不进行逐词拼接</p>}
    <p className="context-meaning"><span>{word.sentence ? '中文原句' : word.chinese ? '本句含义' : entry ? '本地词库释义' : word.lookupMeaning ? '本地替换词库释义' : '本地词库释义'}</span>{meaning || (loading ? '正在查询…' : '本地词库暂未查到此词或词形，暂时没有可用释义。')}</p>
    {word.contextChinese && !word.sentence && <details className="dictionary-meanings"><summary>对应中文原句</summary><p>{word.contextChinese}</p></details>}
    {entry && <details className="dictionary-meanings"><summary>更多词典释义</summary><p>{entry.translation}</p></details>}
    {contextEntry&&<details className="dictionary-meanings"><summary>对应英文句子／句组</summary><p>{contextEntry.word}</p><p>{contextEntry.translation}</p><button className="mastery-button" disabled={busy||!recordsReady} aria-pressed={contextFavorite} onClick={()=>void toggleContextFavorite()}>{contextFavorite?'已收藏句子／句组 · 取消收藏':'收藏完整句子／句组'}</button></details>}
    {loading && <p className="micro" role="status">正在查询本地音标与释义…</p>}
    {lookupNotice && <p className="micro" role="status">{lookupNotice}</p>}
    <button className="pronounce-button" disabled={!speechAvailable || speaking} onClick={pronounce}>{speaking ? '正在发音…' : '♫ 发音'}</button>
    {!speechAvailable && <p className="micro">此浏览器不支持系统发音，中文释义仍可使用。</p>}
    {speechNotice && <p className="micro" role="status">{speechNotice}</p>}
    <div className="word-learning-actions">
      <button aria-pressed={favorite} disabled={busy || !recordsReady || !meaning} onClick={() => void toggleFavorite()}>{favorite ? '已收藏 · 取消收藏' : '收藏'}</button>
      <button aria-pressed={mastered} disabled={busy || !meaning} onClick={() => void toggleMastery()}>{mastered ? '已掌握 · 点击取消' : '标记已掌握'}</button>
    </div>
    {busy && <p role="status" className="micro">正在保存…</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
  </dialog>
}
