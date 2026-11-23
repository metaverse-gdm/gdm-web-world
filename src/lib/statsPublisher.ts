import type { DidIdentity } from '../crypto/didIdentity'
import { retainedStatsDay, utcDay } from './statsDays'
import type { createStatsStore } from './statsStore'
import { LIMITS, makeWire, personId, STATS_FLAGS } from './wires'
import type { StatsMetric, StatsRecord } from './wires'

const PUBLISH_INTERVAL_MS = 60_000
type Pending = { person: string; day: string; at: number; views: Map<string, number> }

export function createStatsPublisher({ identity, selfId, store, ready, publish }: {
  identity: DidIdentity; selfId(): string; store: ReturnType<typeof createStatsStore>
  ready: Promise<void>; publish(wire: StatsRecord): void
}) {
  const pending = new Map<string, Pending>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let disposed = false

  function schedule() {
    if (!disposed && !running && timer === undefined && pending.size) {
      timer = setTimeout(() => { void flush() }, PUBLISH_INTERVAL_MS)
    }
  }

  async function flush() {
    if (disposed || running || !pending.size) return
    clearTimeout(timer)
    timer = undefined
    running = true
    try {
      await ready
      if (disposed) return
      for (const [key, batch] of pending) {
        if (batch.person !== selfId() || !retainedStatsDay(batch.day, Date.now())) pending.delete(key)
      }
      const next = pending.entries().next()
      if (next.done) return
      const [key, batch] = next.value
      const known = store.views(batch.person, batch.day)
      const views = new Map<string, number>()
      for (const [id, flags] of batch.views) {
        const before = known?.get(id) ?? 0
        if ((before | flags) !== before) views.set(id, before | flags)
      }
      if (!views.size) { pending.delete(key); return }
      for (const [id, flags] of known ?? []) {
        if (views.size >= LIMITS.statsProjects) break
        if (!views.has(id)) views.set(id, flags)
      }
      const now = Date.now()
      const wire = await makeWire(identity, {
        type: 'gdmw:stats', day: batch.day, views: Object.fromEntries(views),
        updatedAt: batch.day === utcDay(now) ? now : batch.at,
      })
      if (disposed) return
      if (selfId() !== batch.person || personId(wire) !== batch.person) { pending.delete(key); return }
      const latest = store.views(batch.person, batch.day)
      if ([...views].some(([id, flags]) => ((latest?.get(id) ?? 0) & flags) !== flags)) publish(wire)
      for (const [id, flags] of batch.views) {
        const remaining = flags & ~(views.get(id) ?? 0)
        if (remaining) batch.views.set(id, remaining)
        else batch.views.delete(id)
      }
      if (!batch.views.size) pending.delete(key)
    } catch (error) {
      console.warn('gdm-world stats publish', error)
    } finally {
      running = false
      schedule()
    }
  }

  const onPageHide = () => { void flush() }
  const onVisibility = () => { if (document.hidden) onPageHide() }
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibility)

  return {
    track(projectId: string, author: string, metric: StatsMetric) {
      const person = selfId()
      if (disposed || person === author) return
      const at = Date.now()
      const day = utcDay(at)
      const flag = STATS_FLAGS[metric]
      const known = store.views(person, day)
      const key = `${person}:${day}`
      const batch = pending.get(key) ?? { person, day, at, views: new Map<string, number>() }
      const signed = known?.get(projectId) ?? 0
      const before = batch.views.get(projectId) ?? 0
      if ((before | signed) & flag) return
      if (batch.views.size >= LIMITS.statsProjects && !before) return
      if (!signed && !before) {
        const newProjects = [...batch.views.keys()].filter(id => !known?.has(id)).length
        if ((known?.size ?? 0) + newProjects >= LIMITS.statsProjects) return
      }
      batch.at = at
      batch.views.set(projectId, before | flag)
      pending.set(key, batch)
      schedule()
    },
    dispose() {
      disposed = true
      pending.clear()
      clearTimeout(timer)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
