import test from 'node:test'
import assert from 'node:assert/strict'
import { animateSafely, matchesPreference, observeElementSize } from '../src/shared/browser/compatibility.ts'
import { listBooks } from '../src/shared/storage/books.ts'

test('媒体偏好缺失或被限制时使用默认值', () => {
  const original = globalThis.matchMedia
  try {
    delete globalThis.matchMedia
    assert.equal(matchesPreference('(prefers-color-scheme: dark)'), false)
    globalThis.matchMedia = () => { throw new Error('restricted') }
    assert.equal(matchesPreference('(prefers-reduced-motion: reduce)'), false)
  } finally { if (original) globalThis.matchMedia = original; else delete globalThis.matchMedia }
})
test('动画缺失、失败及减少动画偏好均降级；支持时调用原生动画', () => {
  const original = globalThis.matchMedia
  const frames = [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }]
  try {
    globalThis.matchMedia = () => ({ matches: false })
    assert.equal(animateSafely({}, frames, {}), null)
    assert.equal(animateSafely({ animate() { throw new Error('unsupported') } }, frames, {}), null)
    const animation = { cancel() {} }
    assert.equal(animateSafely({ animate(received) { assert.equal(received, frames); return animation } }, frames, {}), animation)
    globalThis.matchMedia = () => ({ matches: true })
    assert.equal(animateSafely({ animate() { assert.fail('减少动画时不应调用') } }, frames, {}), null)
  } finally { if (original) globalThis.matchMedia = original; else delete globalThis.matchMedia }
})
function sizeEnvironment(run, withObserver) {
  const oldWindow = globalThis.window, oldObserver = globalThis.ResizeObserver
  const windowEvents = new EventTarget(), visualViewport = new EventTarget()
  let callback, disconnected = false
  globalThis.window = { addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents), visualViewport }
  if (withObserver) globalThis.ResizeObserver = class { constructor(fn) { callback = fn } observe() {} disconnect() { disconnected = true } }
  else delete globalThis.ResizeObserver
  try { run({ windowEvents, visualViewport, notify: () => callback(), disconnected: () => disconnected }) }
  finally {
    if (oldWindow) globalThis.window = oldWindow; else delete globalThis.window
    if (oldObserver) globalThis.ResizeObserver = oldObserver; else delete globalThis.ResizeObserver
  }
}
test('没有 ResizeObserver 时首次、窗口与视口变化可测量并清理', () => {
  sizeEnvironment(({windowEvents, visualViewport}) => {
    const element = {clientWidth:320,clientHeight:600}, sizes = []
    const stop = observeElementSize(element, size => sizes.push(size))
    assert.deepEqual(sizes,[{width:320,height:600}])
    windowEvents.dispatchEvent(new Event('resize'))
    assert.equal(sizes.length,1)
    element.clientWidth = 700; windowEvents.dispatchEvent(new Event('resize'))
    element.clientHeight = 400; visualViewport.dispatchEvent(new Event('resize'))
    assert.deepEqual(sizes.at(-1),{width:700,height:400})
    stop(); element.clientWidth = 900; windowEvents.dispatchEvent(new Event('resize')); visualViewport.dispatchEvent(new Event('resize'))
    assert.equal(sizes.length,3)
  },false)
})
test('有 ResizeObserver 时监听元素并在卸载时断开', () => {
  sizeEnvironment(({notify,disconnected}) => {
    const element = {clientWidth:320,clientHeight:600}, sizes = []
    const stop = observeElementSize(element, size => sizes.push(size))
    element.clientWidth = 450; notify()
    assert.deepEqual(sizes.at(-1),{width:450,height:600})
    stop(); assert.equal(disconnected(),true)
  },true)
})
test('IndexedDB 缺失明确报告无法保存，不伪装为成功的空书库', async () => {
  const original = globalThis.indexedDB
  try {
    delete globalThis.indexedDB
    await assert.rejects(listBooks(), /当前浏览器无法使用本地书库/)
  } finally { if (original) globalThis.indexedDB = original; else delete globalThis.indexedDB }
})
