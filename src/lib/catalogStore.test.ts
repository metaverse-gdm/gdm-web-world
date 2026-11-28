import { beforeAll, describe, expect, it } from 'vitest'
import type { DidIdentity } from '../crypto/didIdentity'
import { approve, identities, PROJECT_ID, remove, revoke, upsert } from '../test/fixtures'
import { createRecordStore, deriveCatalog, editOrder, mergeRecords, projectGroup } from './catalogStore'
import { makeWire, readRecord } from './wires'
import type { CatalogPayload, CatalogRecord, PolicyRecord } from './wires'

let root: DidIdentity, owner: DidIdentity, other: DidIdentity, admin: DidIdentity, stranger: DidIdentity
let policy: PolicyRecord[]
beforeAll(async () => {
  [root, owner, other, admin, stranger] = await identities()
  policy = await Promise.all([approve(root, owner, 'member', 2), approve(root, other, 'member', 3), approve(root, admin, 'admin', 4)])
})
const view = (records: CatalogRecord[], now = 100) => deriveCatalog([...records, ...policy], [root.did], now)

const GROUP_ID = '190b17ef-7ad2-43e4-b374-351e89cc5c45'
const OTHER_GROUP_ID = '190b17ef-7ad2-43e4-b374-351e89cc5c46'
type GroupUpsert = Extract<CatalogPayload, { type: 'gdmw:group-upsert' }>
const groupUpsert = (from: DidIdentity, overrides: Partial<GroupUpsert> = {}) => makeWire(from, {
  type: 'gdmw:group-upsert', groupId: GROUP_ID, name: 'Train club', members: [],
  createdAt: 20, updatedAt: 20, rev: 1, ...overrides,
})
const groupDelete = (from: DidIdentity, deletedAt: number) =>
  makeWire(from, { type: 'gdmw:group-delete', groupId: GROUP_ID, deletedAt })
const membership = (from: DidIdentity, joined: boolean, updatedAt: number, groupId = GROUP_ID) =>
  makeWire(from, { type: 'gdmw:group-membership', groupId, joined, updatedAt })

