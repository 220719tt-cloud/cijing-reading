import sentenceEntries from '../features/sentences/data/sentences.json'
import type { SentenceEntry } from '../features/sentences/library'
import { applySentenceLibrary } from '../features/sentences/display'
import { displayFingerprint, displayOffsetForPosition, positionForDisplay } from '../features/translation/position'
import { TranslationPanel } from '../features/translation/TranslationPanel'
import { buildBilingualDisplay } from '../features/translation/display'
import { readChapterTranslation, translationError } from '../features/translation/storage'
import type { ChapterTranslation } from '../features/translation/types'
import { withOriginalEnglishLookup } from '../features/replacement/originalEnglish'
import { ChapterContent } from '../features/reading/ChapterContent'
import { useResourceUrls } from '../features/reading/resourceUrls'
import { indexTextNodes } from '../features/reading/textNodes'
import { inReadingBand, readerGesture, readerTargetBlocked, readingTapZone } from '../features/reading/readerGesture'
import type { ReaderPointer } from '../features/reading/readerGesture'
import { WordMeaningCard } from '../features/learning/WordMeaningCard'
import type { DisplayRun } from '../features/replacement/displayText'
import { buildDisplayText, displayToSource, sourceToDisplay } from '../features/replacement/displayText'
import replacementRules from '../features/replacement/data/rules.json'
import { listMastery } from '../features/vocabulary/storage'
import { animateSafely, matchesPreference, observeElementSize } from '../shared/browser/compatibility'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReadingPosition } from '../features/reading/readingPosition'
import type { Book, BookTocEntry } from '../shared/types/book'
import { chapterText, loadFontSize, loadPosition, offsetToPosition, pageForOffset, positionToOffset } from '../features/reading/readingPosition'
import { measurePageStarts } from '../features/reading/paginate'
import type { CSSProperties } from 'react'
import { backgrounds, englishDescriptions, loadPreferences } from '../features/reading/readerPreferences'
import type { PageMode } from '../features/reading/readerPreferences'
import { Icon } from '../shared/components/Icon'

const lookupGlosses = new Map<string,string>()
for (const rule of replacementRules) for (const english of [rule.english, ...(rule.plural ? [rule.plural] : [])]) {
  const key = english.toLowerCase()
  lookupGlosses.set(key, [...new Set([...(lookupGlosses.get(key)?.split('；') ?? []), rule.chinese])].join('；'))
}

