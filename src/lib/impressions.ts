const THRESHOLD = 0.5
const DWELL_MS = 1000

export function createImpressionObserver(onImpression: (target: Element) => void) {
  const targets = new Map<Element, ReturnType<typeof setTimeout> | undefined>()
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(update, { threshold: THRESHOLD }) : undefined

  function update(entries: IntersectionObserverEntry[]) {
    for (const { target, isIntersecting, intersectionRatio } of entries) {
      if (!targets.has(target)) continue
      const timer = targets.get(target)
      if (document.hidden || !isIntersecting || intersectionRatio < THRESHOLD) {
        clearTimeout(timer)
        targets.set(target, undefined)
      } else if (timer === undefined) {
        const next = setTimeout(() => {
          update(observer?.takeRecords() ?? [])
          if (document.hidden || targets.get(target) !== next) return
          // Keep the timer token until the card leaves the threshold, so the same exposure fires once.
          onImpression(target)
        }, DWELL_MS)
        targets.set(target, next)
      }
    }
  }

  function remove(target: Element) {
    clearTimeout(targets.get(target))
    targets.delete(target)
    observer?.unobserve(target)
  }

  function onVisibility() {
    observer?.takeRecords()
    for (const [target, timer] of targets) {
      clearTimeout(timer)
      targets.set(target, undefined)
      observer?.unobserve(target)
      if (!document.hidden) observer?.observe(target)
    }
  }
  if (observer) document.addEventListener('visibilitychange', onVisibility)

  return {
    setTargets(next: Iterable<Element>) {
      if (!observer) return
      const elements = new Set(next)
      // Deliver queued changes for surviving targets before reobserving any element.
      update(observer.takeRecords().filter(entry => elements.has(entry.target)))
      for (const target of targets.keys()) if (!elements.has(target)) remove(target)
      for (const target of elements) {
        if (targets.has(target)) continue
        targets.set(target, undefined)
        if (!document.hidden) observer.observe(target)
      }
    },
    dispose() {
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
      for (const timer of targets.values()) clearTimeout(timer)
      targets.clear()
    },
  }
}