describe('catalog projection and signed union', () => {
  it('restores optional avatar CIDs from signed records and clears them with newer records', async () => {
    const avatarCid = 'A'.repeat(32)
    const [profile, group, clearedProfile, clearedGroup] = await Promise.all([
      makeWire(owner, { type: 'gdmw:profile', displayName: 'Owner', avatarCid, updatedAt: 20 }),
      groupUpsert(owner, { avatarCid }),
      makeWire(owner, { type: 'gdmw:profile', displayName: 'Owner', updatedAt: 25 }),
      groupUpsert(owner, { updatedAt: 25, rev: 2 }),
    ])
    const store = createRecordStore<CatalogRecord>()
    const restore = (records: CatalogRecord[]) => records.map(record => readRecord(JSON.parse(JSON.stringify(record))) as CatalogRecord)
    store.merge(restore([profile, group]))
    expect(view(store.get()).profiles.get(owner.did)?.avatarCid).toBe(avatarCid)
    expect(view(store.get()).groups.get(GROUP_ID)?.record.avatarCid).toBe(avatarCid)
    store.merge(restore([clearedProfile, clearedGroup]))
    expect(view(store.get()).profiles.get(owner.did)?.avatarCid).toBeUndefined()
    expect(view(store.get()).groups.get(GROUP_ID)?.record.avatarCid).toBeUndefined()
  })
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

describe('group catalog projection', () => {
  it('shows a member-owned group with the owner first and only once', async () => {
    const [initial, joined] = await Promise.all([
      groupUpsert(owner, { members: [other.did, owner.did, admin.did] }), membership(other, true, 25),
    ])
    expect(view([initial, joined]).groups.get(GROUP_ID)).toMatchObject({
      record: initial, owner: owner.did, members: [owner.did, other.did], invited: [admin.did],
    })
  })

  it('ignores an unapproved person\'s claim even when it has the earliest creation time', async () => {
    const [initial, unapproved] = await Promise.all([
      groupUpsert(owner), groupUpsert(stranger, { createdAt: 10, updatedAt: 10 }),
    ])
    expect(view([unapproved]).groups.size).toBe(0)
    expect(view([unapproved, initial]).groups.get(GROUP_ID)?.record).toEqual(initial)
  })

  it('moves an invitee into members on acceptance and into declined on leaving', async () => {
    const [initial, joined, left] = await Promise.all([
      groupUpsert(owner, { members: [other.did] }), membership(other, true, 25), membership(other, false, 30),
    ])
    expect(view([initial]).groups.get(GROUP_ID)).toMatchObject({ members: [owner.did], invited: [other.did], declined: [] })
    expect(view([initial, joined]).groups.get(GROUP_ID)).toMatchObject({ members: [owner.did, other.did], invited: [] })
    const departed = { members: [owner.did], invited: [], declined: [other.did] }
    expect(view([initial, joined, left]).groups.get(GROUP_ID)).toMatchObject(departed)
    expect(view([left, joined, initial]).groups.get(GROUP_ID)).toMatchObject(departed)
  })

  it('breaks membership timestamp ties by signature regardless of arrival order', async () => {
    const [initial, joined, left] = await Promise.all([
      groupUpsert(owner, { members: [other.did] }), membership(other, true, 25), membership(other, false, 25),
    ])
    const expected = joined.signature > left.signature ? [owner.did, other.did] : [owner.did]
    expect(view([initial, joined, left]).groups.get(GROUP_ID)?.members).toEqual(expected)
    expect(view([initial, left, joined]).groups.get(GROUP_ID)?.members).toEqual(expected)
  })

  it('requires an invitation and isolates membership records by group and person', async () => {
    const [initial, otherGroup, joinedElsewhere, uninvitedJoin] = await Promise.all([
      groupUpsert(owner, { members: [other.did] }),
      groupUpsert(owner, { groupId: OTHER_GROUP_ID, members: [other.did] }),
      membership(other, true, 25, OTHER_GROUP_ID), membership(admin, true, 30),
    ])
    const groups = view([initial, otherGroup, joinedElsewhere, uninvitedJoin]).groups
    expect(groups.get(GROUP_ID)).toMatchObject({ members: [owner.did], invited: [other.did] })
    expect(groups.get(OTHER_GROUP_ID)).toMatchObject({ members: [owner.did, other.did], invited: [] })
  })

  it('drops both accepted and invited people without a current role', async () => {
    const [initial, joined, unapprovedJoin, memberLoss, inviteeLoss] = await Promise.all([
      groupUpsert(owner, { members: [other.did, admin.did, stranger.did] }), membership(other, true, 25),
      membership(stranger, true, 25), revoke(root, other, 40), revoke(root, admin, 40),
    ])
    const records = [initial, joined, unapprovedJoin, memberLoss, inviteeLoss]
    expect(view(records, 39).groups.get(GROUP_ID)).toMatchObject({ members: [owner.did, other.did], invited: [admin.did] })
    expect(view(records).groups.get(GROUP_ID)).toMatchObject({ members: [owner.did], invited: [] })
  })

  it('ignores foreign edits and owner edits with a different creation timestamp', async () => {
    const [initial, foreignEdit, wrongCreation] = await Promise.all([
      groupUpsert(owner), groupUpsert(other, { updatedAt: 90, rev: 9, name: 'Foreign edit' }),
      groupUpsert(owner, { createdAt: 21, updatedAt: 95, rev: 10, name: 'Wrong creation' }),
    ])
    expect(view([foreignEdit, wrongCreation, initial]).groups.get(GROUP_ID)?.record).toEqual(initial)
  })

  it('holds owner edits until the claim arrives and orders them by updatedAt, rev and signature', async () => {
    const [initial, older, lowerRev, a, b] = await Promise.all([
      groupUpsert(owner), groupUpsert(owner, { updatedAt: 25, rev: 9 }),
      groupUpsert(owner, { updatedAt: 26, rev: 4 }),
      groupUpsert(owner, { updatedAt: 26, rev: 5, name: 'A' }),
      groupUpsert(owner, { updatedAt: 26, rev: 5, name: 'B' }),
    ])
    const winner = a.signature > b.signature ? a : b
    const edits = [older, lowerRev, a, b]
    expect(view(edits).groups.size).toBe(0)
    expect(view([...edits, initial]).groups.get(GROUP_ID)?.record).toEqual(winner)
    expect(view([initial, ...edits.reverse()]).groups.get(GROUP_ID)?.record).toEqual(winner)
  })

  it('lets the owner and admin delete a group but not another member', async () => {
    const [initial, joined, ownerDelete, adminDelete, memberDelete, strangerDelete] = await Promise.all([
      groupUpsert(owner, { members: [other.did] }), membership(other, true, 25),
      groupDelete(owner, 20), groupDelete(admin, 30), groupDelete(other, 40), groupDelete(stranger, 50),
    ])
    expect(view([initial, joined, memberDelete, strangerDelete]).groups.get(GROUP_ID)).toMatchObject({
      record: initial, members: [owner.did, other.did],
    })
    expect(view([initial, ownerDelete]).groups.has(GROUP_ID)).toBe(false)
    expect(view([initial, adminDelete]).groups.has(GROUP_ID)).toBe(false)
  })

  it('retains admin tombstones after revocation and owner tombstones after reapproval but lets newer edits survive', async () => {
    const [initial, ownerDelete, adminDelete, edit, adminLoss, ownerLoss, renewal] = await Promise.all([
      groupUpsert(owner), groupDelete(owner, 30), groupDelete(admin, 30),
      groupUpsert(owner, { updatedAt: 31, rev: 2 }), revoke(root, admin, 40),
      revoke(root, owner, 40), approve(root, owner, 'member', 80),
    ])
    expect(view([initial, adminDelete, adminLoss]).groups.has(GROUP_ID)).toBe(false)
    expect(view([initial, adminDelete, adminLoss, edit]).groups.get(GROUP_ID)?.record).toEqual(edit)
    expect(view([ownerDelete, initial, ownerLoss, renewal]).groups.has(GROUP_ID)).toBe(false)
    expect(view([ownerDelete, initial, ownerLoss, renewal, edit]).groups.get(GROUP_ID)?.record).toEqual(edit)
  })

  it('resolves rev-1 claims by earliest creation time and then by person DID', async () => {
    const [initial, later, tied] = await Promise.all([
      groupUpsert(owner, { updatedAt: 35 }), groupUpsert(other, { createdAt: 25, updatedAt: 25 }), groupUpsert(other),
    ])
    expect(view([later, initial]).groups.get(GROUP_ID)?.record).toEqual(initial)
    expect(view([initial, later]).groups.get(GROUP_ID)?.record).toEqual(initial)
    const winner = owner.did < other.did ? initial : tied
    expect(view([initial, tied]).groups.get(GROUP_ID)?.record).toEqual(winner)
    expect(view([tied, initial]).groups.get(GROUP_ID)?.record).toEqual(winner)
  })

  it('hides a revoked owner\'s group without transferring their historical claim', async () => {
    const [initial, contender, loss, renewal] = await Promise.all([
      groupUpsert(owner), groupUpsert(other, { createdAt: 25, updatedAt: 25 }),
      revoke(root, owner, 40), approve(root, owner, 'member', 80),
    ])
    expect(view([initial, contender, loss]).groups.has(GROUP_ID)).toBe(false)
    expect(view([initial, contender, loss, renewal]).groups.get(GROUP_ID)?.record).toEqual(initial)
  })

  it('associates projects with visible groups only while their authors are current members', async () => {
    const [initial, joined, left, lostRole, deletion, memberProject, ownerProject, nonMemberProject, standalone, missingGroup] = await Promise.all([
      groupUpsert(owner, { members: [other.did] }), membership(other, true, 25), membership(other, false, 30),
      revoke(root, other, 40), groupDelete(owner, 40), upsert(other, { groupId: GROUP_ID }),
      upsert(owner, { groupId: GROUP_ID }), upsert(admin, { groupId: GROUP_ID }), upsert(owner),
      upsert(owner, { groupId: OTHER_GROUP_ID }),
    ])
    const pending = view([initial])
    expect(projectGroup(pending, memberProject)).toBeUndefined()
    expect(projectGroup(pending, ownerProject)).toBe(pending.groups.get(GROUP_ID))
    const accepted = view([initial, joined])
    expect(projectGroup(accepted, memberProject)).toBe(accepted.groups.get(GROUP_ID))
    expect(projectGroup(accepted, nonMemberProject)).toBeUndefined()
    expect(projectGroup(accepted, standalone)).toBeUndefined()
    expect(projectGroup(accepted, missingGroup)).toBeUndefined()
    expect(projectGroup(view([initial, joined, left]), memberProject)).toBeUndefined()
    expect(projectGroup(view([initial, joined, lostRole]), memberProject)).toBeUndefined()
    expect(projectGroup(view([initial, joined, deletion]), ownerProject)).toBeUndefined()
  })
})
