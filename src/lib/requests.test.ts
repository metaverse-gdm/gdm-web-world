import { beforeEach, expect, it } from 'vitest'
import { identities } from '../test/fixtures'
import { createRequestStore, pendingRequests } from './requests'
import { makeWire, REQUEST_INTERVAL_MS } from './wires'
import type { Role } from './wires'

beforeEach(() => localStorage.clear())

it('limits live requests per signer and compacts replays by signed timestamp', async () => {
  const [author] = await identities()
  const base = { type: 'gdmw:approval-request', displayName: '申請者', message: '' } as const
  const first = await makeWire(author, { ...base, requestedAt: 1000 })
  const next = await makeWire(author, { ...base, requestedAt: 2000 })
  const store = createRequestStore()
  store.merge([first], true, 1000)
  store.merge([next], true, 2000)
  expect(store.latest(author.did)).toEqual(first)
  store.merge([next, first], false, REQUEST_INTERVAL_MS)
  expect(store.get()).toEqual([next])
  expect(createRequestStore().get()).toEqual([next])
})

it('shows a decision only when it matches the request and an admin signed it', async () => {
  const [author, admin, stranger] = await identities()
  const ask = await makeWire(author, { type: 'gdmw:approval-request', displayName: '申請者', message: 'hello', requestedAt: 10 })
  const body = { type: 'gdmw:request-reject', subject: author.did, requestSignature: ask.signature, rejectedAt: 12 } as const
  const roles = new Map<string, Role | null>([[admin.did, 'admin']])
  const spoof = await makeWire(stranger, body)
  const reject = await makeWire(admin, body)
  expect(pendingRequests([ask, spoof], [], roles)).toEqual([ask])
  expect(pendingRequests([ask, spoof, reject], [], roles)).toEqual([])
})
