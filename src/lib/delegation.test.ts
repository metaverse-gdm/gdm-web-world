import {
  clearDelegation, resolveWireSender, saveDelegation, signDelegation, signWireWithDelegation, verifyDelegation,
} from '@tik-choco/mistai/identity'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { GLOBAL_ROOM_ID } from '../config'
import type { DidIdentity } from '../crypto/didIdentity'
import { approve, identities, PROJECT_ID, projectFields, remove, revoke, upsert } from '../test/fixtures'
import { deriveCatalog } from './catalogStore'
import { CLOCK_SKEW_MS, DAY_MS, verifyDelegationSync } from './delegation'
import { createRequestStore, pendingRequests } from './requests'
import { parseCatalogSnapshot } from './vault/catalogAdapter'
import { makeWire, personId, readRecord, readWire } from './wires'

let admin: DidIdentity, root: DidIdentity, a: DidIdentity, b: DidIdentity, stranger: DidIdentity
beforeAll(async () => { [admin, root, a, b, stranger] = await identities() })
afterEach(() => { clearDelegation(); localStorage.clear() })

function fields(signer: DidIdentity, at: number) {
  return {
    ...projectFields, v: 1, roomId: GLOBAL_ROOM_ID, type: 'gdmw:project-upsert', fromId: signer.did,
    projectId: PROJECT_ID, createdAt: at, updatedAt: at, rev: 1,
  }
}

it('attaches the current delegation before signing, and detects replacement or stripping', async () => {
  const now = Date.now()
  const delegation = await signDelegation(root, a.did, { now })
  saveDelegation(delegation)
  const wire = await upsert(a, { createdAt: now, updatedAt: now })
  expect(wire.delegation).toEqual(delegation)
  expect(personId(wire)).toBe(root.did)
  await expect(resolveWireSender(wire, { now })).resolves.toMatchObject({ id: root.did, leaf: a.did })
  expect(readWire({ ...wire, delegation: { ...delegation, exp: delegation.iat } })).toBeUndefined()
  expect(readWire({ ...wire, delegation: undefined })).toBeUndefined()

  saveDelegation(await signDelegation(root, a.did, { now: now - 2 * DAY_MS, ttlMs: DAY_MS }))
  expect((await upsert(a, { createdAt: now, updatedAt: now })).delegation).toBeUndefined()
  saveDelegation(delegation)
  expect((await upsert(b, { createdAt: now, updatedAt: now })).delegation).toBeUndefined()
})

it('resolves every replay using the signed timestamp and rejects far-future records', async () => {
  const start = Date.now() - 10 * DAY_MS
  const delegation = await signDelegation(root, a.did, { now: start, ttlMs: DAY_MS })
  const wire = await signWireWithDelegation(fields(a, start + 100), a, delegation)
  expect(await verifyDelegation(delegation, { leaf: a.did })).toBe(false)
  const parsed = readRecord(wire)
  expect(parsed && personId(parsed)).toBe(root.did)
  const [restored] = parseCatalogSnapshot({ v: 1, records: [wire] }).records
  expect(personId(restored)).toBe(root.did)

  const now = Date.now()
  const edge = await signWireWithDelegation(fields(a, now + CLOCK_SKEW_MS), a)
  const future = await signWireWithDelegation(fields(a, now + CLOCK_SKEW_MS + 1000), a)
  expect(readRecord(edge, now)).toBeDefined()
  expect(readWire(future, now)).toBeUndefined()
  expect(parseCatalogSnapshot({ v: 1, records: [future] }).records).toEqual([])
})

it.each([
  { name: 'valid', offset: 0, valid: true },
  { name: 'tampered', offset: 0, tampered: true, valid: false },
  { name: 'expired at record time', offset: DAY_MS + CLOCK_SKEW_MS + 1, valid: false },
  { name: 'self-delegation', offset: 0, self: true, valid: false },
  { name: '400-day duration', offset: 0, ttlMs: 400 * DAY_MS, valid: true },
  { name: 'over 400 days', offset: 0, ttlMs: 400 * DAY_MS + 1, valid: false },
  { name: 'early skew boundary', offset: -CLOCK_SKEW_MS, valid: true },
  { name: 'before early skew boundary', offset: -CLOCK_SKEW_MS - 1, valid: false },
  { name: 'late skew boundary', offset: DAY_MS + CLOCK_SKEW_MS, valid: true },
  { name: 'leaf mismatch', offset: 0, mismatch: true, valid: false },
])('matches mistai during synchronous vault restore ($name)', async ({ offset, valid, ttlMs = DAY_MS, ...variant }) => {
  const start = Date.now() - 420 * DAY_MS
  const signer = variant.self ? root : a
  const delegation = await signDelegation(root, variant.mismatch ? b.did : signer.did, { now: start, ttlMs })
  if (variant.tampered) delegation.exp = new Date(start + ttlMs - 1).toISOString()
  const now = start + offset
  const asyncResult = await verifyDelegation(delegation, { leaf: signer.did, now })
  expect(asyncResult).toBe(valid)
  expect(verifyDelegationSync(delegation, signer.did, now)).toBe(asyncResult)
  const wire = await signWireWithDelegation(fields(signer, now), signer, delegation)
  const [restored] = parseCatalogSnapshot({ v: 1, records: [wire] }).records
  expect(restored).toBeDefined()
  expect(personId(restored)).toBe(valid ? root.did : signer.did)
})

