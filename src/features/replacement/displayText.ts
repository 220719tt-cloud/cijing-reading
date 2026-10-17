export type ReplacementPolicy = 'noun' | 'count' | 'adjective' | 'predicate' | 'adverb' | 'verb' | 'later' | 'silence' | 'beside' | 'distance' | 'moment' | 'finally'
export interface ReplacementRule {
  id: string; chinese: string; english: string; entryId: string; policy: string; plural?: string;
}
export interface DisplayRun {
  sourceStart: number; sourceEnd: number; displayStart: number; displayEnd: number;
  replacement: boolean; sentence?: boolean; translation?: boolean; contextChinese?: string; contextEnglish?: string; lookupMeaning?: string; lookup?: boolean; entryId?: string; hint?: boolean; english?: string; chinese?: string;
}
export interface DisplayText { original: string; text: string; runs: DisplayRun[]; eligible: number; replaced: number }
export interface DisplayOptions { concentration: number; seed: string; titles?: string[]; mastered?: ReadonlySet<string>; showChineseHints?: boolean }
function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return hash >>> 0
}
function occurrences(source: string, value: string, ranges: [number, number][]) {
  if (!value) return
  for (let start = source.indexOf(value); start >= 0; start = source.indexOf(value, start + value.length)) ranges.push([start, start + value.length])
}
export function protectedRanges(source: string, titles: string[], rules: readonly ReplacementRule[]) {
  const ranges: [number, number][] = []
  // These compounds have a different sense or must remain a complete Chinese unit.
  for (const match of source.matchAll(/眼镜蛇|面包车|咖啡色|笔记本电脑|汽车站|火车头|回忆录|手指头|老人家|孩子气|孤独症|恐惧症|呼吸道|呼吸机|轻轻松松|慢慢悠悠|慢慢吞吞|慢慢来|悄悄话|忽然间|突然间|苹果(?:手机|电脑|公司|手表)/gu)) ranges.push([match.index!,match.index!+match[0].length])
  // Ordinary quoted dialogue is readable content, not automatically a proper name.
  for (const match of source.matchAll(/《[^》\n]*》|〈[^〉\n]*〉/g)) ranges.push([match.index!, match.index! + match[0].length])
  for (const title of titles) occurrences(source, title.trim(), ranges)
  let start = 0
  for (const line of source.split('\n')) {
    if (/^\s*(?:第[零〇一二三四五六七八九十百千万\d]+[章回卷节部]|序章|楔子|尾声)/u.test(line)) ranges.push([start, start + line.length])
    start += line.length + 1
  }
  const names = new Set<string>()
  for (const match of source.matchAll(/(?:名叫|名为|叫做|名字是|称为|我叫|他叫|她叫|它叫)[“「『"]?([\u3400-\u9fff]{1,8}?)(?=[”」』"，。！？、\n的])/g)) names.add(match[1])
  // Named speakers and addressed people can be recognized without a name dictionary.
  for (const match of source.matchAll(/(?:^|[，。！？\n“「])([赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦许何吕张孔曹严华金魏陶姜谢邹苏潘范彭白林马罗梁宋唐刘徐叶陆顾江夏方程傅萧温][\u3400-\u9fff]{1,2})(?=说[：道，]|问[：道，]|回答|先生|女士|同学|走|站|坐|看|听|拿|推|抬|回|转|搬|微笑|突然|忽然|点头|摇头)/g)) names.add(match[1])
  for (const name of names) occurrences(source, name, ranges)
  // Conservatively protect whole place/company names, rather than only their last noun.
  const nameParts = rules.filter(rule => ['noun', 'count'].includes(rule.policy)).map(rule => rule.chinese).sort((a, b) => b.length - a.length)
  // Match noun chains such as 森林月亮城; never consume a whole preceding clause
  // (他决定放弃这条旧路 contains a verb, not one long place name).
  const places = new RegExp(`(?:${nameParts.join('|')})+(?:城|镇|村|县|市|省|区|街|路|山|湖|海|湾|学院|公司)`, 'g')
  if (nameParts.length) for (const match of source.matchAll(places)) ranges.push([match.index!, match.index! + match[0].length])
  return ranges
}
function grammaticalForm(rule: ReplacementRule, before: string, after: string): string | null {
  if (/^(?:城|镇|村|国|山|湖|海|路|街|学院|公司|先生|女士|同学|势力|般|似的)/u.test(after)) return null
  if (['恐惧','愤怒','孤独','寂寞','悲伤'].includes(rule.chinese) && /(?:很|十分|非常|有些|太|显得|变得|觉得)$/u.test(before)) return null
  if (rule.chinese === '耐心' && !/(?:的|有|保持|失去|需要|耗尽|足够|缺乏|一点|更多|没有|拿出|要有)$/u.test(before)) return null
  if (rule.chinese === '回忆' && !/(?:的|一段|这些|那些|所有|许多|美好|痛苦|充满|留下|唤起|带着|满是)$/u.test(before) && !/^(?:涌|浮|像|是|里|中|让|随|占|变|永|仿佛|[，。])/u.test(after)) return null
  if (rule.chinese === '呼吸' && /(?:他|她|我|你|孩子|老人)$/u.test(before)) return null
  if (rule.chinese === '消息' && /(?:发|发送|回复|一条|短信|微信|聊天|手机里的)$/u.test(before)) return null
  if (rule.chinese === '起初' && /想$/u.test(before)) return null
  if (rule.chinese === '小心地' && /不$/u.test(before)) return null
  if (rule.chinese === '马上' && /(?:在|骑|跨|骏|白|黑|匹)$/u.test(before)) return null
  if (rule.chinese === '差点' && /^(?:钱|东西|意思|味)/u.test(after)) return null
  if (rule.chinese === '始终' && /^如一/u.test(after)) return null
  if (rule.policy === 'adjective' && (!/^[\u3400-\u9fff]/u.test(after) || /^(?:是|不|也|却|而|并|就|都|只有)/u.test(after))) return null
  if (rule.policy === 'count' && /^们/u.test(after)) return null
  if (rule.policy === 'verb') {
    // Base forms after modal/intent constructions only; do not guess tense, aspect
    // or rewrite an inflected Chinese predicate as an English bare verb.
    if (!/(?:可以|能够|能|会|要|想|想要|打算|决定|准备|不必|无需|必须|应该|愿意|试着|开始|继续|请|别)$/u.test(before)) return null
    if (/^(?:了|着|过|不|起|下|完|得)/u.test(after)) return null
  } else if (rule.policy === 'silence') {
    if (!/^(?:走|站|坐|看|听|点头|离开|前行|等待)/u.test(after)) return null
  } else if (rule.policy === 'later') {
    if (!/^(?:会|要|都|得|能)/u.test(after)) return null
  } else if (rule.policy === 'beside') {
    if (!/^(?:地|走|站|坐|看|交谈|说|前行|而行|聊)/u.test(after)) return null
  } else if (rule.policy === 'distance') {
    if (!/^(?:[，。！？、]|传来|响起|看见|看到|出现|闪|亮|有)/u.test(after)) return null
  } else if (rule.policy === 'moment') {
    if (!/(?:停留|等候|等待|停顿|休息|沉默|犹豫|停了|等了)$/u.test(before)) return null
  } else if (rule.policy === 'finally') {
    if (/^(?:一|的|几|那|面|阶段|部分|期限|通牒)/u.test(after)) return null // 最后一页 is not finally 一页.
  } else if (rule.policy === 'predicate') {
    if (!/(?:是|感到|觉得|显得|变得)$/u.test(before)) return null
  }
  if (rule.policy === 'adverb' && /^(?:的|性|感|间|然)/u.test(after)) return null
  if (rule.policy === 'count') {
    const pair = /(?:一|两|几|[二三四五六七八九十])(?:双|对)$/u.test(before) || rule.chinese === '翅膀' && /一副$/u.test(before)
    const plural = pair || /(?:几|两|[二三四五六七八九十百千万多数])[个位盏条只张本棵片把座间封件朵双副辆栋粒颗扇支]?$|(?:一|几)[叠群堆排串袋盒篮套]$/u.test(before)
    if (plural) return rule.plural ?? null
  }
  // Avoid turning psychological nouns into verbs/adjectives (恐惧着 / 孤独地).
  if (['恐惧','愤怒','孤独','寂寞','悲伤','呼吸','微笑'].includes(rule.chinese) && /^(?:着|地|了|得|起来)/u.test(after)) return null
  return rule.english
}
export function buildDisplayText(source: string, candidates: readonly ReplacementRule[], options: DisplayOptions): DisplayText {
  if (![20, 40].includes(options.concentration)) return { original: source, text: source, runs: source ? [{ sourceStart: 0, sourceEnd: source.length, displayStart: 0, displayEnd: source.length, replacement: false }] : [], eligible: 0, replaced: 0 }
  const ranges = protectedRanges(source, options.titles ?? [], candidates)
  const matches: { start: number; end: number; candidate: ReplacementRule; english: string }[] = []
  for (const candidate of candidates) {
    if (!candidate.chinese || !candidate.english) continue
    for (let start = source.indexOf(candidate.chinese); start >= 0; start = source.indexOf(candidate.chinese, start + candidate.chinese.length)) {
      const end = start + candidate.chinese.length
      if (ranges.some(([a, b]) => start < b && end > a)) continue
      const english = grammaticalForm(candidate, source.slice(Math.max(0, start - 30), start), source.slice(end, end + 30))
      if (english) matches.push({ start, end, candidate, english })
    }
  }
  // Resolve overlapping expressions longest-first even when the longer one starts
  // later (e.g. 会毫不犹豫). Nothing inside an accepted phrase is replaced again.
  matches.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)
  const occupied = new Uint8Array(source.length)
  const eligible: typeof matches = []
  for (const match of matches) {
    let overlaps = false
    for (let index = match.start; index < match.end; index++) if (occupied[index]) { overlaps = true; break }
    if (overlaps) continue
    occupied.fill(1, match.start, match.end); eligible.push(match)
  }
  eligible.sort((a, b) => a.start - b.start)
  // A meaningful source-character budget, balanced per paragraph. 20% is capped
  // at half of eligible spans so sparse vocabulary still leaves room for 40%.
  // The same stable ranking gives nested selections across concentrations.
  const chosen: typeof matches = []
  let paragraphStart = 0
  for (const paragraph of source.split('\n')) {
    const end = paragraphStart + paragraph.length
    const pool = eligible.filter(match => match.start >= paragraphStart && match.start < end)
    const ranked = [...pool].sort((a, b) => stableHash(`${options.seed}:${a.start}:${a.candidate.id}`) - stableHash(`${options.seed}:${b.start}:${b.candidate.id}`) || a.start - b.start)
    const budget = Math.ceil((paragraph.match(/[\u3400-\u9fff]/g)?.length ?? 0) * options.concentration / 100)
    const cap = options.concentration === 20 ? Math.max(1, Math.floor(pool.length / 2)) : pool.length
    let covered = 0
    for (const match of ranked.slice(0, cap)) {
      if (covered >= budget) break
      chosen.push(match); covered += match.end - match.start
    }
    paragraphStart = end + 1
  }
  chosen.sort((a, b) => a.start - b.start)
  let text = '', cursor = 0
  const runs: DisplayRun[] = [], seen = new Set<string>()
  const append = (start: number, end: number, display: string, replacement: boolean, entryId?: string, hint?: boolean) => {
    runs.push({ sourceStart: start, sourceEnd: end, displayStart: text.length, displayEnd: text.length + display.length, replacement, entryId, hint }); text += display
  }
  for (const match of chosen) {
    if (cursor < match.start) append(cursor, match.start, source.slice(cursor, match.start), false)
    const { candidate } = match
    const hint = options.showChineseHints === true && !seen.has(candidate.entryId) && !options.mastered?.has(candidate.entryId)
    seen.add(candidate.entryId)
    append(match.start, match.end, ` ${match.english}${hint ? `（${candidate.chinese}）` : ''} `, true, candidate.entryId, hint)
    Object.assign(runs[runs.length - 1], { english: match.english, chinese: candidate.chinese })
    cursor = match.end
  }
  if (cursor < source.length) append(cursor, source.length, source.slice(cursor), false)
  return { original: source, text, runs, eligible: eligible.length, replaced: chosen.length }
}
/** Boundaries remain in original UTF-16 offsets, compatible with existing saved positions. */
export function sourceToDisplay(model: DisplayText, offset: number) {
  const clamped = Math.max(0, Math.min(model.original.length, offset))
  for (const run of model.runs) if (clamped < run.sourceEnd) return (run.replacement || run.translation) ? run.displayStart : run.displayStart + clamped - run.sourceStart
  return model.text.length
}
export function displayToSource(model: DisplayText, offset: number) {
  const clamped = Math.max(0, Math.min(model.text.length, offset))
  for (const run of model.runs) if (clamped < run.displayEnd) return (run.replacement || run.translation) ? run.sourceStart : run.sourceStart + clamped - run.displayStart
  return model.original.length
}
