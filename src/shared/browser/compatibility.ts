/** Optional preferences must never prevent the application from opening. */
export function matchesPreference(query: string): boolean {
  try { return typeof matchMedia === 'function' && matchMedia(query).matches }
  catch { return false }
}

/** Missing/restricted Web Animations degrades to the existing instant page change. */
export function animateSafely(element: Element, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (typeof element.animate !== 'function' || matchesPreference('(prefers-reduced-motion: reduce)')) return null
  try { return element.animate(frames, options) }
  catch { return null }
}

/** Measure immediately; older/embedded browsers can still reflow on window resize. */
export function observeElementSize(element: HTMLElement, update: (size: { width: number; height: number }) => void) {
  let width = -1, height = -1
  const measure = () => {
    if (width === element.clientWidth && height === element.clientHeight) return
    width = element.clientWidth; height = element.clientHeight
    update({ width, height })
  }
  measure()
  let observer: ResizeObserver | undefined
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(measure)
    observer.observe(element)
  }
  window.addEventListener('resize', measure)
  window.visualViewport?.addEventListener('resize', measure)
  return () => {
    observer?.disconnect()
    window.removeEventListener('resize', measure)
    window.visualViewport?.removeEventListener('resize', measure)
  }
}
