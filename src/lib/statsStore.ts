import { DAY_MS } from './delegation'
import { retainedStatsDay, utcDay, utcDayStart } from './statsDays'
import { compareStrings } from './wireSign'
import { hasOnly, isObject, personId, readRecord, STATS_FLAGS } from './wires'
import type { StatsMetric, StatsRecord } from './wires'

export const STATS_KEY = 'gdm-world:stats:v1'

type ViewerDay = { records: StatsRecord[]; views: Map<string, number> }
type Totals = Record<StatsMetric, number>
const emptyTotals = (): Totals => ({ impression: 0, detail: 0, click: 0 })
const metrics = Object.keys(STATS_FLAGS) as StatsMetric[]

function mergeViewerDay(candidates: StatsRecord[]): ViewerDay {
  const records: StatsRecord[] = []
  const views = new Map<string, number>()
  // Keep the newest signed evidence for each flag. A superseded record can be dropped
  // because its flags are covered by newer signatures, even when merging in another order.
  candidates.sort((a, b) => b.updatedAt - a.updatedAt || compareStrings(b.signature, a.signature))
  for (const record of candidates) {
    let added = false
    for (const [id, flags] of Object.entries(record.views)) {
      const before = views.get(id) ?? 0
      if ((before | flags) === before) continue
      views.set(id, before | flags)
      added = true
    }
    if (added) records.push(record)
  }
  return { records, views }
}

export function parseStatsSnapshot(value: unknown, now = Date.now()) {
  if (!isObject(value) || !hasOnly(value, ['v', 'records']) || value.v !== 1 || !Array.isArray(value.records)) {
    throw new Error('Invalid stats snapshot envelope')
  }
  const records: StatsRecord[] = []
  for (const raw of value.records) {
    const record = readRecord(raw, now)
    if (record?.type === 'gdmw:stats') records.push(record)
  }
  return { records, pruned: records.length !== value.records.length }
}

export function createStatsStore(clock = Date.now) {
  const days = new Map<string, Map<string, ViewerDay>>()
  const bySignature = new Map<string, StatsRecord>()
  const listeners = new Set<() => void>()
  let lastPrune = -Infinity

  function prune(now: number) {
    const today = utcDayStart(now)
    if (today === lastPrune) return
    lastPrune = today
    for (const [day, viewers] of days) {
      if (retainedStatsDay(day, now)) continue
      for (const viewer of viewers.values()) {
        for (const record of viewer.records) bySignature.delete(record.signature)
      }
      days.delete(day)
    }
  }

  return {
    prune: () => prune(clock()),
    get(now = clock()) { prune(now); return [...bySignature.values()] },
    has(key: string, now = clock()) { prune(now); return bySignature.has(key) },
    views(person: string, day: string, now = clock()): ReadonlyMap<string, number> | undefined {
      prune(now)
      return days.get(day)?.get(person)?.views
    },
    merge(incoming: readonly StatsRecord[], now = clock()) {
      prune(now)
      let changed = false
      for (const record of incoming) {
        if (bySignature.has(record.signature) || !retainedStatsDay(record.day, now)) continue
        const person = personId(record)
        const viewers = days.get(record.day) ?? new Map<string, ViewerDay>()
        const previous = viewers.get(person)
        const next = mergeViewerDay([...(previous?.records ?? []), record])
        if (!next.records.includes(record)) continue
        for (const old of previous?.records ?? []) bySignature.delete(old.signature)
        for (const kept of next.records) bySignature.set(kept.signature, kept)
        viewers.set(person, next)
        days.set(record.day, viewers)
        changed = true
      }
      if (changed) for (const listener of listeners) listener()
      return changed
    },
    summary(projectId: string, author: string, now = clock()) {
      prune(now)
      const today = utcDayStart(now)
      const week = emptyTotals()
      const month = emptyTotals()
      const daily = Array.from({ length: 30 }, (_, index) => {
        const daysAgo = 29 - index
        const day = utcDay(today - daysAgo * DAY_MS)
        let impressions = 0
        for (const [person, viewer] of days.get(day) ?? []) {
          const flags = viewer.views.get(projectId)
          if (person === author || !flags) continue
          for (const metric of metrics) {
            if (!(flags & STATS_FLAGS[metric])) continue
            month[metric]++
            if (daysAgo < 7) week[metric]++
          }
          if (flags & STATS_FLAGS.impression) impressions++
        }
        return { day, impressions }
      })
      return { week, month, daily }
    },
    subscribe(callback: () => void) {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
  }
}

export type ProjectStats = ReturnType<ReturnType<typeof createStatsStore>['summary']>