it('keeps a correctly signed wire when the delegation has a foreign shape', async () => {
  const raw = await signWireWithDelegation({ ...fields(a, Date.now()), delegation: { unexpected: true } }, a)
  const parsed = readRecord(raw)
  expect(parsed && personId(parsed)).toBe(a.did)
})

it('applies grants and revocations for a person across both leaves, including a delegated root admin issuer', async () => {
  const now = Date.now()
  saveDelegation(await signDelegation(admin, stranger.did, { now }))
  const grant = await approve(stranger, root, 'member', now)
  expect(personId(grant)).toBe(admin.did)
  const projects = []
  for (const leaf of [a, b]) {
    saveDelegation(await signDelegation(root, leaf.did, { now }))
    projects.push(await upsert(leaf, {
      projectId: crypto.randomUUID(), createdAt: now + 1, updatedAt: now + 1,
    }))
  }
  const records = [grant, ...projects]
  const catalog = deriveCatalog(records, [admin.did], now + 2)
  expect(catalog.roles.get(root.did)).toBe('member')
  expect(catalog.projects.size).toBe(2)
  const revoked = await revoke(admin, root, now + 3)
  const after = deriveCatalog([...records, revoked], [admin.did], now + 4)
  expect(after.projects.size).toBe(0)
  expect(after.owners.size).toBe(2)
})

it('merges profiles from paired leaves under the person DID using their signed timestamps', async () => {
  const now = Date.now()
  saveDelegation(await signDelegation(root, a.did, { now }))
  const first = await makeWire(a, { type: 'gdmw:profile', displayName: 'Before', updatedAt: now })
  saveDelegation(await signDelegation(root, b.did, { now }))
  const second = await makeWire(b, { type: 'gdmw:profile', displayName: 'After', updatedAt: now + 1 })
  const catalog = deriveCatalog([second, first], [root.did], now + 1)
  expect([...catalog.profiles]).toEqual([[root.did, second]])
})

it('lets a second leaf of the same person edit and delete, while an approved stranger cannot', async () => {
  const now = Date.now()
  const grant = await approve(admin, root, 'member', now)
  const strangerGrant = await approve(admin, stranger, 'member', now)
  saveDelegation(await signDelegation(root, a.did, { now }))
  const original = await upsert(a, { createdAt: now, updatedAt: now })
  saveDelegation(await signDelegation(root, b.did, { now }))
  const edit = await upsert(b, { createdAt: now, updatedAt: now + 1, rev: 2, title: 'Second browser' })
  const impostor = await upsert(stranger, { createdAt: now, updatedAt: now + 2, rev: 3, title: 'Stranger' })
  const invalidDelete = await remove(stranger, now + 3)
  const records = [grant, strangerGrant, original, edit, impostor, invalidDelete]
  expect(deriveCatalog(records, [admin.did], now + 4).projects.get(PROJECT_ID)).toEqual(edit)
  const deleted = await remove(b, now + 4)
  expect(deriveCatalog([...records, deleted], [admin.did], now + 4).projects.has(PROJECT_ID)).toBe(false)
})

it('dedupes requests by person across leaves and matches decisions by person', async () => {
  const now = Date.now()
  const payload = { type: 'gdmw:approval-request', displayName: 'Pair', message: '' } as const
  saveDelegation(await signDelegation(root, a.did, { now }))
  const first = await makeWire(a, { ...payload, requestedAt: now })
  saveDelegation(await signDelegation(root, b.did, { now }))
  const second = await makeWire(b, { ...payload, requestedAt: now + 1 })
  const requests = createRequestStore()
  requests.merge([first], true, now)
  requests.merge([second], true, now + 1)
  expect(requests.latest(root.did)).toEqual(first)
  requests.merge([second], false)
  expect(requests.get()).toEqual([second])
  const roles = new Map([[admin.did, 'admin']] as const)
  expect(pendingRequests(requests.get(), [], roles)).toEqual([second])
  saveDelegation(await signDelegation(admin, stranger.did, { now }))
  requests.merge([await makeWire(stranger, {
    type: 'gdmw:request-reject', subject: root.did, requestSignature: second.signature, rejectedAt: now + 2,
  })])
  expect(pendingRequests(requests.get(), [], roles)).toEqual([])
})