export function ReaderPage({ book, theme }: { book: Book; theme: 'light' | 'dark' }) {
  const [position, setPosition] = useState(() => loadPosition(book.id, book.chapters))
  const [fontSize, setFontSize] = useState(loadFontSize)
  const [toolbar, setToolbar] = useState(true)
  const [panel, setPanel] = useState<'settings' | 'english' | 'chapters' | null>(null)
  const [preferences, setPreferences] = useState(() => loadPreferences(theme === 'dark'))
  const scrolling = preferences.mode === 'scroll'
  const [selectedWord, setSelectedWord] = useState<DisplayRun | null>(null)
  const [translationOpen, setTranslationOpen] = useState(false)
  const settings = panel !== null || selectedWord !== null || translationOpen
  const background = backgrounds.find(item => item.id === preferences.background)!
  const animations = useRef<Animation[]>([])
  const scrollFrame = useRef(0)
  const restoring = useRef(false)
  const [storageWarning, setStorageWarning] = useState('')
  const [layout, setLayout] = useState({ width: 0, height: 0 })
  const [starts, setStarts] = useState([0])
  const [page, setPage] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  const columns = useRef<HTMLDivElement>(null)
  const settingsDialog = useRef<HTMLDialogElement>(null)
  const pointer = useRef<ReaderPointer | null>(null)
  const chapterIndex = Math.max(0, book.chapters.findIndex(item => item.id === position.chapterId))
  const chapter = book.chapters[chapterIndex]
  const source = chapterText(chapter)
  const resources=useMemo(()=>book.resources?.filter(resource=>chapter.blocks?.some(block=>block.resourceId===resource.id)),[book.resources,chapter])
  const resourceUrls=useResourceUrls(resources)
  const [imageLayout,setImageLayout]=useState(0)
  const [mastered, setMastered] = useState<ReadonlySet<string>>(new Set())
  const replacementDisplay = useMemo(() => buildDisplayText(source, replacementRules, { concentration: preferences.english, seed: `${book.id}:${chapter.id}`, titles: [book.title, chapter.title, ...(chapter.blocks?.filter(block=>block.kind==='heading').map(block=>block.text)??[])], mastered, showChineseHints: preferences.chineseHints }), [source, preferences.english, preferences.chineseHints, book.id, book.title, chapter, mastered])
  const [translation, setTranslation] = useState<ChapterTranslation>()
  const [translationLoading, setTranslationLoading] = useState(true)
  const [translationReadError, setTranslationReadError] = useState('')
  const [translationRevision, setTranslationRevision] = useState(0)
  useEffect(() => {
    let active = true
    setTranslationLoading(true); setTranslationReadError('')
    readChapterTranslation(book, chapter).then(value => { if (active) setTranslation(value) })
      .catch(error => { if (active) { setTranslation(undefined); setTranslationReadError(translationError(error)) } })
      .finally(() => { if (active) setTranslationLoading(false) })
    return () => { active = false }
  }, [book, chapter, translationRevision])
  const bilingual = useMemo(() => buildBilingualDisplay(chapter, replacementDisplay, translation?.chapterId === chapter.id ? translation : undefined, preferences.english, `${book.id}:${chapter.id}`), [chapter, replacementDisplay, translation, preferences.english, book.id])
  const sentences = useMemo(() => applySentenceLibrary(chapter, bilingual.model, sentenceEntries as SentenceEntry[], { concentration: preferences.english, seed: `${book.id}:${chapter.id}`, titles: [book.title, chapter.title] }), [chapter, bilingual, preferences.english, book.id, book.title])
  const display = useMemo(() => book.source === 'epub' || bilingual.translated > 0 ? withOriginalEnglishLookup(sentences.model, replacementRules.flatMap(rule => [rule.english, ...(rule.plural ? [rule.plural] : [])]), lookupGlosses) : sentences.model, [sentences, bilingual.translated, book.source])
  const translationMessage = translationLoading ? '正在读取本章本地译文…' : translationReadError ? `译文读取失败：${translationReadError} 当前不使用未验证的译文。` : preferences.english === 40 && sentences.replaced > 0 && !bilingual.available ? '本章暂无导入译文；当前使用本地词语、短语和整句库。导入章节译文可覆盖更多表达。' : preferences.english === 20 && sentences.replaced > 0 ? '中文为主，使用本地词语、短语和整句匹配。' : bilingual.message
  const sentenceMessage = [20,40].includes(preferences.english) ? `本地句型：匹配 ${sentences.eligible} 处，显示 ${sentences.replaced} 个完整英文句子。只使用整句精确匹配，不猜测相似句。` : ''
  const fingerprint = useMemo(() => displayFingerprint(display), [display])
  const text = display.text
  useEffect(() => {
    let active = true
    listMastery().then(records => { if (active) setMastered(new Set(records.filter(record => record.mastered).map(record => record.id))) }).catch(() => { /* Without records, only the first selected word per chapter gets a hint. */ })
    return () => { active = false }
  }, [book.id])
  const anchor = useRef(position)
  anchor.current = position
  const gap = 32

  useLayoutEffect(() => {
    const element = viewport.current!
    return observeElementSize(element, setLayout)
  }, [])
  useLayoutEffect(() => {
    const element = columns.current
    if (!element || !layout.width || !layout.height) return
    animations.current.forEach(animation => animation.cancel())
    element.style.transform = 'none'
    if (scrolling) {
      const offset = Math.min(text.length - 1, displayOffsetForPosition(chapter, display, anchor.current, fingerprint))
      const rect = indexTextNodes(element).rect(offset)
      if (rect && offset >= 0) {
        restoring.current = true
        viewport.current!.scrollTop += rect.top - viewport.current!.getBoundingClientRect().top
        requestAnimationFrame(() => { restoring.current = false })
      }
      return
    }
    viewport.current!.scrollTop = 0
    const nextStarts = measurePageStarts(element, layout.width, gap)
    const nextPage = pageForOffset(nextStarts, displayOffsetForPosition(chapter, display, anchor.current, fingerprint))
    setStarts(nextStarts); setPage(nextPage)
    element.style.transform = `translateX(${-nextPage * (layout.width + gap)}px)`
  }, [text, display, fingerprint, chapter, layout, fontSize, scrolling, imageLayout, resourceUrls])
  useEffect(() => {
    try { localStorage.setItem(`cijing-position:${book.id}`, JSON.stringify(position)) }
    catch { setStorageWarning('浏览器无法保存阅读位置，本次仍可正常阅读。') }
  }, [book.id, position])
  useEffect(() => {
    try { localStorage.setItem('cijing-font-size', String(fontSize)) }
    catch { setStorageWarning('浏览器无法保存字体设置，本次调整仍有效。') }
  }, [fontSize])
  useEffect(() => { if (panel) settingsDialog.current?.showModal() }, [panel])
  useEffect(() => {
    try { localStorage.setItem('cijing-reader-preferences', JSON.stringify(preferences)) }
    catch { setStorageWarning('浏览器无法保存阅读设置，本次调整仍有效。') }
  }, [preferences])
  useEffect(() => () => { cancelAnimationFrame(scrollFrame.current); animations.current.forEach(animation => animation.cancel()) }, [])
  function captureScroll() {
    if (!scrolling || restoring.current || !columns.current?.firstChild) return
    const index = indexTextNodes(columns.current)
    const top = viewport.current!.getBoundingClientRect().top
    let low = 0, high = text.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      const rect = index.rect(middle)!
      if (rect.bottom <= top + 1) low = middle + 1
      else high = middle
    }
    setPosition(positionForDisplay(chapter, display, low, fingerprint))
  }
  function animatePage(next: number, direction: number) {
    const element = columns.current!
    animations.current.forEach(animation => animation.cancel())
    if (matchesPreference('(prefers-reduced-motion: reduce)')) return
    if (preferences.mode === 'slide') {
      const animation = animateSafely(element, [{ transform: `translateX(${-page * (layout.width + gap)}px)` }, { transform: `translateX(${-next * (layout.width + gap)}px)` }], { duration: 230, easing: 'ease-out' })
      animations.current = animation ? [animation] : []
    } else if (preferences.mode === 'cover') {
      const overlay = document.createElement('div')
      overlay.className = 'cover-animation'
      overlay.setAttribute('aria-hidden', 'true')
      const clone = element.cloneNode(true) as HTMLDivElement
      clone.querySelectorAll('[tabindex]').forEach(element => element.setAttribute('tabindex', '-1'))
      overlay.inert = true
      overlay.appendChild(clone); viewport.current!.appendChild(overlay)
      const animation = animateSafely(overlay, [{ transform: 'translateX(0)' }, { transform: `translateX(${-direction * 100}%)` }], { duration: 230, easing: 'ease-out' })
      if (!animation) { overlay.remove(); animations.current = []; return }
      animation.onfinish = animation.oncancel = () => overlay.remove()
      animations.current = [animation]
    }
  }
  function goChapter(index: number) {
    if (!book.chapters[index]) return
    setPosition(offsetToPosition(book.chapters[index], 0)); setPanel(null)
    if (index === chapterIndex) seek(0)
  }
  function seek(percent: number) {
    const originalOffset = Math.min(Math.max(0, source.length - 1), Math.round(source.length * percent / 100))
    const offset = sourceToDisplay(display, originalOffset)
    setPosition(offsetToPosition(chapter, originalOffset))
    if (scrolling && columns.current?.firstChild) {
      const rect = indexTextNodes(columns.current).rect(offset)
      if (rect) viewport.current!.scrollTop += rect.top - viewport.current!.getBoundingClientRect().top
    } else setPage(pageForOffset(starts, offset))
  }
  function goToToc(entry: BookTocEntry) {
    const target:ReadingPosition={chapterId:entry.chapterId,paragraph:entry.paragraph,offset:entry.offset}
    setPosition(target);setPanel(null)
    if(target.chapterId!==chapter.id) return
    const offset=sourceToDisplay(display,positionToOffset(chapter,target))
    if(scrolling && columns.current) {
      const rect=indexTextNodes(columns.current).rect(offset)
      if(rect) viewport.current!.scrollTop+=rect.top-viewport.current!.getBoundingClientRect().top
    } else setPage(pageForOffset(starts,offset))
  }
  function changeMode(mode: PageMode) { if (scrolling) captureScroll(); setPreferences(value => ({ ...value, mode })) }


  function turn(direction: number) {
    if (scrolling) {
      const view = viewport.current!
      if ((direction > 0 && view.scrollTop + view.clientHeight < view.scrollHeight - 2) || (direction < 0 && view.scrollTop > 2)) { view.scrollBy({ top: direction * view.clientHeight * .85 }); return }
      const adjacent = book.chapters[chapterIndex + direction]
      if (adjacent) setPosition(offsetToPosition(adjacent, direction > 0 ? 0 : Math.max(0, chapterText(adjacent).length - 1)))
      return
    }
    const next = page + direction
    if (next >= 0 && next < starts.length) {
      animatePage(next, direction); setPage(next); setPosition(positionForDisplay(chapter, display, starts[next], fingerprint)); return
    }
    const nextChapter = book.chapters[chapterIndex + direction]
    if (nextChapter) setPosition(offsetToPosition(nextChapter, direction > 0 ? 0 : Math.max(0, chapterText(nextChapter).length - 1)))
  }
  const atStart = chapterIndex === 0 && (scrolling ? positionToOffset(chapter, position) === 0 : page === 0)
  const atEnd = chapterIndex === book.chapters.length - 1 && (scrolling ? (viewport.current ? viewport.current.scrollTop + viewport.current.clientHeight >= viewport.current.scrollHeight - 2 : false) : page === starts.length - 1)
  const lengths = useMemo(() => book.chapters.map(item => item.paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0) + Math.max(0, item.paragraphs.length - 1) * 2), [book])
  const total = lengths.reduce((sum, length) => sum + length, 0)
  const before = lengths.slice(0, chapterIndex).reduce((sum, length) => sum + length, 0)
  const progress = total ? Math.min(100, Math.round((before + (scrolling ? positionToOffset(chapter, position) : displayToSource(display, starts[page + 1] ?? text.length))) / total * 100)) : 100
  return <div className="reader-gesture-surface" onPointerDown={event => {
    pointer.current = null
    if (!event.isPrimary || event.button !== 0 || settings) return
    const rect = viewport.current?.getBoundingClientRect()
    const target = event.target as Element
    if (!rect || !inReadingBand(event.clientY,rect.top,rect.bottom) || readerTargetBlocked(target)) return
    viewport.current?.focus({ preventScroll:true })
    const word = target.closest('[data-word-start]')
    pointer.current = { x:event.clientX,y:event.clientY,time:Date.now(),wordStart:word?Number(word.getAttribute('data-word-start')):undefined }
    if (!scrolling && typeof event.currentTarget.setPointerCapture === 'function') {
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Released or cancelled pointer. */ }
    }
  }} onPointerCancel={() => { pointer.current = null }} onLostPointerCapture={() => { pointer.current = null }} onPointerUp={event => {
    const start=pointer.current;pointer.current=null
    if (!start || settings) return
    const rect=viewport.current?.getBoundingClientRect()
    const target=document.elementFromPoint(event.clientX,event.clientY)
    if (!rect || !inReadingBand(event.clientY,rect.top,rect.bottom) || readerTargetBlocked(target)) return
    const gesture=readerGesture(start,{x:event.clientX,y:event.clientY,time:Date.now()},scrolling)
    if (gesture==='ignore') return
    if (gesture==='next'||gesture==='previous') { turn(gesture==='next'?1:-1);return }
    const endWord=target?.closest('[data-word-start]')
    const wordStart=start.wordStart??(endWord?Number(endWord.getAttribute('data-word-start')):undefined)
    if (wordStart!==undefined) { setSelectedWord(display.runs.find(run=>(run.replacement||run.lookup)&&run.displayStart===wordStart)??null);return }
    const bounds=event.currentTarget.getBoundingClientRect()
    const zone=readingTapZone(event.clientX,bounds.left,bounds.width,scrolling)
    if(zone==='previous'||zone==='next') turn(zone==='next'?1:-1)
    else if(zone==='toolbar') setToolbar(value=>!value)
  }}><article className="paged-reader" style={{ '--reading-image-height': `${Math.max(120,layout.height*.75)}px`, '--bg': background.bg, '--surface': background.bg, '--text': background.text, '--muted': background.muted, '--accent': background.text, '--line': `${background.muted}55`, '--nav': background.bg, color: background.text, colorScheme: ['gray', 'black'].includes(background.id) ? 'dark' : 'light' } as CSSProperties} onKeyDown={event => {
    if (settings || event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return
    if (event.key === 'ArrowRight') { event.preventDefault(); turn(1) }
    if (event.key === 'ArrowLeft') { event.preventDefault(); turn(-1) }
  }}>
    <header className={`reading-toolbar ${toolbar ? '' : 'toolbar-hidden'}`}>
      <a href="#/books" className="back-link"><Icon name="back" size={20} />书架</a>
      <span className="reading-book-title">{book.title}</span>
      <button className="text-button" onClick={() => setPanel('settings')} aria-label="阅读设置">Aa</button>
    </header>
    <div className="reading-chapter-title">{preferences.english >= 60 && <span className="translation-status" role="status">{translationLoading ? '正在读取本章译文' : translationReadError ? '译文读取失败 · 当前为原文' : bilingual.badge} · </span>}{chapter.title}</div>
    <div ref={viewport} className={`page-viewport ${scrolling ? 'scroll-viewport' : ''}`} onScroll={() => { cancelAnimationFrame(scrollFrame.current); scrollFrame.current = requestAnimationFrame(captureScroll) }} tabIndex={0} aria-label="小说正文，屏幕左侧20%上一页，右侧20%下一页，中间切换工具栏；支持滑动与方向键">
      <div ref={columns} className={`page-columns ${scrolling ? 'scroll-content' : ''}`} style={{ width: layout.width || '100%', height: scrolling ? 'auto' : Math.floor(layout.height / (fontSize * 1.85)) * fontSize * 1.85 || '100%', fontSize, lineHeight: 1.85, columnWidth: scrolling ? 'auto' : layout.width || undefined, columnGap: gap, transform: scrolling ? 'none' : `translateX(${-page * (layout.width + gap)}px)` }}><ChapterContent chapter={chapter} display={display} urls={resourceUrls} pageStart={starts[page]??0} pageEnd={starts[page+1]??text.length} scrolling={scrolling} onWord={setSelectedWord} onImageLayout={()=>setImageLayout(value=>value+1)} /></div>
    </div>
    <footer className="reading-page-footer">
      <button className="text-button" aria-label="上一页" disabled={atStart} onClick={() => turn(-1)}>‹</button>
      <span role="status">{scrolling ? '上下滚动' : `本章 ${page + 1} / ${starts.length} 页`} · 全书 {atEnd ? 100 : progress}%{atEnd ? ' · 已至末页' : ''}</span>
      <button className="text-button" aria-label="下一页" disabled={atEnd} onClick={() => turn(1)}>›</button>
    </footer>
    {storageWarning && <p role="alert" className="reading-warning">{storageWarning}</p>}
    {toolbar && <div className="reader-bottom-tools"><p className="tools-progress">{scrolling ? '上下滚动' : `本章 ${page + 1} / ${starts.length} 页`} · 全书 {atEnd ? 100 : progress}%</p>
      <div className="chapter-controls"><button className="text-button" disabled={chapterIndex === 0} onClick={() => goChapter(chapterIndex - 1)}>上一章</button><label className="chapter-range">章节进度<input aria-label="章节进度" type="range" min="0" max="100" value={Math.round(positionToOffset(chapter, position) / Math.max(1, source.length) * 100)} onChange={event => seek(Number(event.target.value))} /></label><button className="text-button" disabled={chapterIndex === book.chapters.length - 1} onClick={() => goChapter(chapterIndex + 1)}>下一章</button></div>
      <nav aria-label="阅读工具栏" className="reading-actions"><button onClick={() => setPanel('chapters')}>☷<span>目录</span></button><button onClick={() => setPanel('english')}>En<span>英语</span></button><button onClick={() => setPreferences(value => ({ ...value, background: ['gray', 'black'].includes(value.background) ? value.lastLight : 'black', lastLight: ['gray', 'black'].includes(value.background) ? value.lastLight : value.background }))}>☾<span>夜间</span></button><button onClick={() => setPanel('settings')}>Aa<span>设置</span></button></nav>
    </div>}
    {panel && <dialog ref={settingsDialog} className="import-dialog reader-sheet" aria-labelledby="reading-settings-title" onCancel={event => { event.preventDefault(); setPanel(null) }}>
      <div className="sheet-handle" />
      <div className="section-heading"><h2 id="reading-settings-title">{panel === 'settings' ? '阅读设置' : panel === 'english' ? '英语浓度' : '目录'}</h2><button className="text-button" onClick={() => setPanel(null)}>完成</button></div>
      {panel === 'settings' && <>
        <h3 className="setting-label">字体大小</h3>
        <div className="font-controls"><button className="primary-button" disabled={fontSize <= 14} onClick={() => setFontSize(value => Math.max(14, value - 2))} aria-label="缩小字体">A−</button><output aria-live="polite">{fontSize}px</output><button className="primary-button" disabled={fontSize >= 32} onClick={() => setFontSize(value => Math.min(32, value + 2))} aria-label="放大字体">A+</button></div>
        <h3 className="setting-label">阅读背景</h3><div className="background-options">{backgrounds.map(item => <button key={item.id} aria-label={item.name} aria-pressed={preferences.background === item.id} onClick={() => setPreferences(value => ({ ...value, background: item.id, lastLight: ['gray', 'black'].includes(item.id) ? value.lastLight : item.id }))}><i style={{ background: item.bg, color: item.text }}>{preferences.background === item.id ? '✓' : ''}</i><span>{item.name}</span></button>)}</div>
        <h3 className="setting-label">翻页方式</h3><div className="mode-options">{([['cover', '覆盖翻页'], ['slide', '平移翻页'], ['scroll', '上下滚动'], ['none', '无动画翻页']] as const).map(([mode, label]) => <button key={mode} aria-pressed={preferences.mode === mode} onClick={() => changeMode(mode)}>{label}</button>)}</div>
      </>}
      {panel === 'english' && <><div className="english-value"><output aria-live="polite">{preferences.english}%</output><p>{preferences.english===0 && book.language?.startsWith('en') ? '完整英文原书' : preferences.english>=60 && (translationLoading||translationReadError||!bilingual.available) ? `目标：${englishDescriptions[preferences.english / 20]}（本章译文未就绪）` : preferences.english === 100 && !bilingual.complete ? '目标：完整英文译文（本章未就绪）' : englishDescriptions[preferences.english / 20]}</p></div><input className="english-range" aria-label="英语浓度" type="range" min="0" max="100" step="20" value={preferences.english} onChange={event => setPreferences(value => ({ ...value, english: Number(event.target.value) }))} /><div className="english-ticks">{[0,20,40,60,80,100].map(value => <span key={value}>{value}%</span>)}</div><p className="english-notice" role="status">{translationMessage}</p>{sentenceMessage && <p className="english-notice" role="status">{sentenceMessage}</p>}<p className="muted">当前为本地译文阅读，尚未接入自动翻译。60%／80%／100% 需要先导入对应章节的真实英文译文；没有译文时保留原文。覆盖率按原文对应内容计算，完整句组不会被拆碎来凑比例。</p>{preferences.english>=60 && !translationLoading && <p className="english-notice">本章可用译文覆盖 {bilingual.availablePercent}%；当前显示的完整英文句组覆盖 {bilingual.coveredPercent}%。可导入译文 JSON，或在设置页恢复原设备导出的完整备份。</p>}<button className="primary-button" onClick={() => { setPanel(null); setTranslationOpen(true) }}>译文管理 · 导入 / 导出</button></>}
      {panel === 'english' && <label className="chinese-hint-toggle"><span>中文释义提示<small>{preferences.chineseHints ? '开启：词语替换首次提示；完整译句请点词查看原句' : '关闭：点击英文查看中文释义'}</small></span><input type="checkbox" role="switch" aria-label="中文释义提示" checked={preferences.chineseHints} onChange={event => setPreferences(value => ({ ...value, chineseHints: event.target.checked }))} /></label>}
      {panel === 'chapters' && <div className="chapter-list">{book.toc?.length ? book.toc.map(entry=><button key={entry.id} style={{paddingLeft:entry.depth*14}} aria-current={entry.chapterId===chapter.id?'true':undefined} onClick={()=>goToToc(entry)}>{entry.title}</button>) : book.chapters.map((item, index) => <button key={item.id} aria-current={index === chapterIndex ? 'true' : undefined} onClick={() => goChapter(index)}>{item.title}</button>)}</div>}
    </dialog>}
    {translationOpen && <TranslationPanel book={book} chapterIndex={chapterIndex} onClose={() => setTranslationOpen(false)} onSaved={() => setTranslationRevision(value => value + 1)} />}
    {selectedWord && <WordMeaningCard key={`${selectedWord.displayStart}:${selectedWord.entryId}`} word={selectedWord} mastered={mastered.has(selectedWord.entryId!)}
      onClose={() => setSelectedWord(null)} onMasteryChange={(id, value) => setMastered(previous => { const next = new Set(previous); if (value) next.add(id); else next.delete(id); return next })} />}
  </article></div>
}
