import { signDelegation, signWireWithDelegation } from '@tik-choco/mistai/identity'
import { afterEach, expect, it, vi } from 'vitest'
import { GLOBAL_ROOM_ID } from '../config'
import type { DidIdentity } from '../crypto/didIdentity'
import { identities, PROJECT_ID, upsert } from '../test/fixtures'
import { DAY_MS } from './delegation'
import { attachReplicaMirror } from './mirror'
import { utcDay, utcDayStart } from './statsDays'
import { createStatsStore, parseStatsSnapshot } from './statsStore'
import { makeWire, personId, readRecord } from './wires'
import type { StatsRecord } from './wires'

const today = utcDayStart(Date.now())
const stats = (identity: DidIdentity, flags: number, at = today + 1) => makeWire(identity, {
  type: 'gdmw:stats', day: utcDay(at), updatedAt: at, views: { [PROJECT_ID]: flags },
})

afterEach(() => vi.useRealTimers())

it('unions disjoint flags across delegated leaves, dedupes days, and converges on signed evidence', async () => {
  const [root, leafA, leafB, other, author] = await identities()
  async function delegated(leaf: DidIdentity, flags: number) {
    const delegation = await signDelegation(root, leaf.did, { now: today })
    const raw = await signWireWithDelegation({
      v: 1, fromId: leaf.did, roomId: GLOBAL_ROOM_ID, type: 'gdmw:stats',
      day: utcDay(today), updatedAt: today + 1, views: { [PROJECT_ID]: flags },
    }, leaf, delegation)
    const record = readRecord(raw) as StatsRecord
    expect(personId(record)).toBe(root.did)
    return record
  }
  const [a, b, sameFlags, previous, distinct, self] = await Promise.all([
    delegated(leafA, 3), delegated(leafB, 6), delegated(leafB, 3),
    stats(root, 1, today - DAY_MS), stats(other, 1), stats(author, 7),
  ])
  const store = createStatsStore()
  store.merge([a, b, sameFlags, previous, distinct, self, b])
  const replay = createStatsStore()
  for (const record of [self, distinct, previous, sameFlags, b, a]) replay.merge([record])
  expect(store.get().map(record => record.signature).sort()).toEqual(replay.get().map(record => record.signature).sort())
  const sameTimeWinner = a.signature > sameFlags.signature ? a : sameFlags
  const sameTimeLoser = sameTimeWinner === a ? sameFlags : a
  expect(store.has(sameTimeWinner.signature)).toBe(true)
  expect(store.has(sameTimeLoser.signature)).toBe(false)
  expect(store.merge([sameTimeLoser, b])).toBe(false)
  expect(store.views(root.did, a.day)?.get(PROJECT_ID)).toBe(7)
  const summary = store.summary(PROJECT_ID, author.did)
  expect(summary.week).toEqual({ impression: 3, detail: 1, click: 1 })
  expect(summary.month).toEqual(summary.week)
  expect(summary.daily.slice(-3).map(point => point.impressions)).toEqual([0, 1, 2])
  const full = await stats(root, 7, today + 2)
  expect(store.merge([full])).toBe(true)
  expect(store.get()).toEqual(expect.arrayContaining([full, previous, distinct, self]))
  expect(store.get()).toHaveLength(4)
})

it('uses 7 and 30 UTC-day windows and removes expired records on merge and read', async () => {
  const [viewer, author] = await identities()
  const withinWeek = await stats(viewer, 7, today - 6 * DAY_MS)
  const withinMonth = await stats(viewer, 7, today - 29 * DAY_MS)
  const withinRetention = await stats(viewer, 7, today - 89 * DAY_MS)
  let now = today + 2
  const store = createStatsStore(() => now)
  store.merge([withinWeek, withinMonth, withinRetention])
  const summary = store.summary(PROJECT_ID, author.did)
  expect(summary.week).toEqual({ impression: 1, detail: 1, click: 1 })
  expect(summary.month).toEqual({ impression: 2, detail: 2, click: 2 })
  expect(summary.daily).toHaveLength(30)
  expect(summary.daily[0]).toEqual({ day: withinMonth.day, impressions: 1 })
  now = today + DAY_MS
  expect(store.has(withinRetention.signature)).toBe(false)
  expect(store.merge([withinRetention])).toBe(false)
  expect(store.get()).toEqual([withinWeek, withinMonth])
})

it('cleans expired and invalid data from both local replicas and writes stats separately', async () => {
  const [viewer] = await identities()
  const old = await stats(viewer, 3, today - 89 * DAY_MS)
  const latest = await stats(viewer, 4)
  const invalid = await upsert(viewer)
  vi.setSystemTime(today + DAY_MS)
  function replica(records: unknown[]) {
    let raw = JSON.stringify({ v: 1, records })
    return { async read() { return raw }, async write(payload: string) { raw = payload } }
  }
  const primary = replica([old, invalid])
  const fallback = replica([old])
  const store = createStatsStore()
  const mirror = attachReplicaMirror(store, primary, { key: 'stats-test', parse: parseStatsSnapshot, fallback,
    cacheEpoch: () => utcDay(Date.now()) })
  try {
    await mirror.ready
    expect(store.get()).toEqual([])
    expect(JSON.parse(await primary.read()).records).toEqual([])
    expect(JSON.parse(await fallback.read()).records).toEqual([])
    store.merge([latest])
    await mirror.drained()
    expect(JSON.parse(await primary.read()).records).toEqual([latest])
    vi.setSystemTime(today + 90 * DAY_MS)
    await mirror.refresh()
    expect(JSON.parse(await primary.read()).records).toEqual([])
    expect(store.get()).toEqual([])
  } finally { mirror.dispose() }
})
