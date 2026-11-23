import { afterEach, expect, it, vi } from 'vitest'
import { createDidIdentity } from '../crypto/didIdentity'
import { PROJECT_ID } from '../test/fixtures'
import { createImpressionObserver } from './impressions'
import { createStatsPublisher } from './statsPublisher'
import { createStatsStore } from './statsStore'
import { readRecord } from './wires'
import type { StatsRecord } from './wires'

let deliver: IntersectionObserverCallback
const observe = vi.fn()
const unobserve = vi.fn()
const disconnect = vi.fn()
const takeRecords = vi.fn<() => IntersectionObserverEntry[]>()
const secondId = '190b17ef-7ad2-43e4-b374-351e89cc5c45'

function mockObserver() {
  vi.useFakeTimers()
  vi.clearAllMocks()
  takeRecords.mockReturnValue([])
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
      deliver = callback
      expect(options.threshold).toBe(0.5)
    }
    observe = observe
    unobserve = unobserve
    disconnect = disconnect
    takeRecords = takeRecords
  })
  return (target: Element, intersectionRatio: number) => deliver(
    [{ target, intersectionRatio, isIntersecting: intersectionRatio > 0 } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('requires continuous exposure in a visible tab and cancels removed cards', () => {
  const report = mockObserver()
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const target = document.createElement('li')
  const onImpression = vi.fn()
  const observer = createImpressionObserver(onImpression)
  try {
    observer.setTargets([target])
    expect(observe).toHaveBeenCalledWith(target)
    report(target, 0.49)
    vi.advanceTimersByTime(1000)
    expect(onImpression).not.toHaveBeenCalled()
    report(target, 0.5)
    vi.advanceTimersByTime(999)
    report(target, 0.1)
    vi.advanceTimersByTime(1)
    expect(onImpression).not.toHaveBeenCalled()
    report(target, 0.51)
    vi.advanceTimersByTime(999)
    hidden.mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(1000)
    expect(onImpression).not.toHaveBeenCalled()
    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    report(target, 0.5)
    observer.setTargets([])
    vi.advanceTimersByTime(1000)
    expect(onImpression).not.toHaveBeenCalled()
    observer.setTargets([target])
    report(target, 0.6)
    vi.advanceTimersByTime(1000)
    report(target, 0.75)
    vi.advanceTimersByTime(1000)
    expect(onImpression).toHaveBeenCalledExactlyOnceWith(target)
    expect(unobserve).toHaveBeenCalledWith(target)
  } finally { observer.dispose() }
  expect(disconnect).toHaveBeenCalledOnce()
})

it('batches two catalog impressions with detail and click activity, dedupes, and flushes on hide', async () => {
  const report = mockObserver()
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const identity = await createDidIdentity()
  const store = createStatsStore()
  const publish = vi.fn((wire: StatsRecord) => { store.merge([wire]) })
  const publisher = createStatsPublisher({ identity, selfId: () => identity.did, store, ready: Promise.resolve(), publish })
  const first = document.createElement('li')
  const second = document.createElement('li')
  const observer = createImpressionObserver(target => publisher.track(target === first ? PROJECT_ID : secondId, 'author', 'impression'))
  try {
    observer.setTargets([first, second])
    report(first, 0.8)
    report(second, 0.5)
    vi.advanceTimersByTime(1000)
    publisher.track(PROJECT_ID, 'author', 'detail')
    publisher.track(PROJECT_ID, 'author', 'detail')
    publisher.track(secondId, identity.did, 'detail')
    vi.advanceTimersByTime(59_999)
    expect(publish).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce())
    const firstWire = publish.mock.calls[0][0]
    expect(firstWire.views).toEqual({ [PROJECT_ID]: 3, [secondId]: 1 })
    expect(readRecord(JSON.parse(JSON.stringify(firstWire)))).toEqual(firstWire)

    publisher.track(PROJECT_ID, 'author', 'impression')
    vi.advanceTimersByTime(60_000)
    expect(publish).toHaveBeenCalledOnce()
    publisher.track(PROJECT_ID, 'author', 'click')
    hidden.mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(2))
    expect(publish.mock.calls[1][0].views).toEqual({ [PROJECT_ID]: 7, [secondId]: 1 })
    expect(store.get()).toHaveLength(1)
  } finally { observer.dispose(); publisher.dispose() }
})
