import { expect, it, vi } from 'vitest'
import { identities, upsert } from '../test/fixtures'
import { createRecordStore } from './catalogStore'
import { attachMirror } from './mirror'
import { makeWire } from './wires'
import type { CatalogRecord } from './wires'

const snapshot = (records: readonly CatalogRecord[]) => JSON.stringify({ v: 1, records })

it('preserves an unreadable primary and unions later fallback writes', async () => {
  const [author] = await identities()
  const initial = await upsert(author)
  const edit = await upsert(author, { updatedAt: 21, rev: 2 })
  const primary = { read: vi.fn(async () => { throw new Error('OPFS unavailable') }), write: vi.fn(async () => {}) }
  const fallback = { read: vi.fn(async () => snapshot([initial])), write: vi.fn(async (_value: string) => { void _value }) }
  const store = createRecordStore<CatalogRecord>()
  const mirror = attachMirror(store, primary, fallback)
  try {
    await mirror.ready
    expect(store.get()).toEqual([initial])
    expect(fallback.write).not.toHaveBeenCalled()
    store.merge([edit])
    await mirror.drained()
    expect(primary.write).not.toHaveBeenCalled()
    expect(JSON.parse(fallback.write.mock.calls[0][0]).records).toEqual(expect.arrayContaining([initial, edit]))
  } finally { mirror.dispose() }
})

it('loads both replicas, then persists through OPFS', async () => {
  const [author] = await identities()
  const [initial, edit, latest, profile] = await Promise.all([upsert(author), upsert(author, { updatedAt: 21, rev: 2 }),
    upsert(author, { updatedAt: 22, rev: 3 }), makeWire(author, { type: 'gdmw:profile', displayName: 'Author', updatedAt: 24 })])
  const primary = { read: vi.fn(async () => snapshot([initial])), write: vi.fn(async (_value: string) => { void _value }) }
  const fallback = { read: vi.fn(async () => snapshot([edit, profile])), write: vi.fn(async () => {}) }
  const store = createRecordStore<CatalogRecord>()
  const mirror = attachMirror(store, primary, fallback)
  try {
    await mirror.ready
    expect(store.get()).toEqual(expect.arrayContaining([initial, edit, profile]))
    store.merge([latest])
    await mirror.drained()
    expect(JSON.parse(primary.write.mock.calls[0][0]).records).toEqual(expect.arrayContaining([initial, edit, latest, profile]))
    expect(fallback.write).not.toHaveBeenCalled()
  } finally { mirror.dispose() }
})
