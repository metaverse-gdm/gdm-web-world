import { beforeAll, describe, expect, it } from 'vitest'
import type { DidIdentity } from '../crypto/didIdentity'
import { approve, identities, revoke } from '../test/fixtures'
import { computeAuthorizations } from './authz'
import { readRecord } from './wires'
import type { PolicyRecord } from './wires'

let root: DidIdentity, a: DidIdentity, b: DidIdentity, c: DidIdentity, outsider: DidIdentity
beforeAll(async () => { [root, a, b, c, outsider] = await identities() })
const roles = (records: PolicyRecord[], now = 100) => computeAuthorizations(records, [root.did], now)

describe('current DID authorization', () => {
  it('uses rooted chains independently of record order and issuer grant time', async () => {
    const records = await Promise.all([approve(b, c, 'member', 5), approve(a, b, 'admin', 10), approve(root, a, 'admin', 30)])
    expect(roles(records).get(root.did)).toBe('admin')
    expect(roles(records).get(a.did)).toBe('admin')
    expect(roles(records).get(b.did)).toBe('admin')
    expect(roles([...records].reverse()).get(c.did)).toBe('member')
  })
  it('revokes roles and cuts off subordinate grants, then allows renewed approval', async () => {
    const records = await Promise.all([approve(root, a, 'admin', 5), approve(a, b, 'member', 10), revoke(root, a, 15)])
    expect(roles(records).get(a.did)).toBeNull()
    expect(roles(records).get(b.did)).toBeNull()
    expect(roles([...records, await approve(root, a, 'admin', 20)]).get(b.did)).toBe('member')
  })
  it('uses latest events between delegated issuers and lets revocation win ties', async () => {
    const records = await Promise.all([approve(root, a, 'admin', 1), approve(root, b, 'admin', 1),
      approve(a, c, 'member', 7), revoke(b, c, 7)])
    expect(roles(records).get(c.did)).toBeNull()
    expect(roles([...records, await approve(b, c, 'member', 8)]).get(c.did)).toBe('member')
  })
  it('gives direct root decisions priority over newer delegated ones', async () => {
    const records = await Promise.all([approve(root, a, 'admin', 1), approve(root, b, 'member', 2),
      revoke(a, root, 10), revoke(a, b, 50), revoke(root, c, 3), approve(a, c, 'member', 99)])
    expect(roles(records).get(root.did)).toBe('admin')
    expect(roles(records).get(b.did)).toBe('member')
    expect(roles(records).get(c.did)).toBeNull()
  })
  it('does not resurrect older grants when the winning approval expires', async () => {
    const records = await Promise.all([approve(root, a, 'admin', 1), approve(root, a, 'admin', 2, 10), approve(a, b, 'member', 3)])
    expect(roles(records, 9).get(b.did)).toBe('member')
    expect(roles(records, 10).get(a.did)).toBeNull()
    expect(roles(records, 10).get(b.did)).toBeNull()
  })
  it('ignores future events until their signed timestamp', async () => {
    const records = [await approve(root, a, 'admin', 20)]
    expect(roles(records, 19).get(a.did)).toBeNull()
    expect(roles(records, 20).get(a.did)).toBe('admin')
  })
  it('ignores unknown issuers and members as grant issuers', async () => {
    const records = await Promise.all([approve(root, a, 'member', 1), approve(a, b, 'admin', 5), approve(outsider, c, 'admin', 6)])
    expect(roles(records).get(b.did)).toBeNull()
    expect(roles(records).get(c.did)).toBeNull()
  })
  it('rejects unrooted self- and mutual-approval cycles', async () => {
    const records = await Promise.all([approve(a, b, 'admin', 1), approve(b, a, 'admin', 2), approve(c, c, 'admin', 3)])
    expect([...roles(records).values()].filter(role => role === 'admin')).toEqual(['admin'])
  })
  it('does not let circular winning grants confer authority', async () => {
    const records = await Promise.all([approve(root, a, 'admin', 1), approve(a, b, 'admin', 2),
      approve(b, c, 'admin', 3), approve(c, b, 'admin', 4)])
    expect(roles(records).get(a.did)).toBe('admin')
    expect(roles(records).get(b.did)).toBeNull()
    expect(roles(records).get(c.did)).toBeNull()
  })
  it('fails closed for a delegated revocation that would remove its own authority', async () => {
    const records = await Promise.all([approve(root, a, 'admin', 1), approve(a, b, 'admin', 2),
      approve(b, c, 'admin', 3), revoke(c, b, 4)])
    expect(roles(records).get(a.did)).toBe('admin')
    expect(roles(records).get(c.did)).toBeNull()
  })
  it('drops forged signature before computing authorizations', async () => {
    const grant = await approve(root, a, 'member', 2)
    const tampered = readRecord({ ...grant, role: 'admin' })
    expect(tampered).toBeUndefined()
    expect(roles([grant]).get(a.did)).toBe('member')
  })
})
