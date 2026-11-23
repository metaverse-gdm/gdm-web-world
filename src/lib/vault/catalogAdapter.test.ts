import { expect, it } from 'vitest'
import { identities, upsert } from '../../test/fixtures'
import { createRecordStore } from '../catalogStore'
import { makeWire } from '../wires'
import type { CatalogRecord } from '../wires'
import { createCatalogAdapter, parseCatalogSnapshot } from './catalogAdapter'

it('rejects malformed checkpoint envelopes', () => {
  for (const raw of [null, { v: 2, records: [] }, { v: 1, records: {} }, { v: 1, records: [], extra: 1 }]) {
    expect(() => parseCatalogSnapshot(raw)).toThrow('Invalid catalog checkpoint envelope')
  }
})

it('drops forged signatures, invalid shapes and request records while restoring valid signed records', async () => {
  const [author, peer] = await identities()
  const original = await upsert(author)
  const request = await makeWire(peer, { type: 'gdmw:approval-request', displayName: '申請者', message: '', requestedAt: 25 })
  const malicious = { ...original, title: 'Forged' }
  const another = await upsert(peer, { title: 'Valid second' })
  const profile = await makeWire(author, { type: 'gdmw:profile', displayName: 'Author', updatedAt: 30 })
  const forgedProfile = { ...profile, displayName: 'Forged' }
  expect(parseCatalogSnapshot({ v: 1, records: [malicious, original, original, request, null, another, profile, forgedProfile] }).records)
    .toEqual([original, another, profile].sort((a, b) => a.signature < b.signature ? -1 : 1))
})

it('unions with edits received between the vault snapshot and apply', async () => {
  const [author] = await identities()
  const old = await upsert(author)
  const newer = await upsert(author, { rev: 2, updatedAt: 50 })
  const source = createRecordStore<CatalogRecord>()
  const adapter = createCatalogAdapter(source)
  const snapshot = await adapter.snapshot()
  source.merge([newer])
  await adapter.apply(adapter.merge(snapshot, adapter.parse({ v: 1, records: [old] })))
  expect(source.get()).toHaveLength(2)
  expect(source.get()).toContain(newer)
})
