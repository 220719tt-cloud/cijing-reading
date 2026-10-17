import { SentenceLibrary } from '../features/sentences/SentenceLibrary'
import { useEffect, useMemo, useState } from 'react'
import { filterLearningEntries, learningKind, learningKindLabels, withLearningEntries } from '../features/learning/favorites'
import type { FavoriteRecord, LearningKind, LearningWord, WordEntry } from '../features/vocabulary/types'
import { loadVocabulary, vocabularyManifest } from '../features/vocabulary/loadVocabulary'
import { listFavorites, setFavorite, listMastery, setMastered } from '../features/vocabulary/storage'
import { relatedPhrases } from '../features/vocabulary/recommendations'
import { queryVocabulary } from '../features/vocabulary/query'

const phraseTypes: Record<string, string> = { 'verb-phrase': '动词短语', 'prepositional-phrase': '介词短语', 'fixed-expression': '固定表达' }
const sourceLabels: Record<string, string> = { ecdict: 'ECDICT', 'english-phrases': '2ndLA/english-phrases', 'cc-cedict': 'CC-CEDICT' }
const tagLabels: Record<string, string> = { zk: '基础', gk: '高中', cet4: '四级', cet6: '六级', ky: '考研' }
export function VocabularyPage() {
  const [entries, setEntries] = useState<WordEntry[]>([])
  const [query, setQuery] = useState('')
  const [showSentences,setShowSentences]=useState(false)
  const [recordsLoading,setRecordsLoading]=useState(true)
  const [dictionaryLoading,setDictionaryLoading]=useState(true)
  const [recordsReady,setRecordsReady]=useState(false)
  const [dictionaryError,setDictionaryError]=useState('')
  const [mode,setMode]=useState<'favorites'|'mastered'|'dictionary'>('favorites')
  const [kind,setKind]=useState<LearningKind|'all'>('all')
  const [limit,setLimit]=useState(30)
  const loading=recordsLoading||(mode==='dictionary'&&dictionaryLoading)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [offline, setOffline] = useState(false)
  const [mastered, setMastery] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [relatedLimit, setRelatedLimit] = useState(6)
  const [recordsRevision,setRecordsRevision]=useState(0)
  const [favorites, setFavorites] = useState<FavoriteRecord[]>([])
  const [learnedWords, setLearnedWords] = useState<LearningWord[]>([])
  useEffect(()=>{setLimit(30);setRelatedLimit(6)},[query,mode,kind])
  useEffect(() => {
    let active = true
    setRecordsLoading(true);setRecordsReady(false);setError('');setWarning('')
    // Personal records become available without waiting for a dictionary download.
    Promise.allSettled([listMastery(),listFavorites()]).then(([mastery,favorites])=>{
      if(!active) return
      const warnings:string[]=[]
      if(mastery.status==='fulfilled') {
        setMastery(new Set(mastery.value.filter(record=>record.mastered).map(record=>record.id)))
        setLearnedWords(mastery.value.filter(record=>record.mastered&&record.entry).map(record=>record.entry!))
      } else warnings.push('无法读取掌握记录，请检查浏览器存储权限后重试。')
      if(favorites.status==='fulfilled') setFavorites(favorites.value)
      else warnings.push('无法读取收藏记录，请检查浏览器存储权限后重试。')
      setWarning(warnings.join(' '));setRecordsReady(mastery.status==='fulfilled'&&favorites.status==='fulfilled');setRecordsLoading(false)
    })
    return () => { active = false }
  }, [retry,recordsRevision])
  useEffect(()=>{
    let active=true;setDictionaryLoading(true);setDictionaryError('')
    loadVocabulary().then(dictionary=>{
      if(!active) return
      setEntries(dictionary.entries);setOffline(dictionary.offlineReady)
      if(dictionary.warning)setDictionaryError(dictionary.warning)
    }).catch(()=>{if(active)setDictionaryError('查询词库暂不可用，已保存的收藏和中文释义仍可查看。')}).finally(()=>{if(active)setDictionaryLoading(false)})
    return () => { active = false }
  }, [retry])
  const available = useMemo(() => {
    if(mode==='favorites') return withLearningEntries([], [...favorites].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))
    if(mode==='mastered') {
      const summaries=[...learnedWords,...favorites.filter(entry=>mastered.has(entry.id))]
      const knownIds=new Set(summaries.map(entry=>entry.id))
      return withLearningEntries([], [...summaries,...entries.filter(entry=>mastered.has(entry.id)&&!knownIds.has(entry.id))])
    }
    return withLearningEntries(entries,[...favorites,...learnedWords])
  }, [entries,favorites,learnedWords,mastered,mode])
  const typeCounts=useMemo(()=>({all:available.length,word:available.filter(entry=>learningKind(entry)==='word').length,phrase:available.filter(entry=>learningKind(entry)==='phrase').length,sentence:available.filter(entry=>learningKind(entry)==='sentence').length}),[available])
  const typed=useMemo(()=>filterLearningEntries(available,'',kind),[available,kind])
  const related = useMemo(() => relatedPhrases(mode==='dictionary'&&(kind==='all'||kind==='word')?available:[],query),[available,query,mode,kind])
  const matched=useMemo(()=>mode==='dictionary' ? query.trim()?queryVocabulary(typed,query,100).filter(entry=>!related.phrases.length||entry.kind==='word'||learningKind(entry)==='sentence'):[] : filterLearningEntries(typed,query,'all'),[mode,typed,query,related])
  const results=matched.slice(0,limit)
  async function toggleFavorite(entry: WordEntry) {
    setBusy(entry.id); setError('')
    const next = !favorites.some(item => item.id === entry.id)
    const record = { id: entry.id, word: entry.word, translation: entry.translation, phonetic: entry.phonetic,kind:learningKind(entry) }
    try {
      await setFavorite(record, next)
      setFavorites(previous => next ? [...previous, { ...record, createdAt: new Date().toISOString() }] : previous.filter(item => item.id !== entry.id))
    } catch { setError('收藏保存失败，请检查浏览器存储权限后重试。') }
    finally { setBusy(null) }
  }
  async function toggleMastery(entry: WordEntry) {
    setBusy(entry.id); setError('')
    const next = !mastered.has(entry.id)
    try {
      await setMastered(entry.id, next, { id: entry.id, word: entry.word, translation: entry.translation, phonetic: entry.phonetic,kind:learningKind(entry) })
      setLearnedWords(previous => next ? [...previous.filter(item => item.id !== entry.id), entry] : previous.filter(item => item.id !== entry.id))
      setMastery(previous => { const updated = new Set(previous); if (next) updated.add(entry.id); else updated.delete(entry.id); return updated })
    } catch { setError('掌握状态保存失败，请检查浏览器存储权限后重试。') }
    finally { setBusy(null) }
  }
  return <section className="vocabulary-page" aria-labelledby="vocabulary-title">
    <p className="eyebrow">让词语回到故事里</p><h1 id="vocabulary-title">生词本</h1>
    <p className="muted">{mode==='dictionary'?`${vocabularyManifest.count.toLocaleString()} 个精选词条 · 含 ${vocabularyManifest.phrases.toLocaleString()} 条短语`:'收藏阅读中的单词、短语与句子'}</p>
    <div className="learning-tabs" role="group" aria-label="学习记录视图">{([['favorites',`我的收藏（${favorites.length}）`],['mastered',`已掌握（${mastered.size}）`],['dictionary','词库查询']] as const).map(([value,label])=><button key={value} aria-pressed={mode===value} onClick={()=>setMode(value)}>{label}</button>)}</div>
    <label className="field-label">搜索英文或中文<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={mode==='dictionary'?'查单词、短语或中文释义':'搜索收藏的单词、短语或句子'} autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={loading} /></label>
    <div className="learning-types" role="group" aria-label="内容类型">{(['all','word','phrase','sentence'] as const).map(value=><button key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{value==='all'?'全部':learningKindLabels[value]} <span>{typeCounts[value]}</span></button>)}</div>
    {loading&&<p role="status" className="muted">{mode==='dictionary'?'正在准备本地词库…':'正在读取学习记录…'}</p>}
    {error&&<p className="error-message" role="alert">{error}</p>}
    {warning&&<div className="error-message" role="alert">{warning}<button className="text-button" onClick={()=>setRetry(value=>value+1)}>重试读取记录</button></div>}
    {mode==='dictionary'&&dictionaryError&&<div className="muted" role="status">{dictionaryError}<button className="text-button" onClick={()=>setRetry(value=>value+1)}>重试词库</button></div>}
    {!loading&&mode==='dictionary'&&!query.trim()&&<div className="query-welcome"><p>从一个故事里的词开始。</p><div>{['secret','courage','conspiracy','in the end'].map(word=><button key={word} className="word-suggestion" onClick={()=>setQuery(word)}>{word}</button>)}</div></div>}
    {!loading&&(mode!=='dictionary'||query.trim())&&<p className="muted" role="status">{matched.length?`显示 ${results.length} / ${matched.length} 项${mode==='dictionary'?'（查询最多 100 项）':''}`:available.length||query.trim()?'没有符合条件的内容。':mode==='favorites'?'还没有收藏。在阅读时点击英文即可收藏单词、短语或完整句子。':mastered.size?'掌握状态已保存；部分旧记录需要词库加载后显示释义。':'还没有已掌握记录。“已掌握”由你主动决定。'}</p>}
    <div className="vocabulary-results">{results.map(entry => <article key={entry.id} className="word-card"><div className="word-card-heading"><h2>{learningKind(entry)==='sentence'&&entry.word.length>160?`${entry.word.slice(0,120)}…`:entry.word}</h2><span className="micro">{learningKindLabels[learningKind(entry)]}</span></div>{learningKind(entry)==='sentence'&&(entry.word.length>160||entry.translation.length>140)?<details className="dictionary-meanings"><summary>查看完整英文与中文原文</summary><p>{entry.word}</p><p>{entry.translation}</p></details>:<>{entry.phonetic && <p className="word-phonetic">/{entry.phonetic}/</p>}{entry.kind === 'phrase' && entry.meanings?.length ? <ul className="phrase-meanings">{entry.meanings.map(meaning => <li key={meaning}>{meaning}</li>)}</ul> : <p className="word-translation">{entry.translation}</p>}</>}
      {entry.kind === 'phrase' && !!entry.sources?.length && <p className="phrase-details">{phraseTypes[entry.phraseType ?? ''] ?? '短语'} · {entry.difficulty?.includes('common') ? '常见表达' : '学习拓展'}<br />来源：{entry.sources?.map(source => sourceLabels[source] ?? source).join('、')}</p>}<div className="word-tags">{entry.tags.filter(tag => ['cet4','cet6','ky'].includes(tag)).map(tag => <span key={tag}>{tagLabels[tag]}</span>)}</div><button className="mastery-button favorite-button" disabled={busy !== null || !recordsReady} aria-pressed={favorites.some(item => item.id === entry.id)} onClick={() => void toggleFavorite(entry)}>{favorites.some(item => item.id === entry.id) ? '已收藏 · 取消收藏' : '收藏'}</button><button className="mastery-button" disabled={busy !== null || !recordsReady} aria-pressed={mastered.has(entry.id)} onClick={() => void toggleMastery(entry)}>{busy === entry.id ? '正在保存…' : mastered.has(entry.id) ? '已掌握 · 点击取消' : '标记已掌握'}</button>
      {entry === results[0] && related.phrases.length > 0 && <section className="related-phrases" aria-label="常见短语"><h3>常见短语</h3><p className="micro">{related.roots.length > 1 ? `按词形关联：${related.roots.slice(1).join('、')} · ` : ''}按实用优先级整理，非词频排名</p><ul>{related.phrases.slice(0, relatedLimit).map(phrase => <li key={phrase.id}><button onClick={() => setQuery(phrase.word)}><strong>{phrase.word}</strong><span>{phrase.meanings?.slice(0, 3).join('；') || phrase.translation.split('\n')[0]}</span></button></li>)}</ul>{relatedLimit < related.phrases.length && <button className="text-button" onClick={() => setRelatedLimit(value => value + 8)}>查看更多短语（共 {related.phrases.length} 条）</button>}</section>}
      </article>)}</div>
    {results.length<matched.length&&<button className="text-button" onClick={()=>setLimit(value=>value+30)}>查看更多（剩余 {matched.length-results.length} 项）</button>}
    <p className="micro">学习记录保存在当前浏览器。刷新或正常关闭页面会保留；清理网站数据或系统回收可能丢失，请使用同一网址和浏览器。</p>
    {mode==='dictionary'&&<p className="micro">{offline?'词库已缓存，可离线查询':'查询词库按需准备'}</p>}
    <details className="sentence-library-disclosure" onToggle={event=>setShowSentences(event.currentTarget.open)}><summary>常见句型库 · 200 条 · 查看与收藏</summary>{showSentences&&<SentenceLibrary onLearningChange={()=>setRecordsRevision(value=>value+1)} />}</details>
    <p className="vocabulary-source muted">单词释义：ECDICT（MIT）。短语来源与许可见下方说明；六级／考研标签来自社区学习名单，并非官方大纲认证。小说替换规则独立管理。</p>
    <a className="text-button" href={`${import.meta.env.BASE_URL}licenses/ECDICT-MIT.txt`} target="_blank" rel="noreferrer">查看数据许可</a>
    <a className="text-button" href={`${import.meta.env.BASE_URL}licenses/PHRASE-NOTICE.txt`} target="_blank" rel="noreferrer">查看短语来源与许可</a>
  </section>
}
