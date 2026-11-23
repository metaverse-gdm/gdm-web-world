import { beforeAll, describe, expect, it } from 'vitest'
import type { DidIdentity } from '../crypto/didIdentity'
import { approve, identities, PROJECT_ID, remove, revoke, upsert } from '../test/fixtures'
import { deriveCatalog, editOrder, mergeRecords } from './catalogStore'
import { makeWire } from './wires'
import type { CatalogRecord, PolicyRecord } from './wires'

let root: DidIdentity, owner: DidIdentity, other: DidIdentity, admin: DidIdentity, stranger: DidIdentity
let policy: PolicyRecord[]
beforeAll(async () => {
  [root, owner, other, admin, stranger] = await identities()
  policy = await Promise.all([approve(root, owner, 'member', 2), approve(root, other, 'member', 3), approve(root, admin, 'admin', 4)])
})
const view = (records: CatalogRecord[], now = 100) => deriveCatalog([...records, ...policy], [root.did], now)

describe('catalog projection and signed union', () => {
  it('chooses a profile by updatedAt and signature and only exposes currently approved people', async () => {
    const profile = (from: DidIdentity, displayName: string, updatedAt: number) =>
      makeWire(from, { type: 'gdmw:profile', displayName, updatedAt })
    const [old, first, second, unapproved, loss, renewal] = await Promise.all([
      profile(owner, 'Old name', 10), profile(owner, 'First name', 20), profile(owner, 'Second name', 20),
      profile(stranger, 'Unapproved name', 30), revoke(root, owner, 40), approve(root, owner, 'member', 60),
    ])
    const profiles = [old, first, second, unapproved]
    const winner = first.signature > second.signature ? first : second
    expect(view(profiles).profiles.get(owner.did)).toEqual(winner)
    expect(view([...profiles].reverse()).profiles.get(owner.did)).toEqual(winner)
    expect(view(profiles).profiles.has(stranger.did)).toBe(false)
    expect(view([...profiles, loss]).profiles.has(owner.did)).toBe(false)
    expect(view([...profiles, loss, renewal]).profiles.get(owner.did)).toEqual(winner)
  })
  it('applies LWW by updatedAt, rev and signature', async () => {
    const records = await Promise.all([upsert(owner), upsert(owner, { updatedAt: 25, rev: 9 }),
      upsert(owner, { updatedAt: 26, rev: 4 }), upsert(owner, { updatedAt: 26, rev: 5, title: 'A' }),
      upsert(owner, { updatedAt: 26, rev: 5, title: 'B' })])
    const expected = [...records].sort(editOrder).at(-1)
    expect(view(records).projects.get(PROJECT_ID)).toEqual(expected)
    expect(view([...records].reverse()).projects.get(PROJECT_ID)).toEqual(expected)
  })
  it('rejects foreign edits even from an approved member', async () => {
    const [author, impostor] = owner.did < other.did ? [other, owner] : [owner, other]
    const [initial, edit] = await Promise.all([upsert(author), upsert(impostor, { updatedAt: 90, rev: 9 })])
    expect(view([edit, initial]).projects.get(PROJECT_ID)).toEqual(initial)
  })
  it('holds edits received before the signed creation without granting ownership', async () => {
    const [initial, edit] = await Promise.all([upsert(owner), upsert(owner, { updatedAt: 25, rev: 2 })])
    expect(view([edit]).owners.size).toBe(0)
    expect(view([edit, initial]).projects.get(PROJECT_ID)).toEqual(edit)
  })
  it('deterministically settles ties for project creation', async () => {
    const [a, b] = await Promise.all([upsert(owner), upsert(other)])
    expect(view([a, b]).projects.get(PROJECT_ID)).toEqual(a.fromId < b.fromId ? a : b)
    expect(view([a, b]).projects).toEqual(view([b, a]).projects)
  })
  it('ignores unauthorised claims and deletes', async () => {
    const [initial, fake, outsiderDelete, memberDelete] = await Promise.all([
      upsert(owner), upsert(stranger, { createdAt: 1, updatedAt: 99, rev: 9 }), remove(stranger, 98), remove(other, 97),
    ])
    expect(view([fake]).projects.size).toBe(0)
    expect(view([fake, outsiderDelete, memberDelete, initial]).projects.get(PROJECT_ID)).toEqual(initial)
  })
  it('lets admins moderate and keeps an authorized historical moderation tombstone', async () => {
    const [initial, deletion, loss] = await Promise.all([upsert(owner), remove(admin, 35), revoke(root, admin, 40)])
    expect(view([initial, deletion], 39).projects.size).toBe(0)
    expect(view([initial, deletion, loss]).projects.size).toBe(0)
    expect(view([initial, deletion, loss]).tombstones.get(PROJECT_ID)).toEqual(deletion)
  })
  it('keeps pending tombstones until an upsert arrives', async () => {
    const [initial, deletion] = await Promise.all([upsert(owner), remove(owner, 20)])
    expect(view([deletion]).tombstones.get(PROJECT_ID)).toEqual(deletion)
    expect(view([deletion, initial]).projects.size).toBe(0)
    const newEdit = await upsert(owner, { updatedAt: 21, rev: 2 })
    expect(view([deletion, initial, newEdit]).projects.get(PROJECT_ID)).toEqual(newEdit)
  })
  it('hides projects after revocation, keeps ownership and shows them after reapproval', async () => {
    const [initial, contender, loss, renewal] = await Promise.all([
      upsert(owner), upsert(other, { createdAt: 25, updatedAt: 30 }), revoke(root, owner, 40), approve(root, owner, 'member', 80),
    ])
    expect(view([initial, contender, loss]).owners.get(PROJECT_ID)?.fromId).toBe(owner.did)
    expect(view([initial, contender, loss]).projects.size).toBe(0)
    expect(view([initial, contender, loss, renewal]).projects.get(PROJECT_ID)).toEqual(initial)
  })
  it('merges idempotently, commutatively and associatively without dropping evidence', async () => {
    const [initial, edit, deletion] = await Promise.all([upsert(owner), upsert(owner, { updatedAt: 30, rev: 2 }), remove(admin, 40)])
    const a = [initial, edit], b = [deletion, edit], c = policy
    expect(mergeRecords(a, a)).toEqual(mergeRecords([], a))
    expect(mergeRecords<CatalogRecord>(a, b)).toEqual(mergeRecords<CatalogRecord>(b, a))
    expect(mergeRecords<CatalogRecord>(mergeRecords<CatalogRecord>(a, b), c))
      .toEqual(mergeRecords<CatalogRecord>(a, mergeRecords<CatalogRecord>(b, c)))
  })
})
