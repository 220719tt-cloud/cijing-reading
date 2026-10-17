export interface SpeechEnvironment {
  synthesis: SpeechSynthesis;
  createUtterance: (text: string) => SpeechSynthesisUtterance;
}
/** Call synchronously from the user's click, important for mobile audio permissions. */
export function startEnglishSpeech(text: string, environment: SpeechEnvironment, onError: (message: string) => void, onEnd: () => void) {
  const { synthesis, createUtterance } = environment
  const utterance = createUtterance(text)
  utterance.lang = 'en-US'
  const available = synthesis.getVoices()
  const voices = available.filter(voice => /^en(?:-|_|$)/i.test(voice.lang))
  if (available.length && !voices.length) {
    onError('设备未提供英语语音，请在系统语音设置中添加英语后重试。')
    onEnd()
    return () => {}
  }
  utterance.voice = voices.find(voice => voice.localService) ?? voices[0] ?? null
  if (utterance.voice) utterance.lang = utterance.voice.lang
  let finished = false
  const finish = () => { if (finished) return; finished = true; clearTimeout(timeout); onEnd() }
  // Some browsers expose the API but never deliver playback events without a voice.
  const timeout = setTimeout(() => {
    utterance.onerror = null; utterance.onend = null; synthesis.cancel()
    onError('系统发音未能完成，请检查设备的英语语音后重试。'); finish()
  }, 15000)
  utterance.onend = finish
  utterance.onerror = event => {
    if (!['canceled', 'interrupted'].includes(event.error)) onError('英语发音暂不可用，请检查设备的英语语音或浏览器播放权限。')
    finish()
  }
  try { synthesis.cancel(); synthesis.speak(utterance) }
  catch (error) { clearTimeout(timeout); throw error }
  return () => { clearTimeout(timeout); utterance.onend = null; utterance.onerror = null; synthesis.cancel() }
}
