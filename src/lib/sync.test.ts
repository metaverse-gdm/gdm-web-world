import { afterEach, expect, it, vi } from 'vitest'
import { identities, PROJECT_ID, upsert } from '../test/fixtures'
import { DAY_MS } from './delegation'
import { utcDay, utcDayStart } from './statsDays'
import { createHistorySync } from './sync'
import { makeWire } from './wires'

afterEach(() => vi.useRealTimers())

it('negotiates signed stats through digests and filters expired data in all sync directions', async () => {
  const [sender, receiver] = await identities()
  const today = utcDayStart(Date.now())
  vi.setSystemTime(today)
  const catalog = await upsert(sender)
  const makeStats = (at: number) => makeWire(sender, {
    type: 'gdmw:stats', day: utcDay(at), updatedAt: at, views: { [PROJECT_ID]: 3 },
  })
  const [fresh, expiring] = await Promise.all([makeStats(today), makeStats(today - 89 * DAY_MS)])
  const expiredDigest = await makeWire(sender, {
    type: 'gdmw:sync-digest', keys: [expiring.signature, fresh.signature], statsDays: [expiring.day, fresh.day],
  })
  const expiredReply = await makeWire(sender, { type: 'gdmw:sync-records', records: [expiring, fresh] })
  vi.setSystemTime(today + DAY_MS)
  const isPeer = () => true
  const has = () => false
  const send = vi.fn()
  const sync = createHistorySync({ identity: sender, snapshot: () => [catalog, expiring, fresh], has, send, isPeer, receive: vi.fn() })
  await sync.announce('receiver')
  expect(send.mock.calls.map(([, wire]) => [wire.keys, wire.statsDays])).toEqual([
    [[catalog.signature], undefined], [[fresh.signature], [fresh.day]],
  ])

  const sendBack = vi.fn()
  const receive = vi.fn()
  const remote = createHistorySync({ identity: receiver, snapshot: () => [], has, send: sendBack, isPeer, receive })
  await remote.handle('sender', expiredDigest)
  expect(sendBack).toHaveBeenCalledExactlyOnceWith('sender', expect.objectContaining({
    type: 'gdmw:sync-want', keys: [fresh.signature],
  }))
  send.mockClear()
  const request = await makeWire(receiver, { type: 'gdmw:sync-want', keys: [expiring.signature, fresh.signature, catalog.signature] })
  await sync.handle('receiver', request)
  expect(send.mock.calls.map(([, wire]) => wire.records)).toEqual([[catalog], [fresh]])
  await remote.handle('sender', expiredReply)
  expect(receive).toHaveBeenCalledExactlyOnceWith([fresh], false)
})
