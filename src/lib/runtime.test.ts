import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ROOT_ADMIN_DIDS } from '../config'
import { ensureDidIdentity } from '../crypto/didIdentity'
import { approve, identities, PROJECT_ID, revoke, upsert } from '../test/fixtures'
import { createLocalPreferences } from './localPreferences'
import { catalogReplica } from './mistClient'
import { createNetwork } from './network'
import { createRuntime } from './runtime'
import { utcDay } from './statsDays'
import { makeWire, readRecord } from './wires'
import type { Runtime } from './runtime'

vi.mock('../config', async importOriginal => ({
  ...await importOriginal<typeof import('../config')>(), ROOT_ADMIN_DIDS: [],
}))
vi.mock('./mistClient', () => ({
  identityBackend: undefined,
  catalogReplica: { read: vi.fn(), write: vi.fn() },
  opfsReplica: () => ({ read: async () => null, write: async () => {} }),
}))
vi.mock('./network', () => ({
  createNetwork: vi.fn(() => ({ start: vi.fn(), send: vi.fn(), isWriter: () => false, dispose: vi.fn() })),
}))
vi.mock('./vault/controllers', () => ({
  createSharedVault: () => ({ panel: {}, dispose: vi.fn() }),
}))

let runtime: Runtime | undefined
beforeEach(() => {
  localStorage.clear()
  ROOT_ADMIN_DIDS.length = 0
  vi.clearAllMocks()
  vi.mocked(catalogReplica.read).mockResolvedValue(null)
})
afterEach(() => { runtime?.dispose(); runtime = undefined })

const network = () => vi.mocked(createNetwork)
const receive = () => network().mock.calls.at(-1)![0].receive
const sent = () => vi.mocked(network().mock.results.at(-1)!.value.send)

it('publishes and updates a project without a URL as a signed catalog record', async () => {
  const [root] = await identities()
  ROOT_ADMIN_DIDS.push(root.did)
  const app = runtime = await createRuntime()
  receive()([await approve(root, app.identity, 'member', Date.now())], false)
  const fields = { title: 'Game', summary: 'Fun', description: '', tags: [] }
  const id = await app.saveProject(fields)
  const first = app.getCatalog().projects.get(id)!
  expect(first).not.toHaveProperty('url')
  expect(readRecord(JSON.parse(JSON.stringify(first)))).toEqual(first)
  await app.saveProject({ ...fields, url: 'https://example.com/game' }, id)
  expect(app.getCatalog().projects.get(id)?.url).toBe('https://example.com/game')
  await app.saveProject(fields, id)
  expect(app.getCatalog().projects.get(id)).toMatchObject({ rev: 3 })
  expect(app.getCatalog().projects.get(id)).not.toHaveProperty('url')
  await expect(app.saveProject({ ...fields, url: 'not a URL' }, id)).rejects.toThrow()
})

it('falls back to the latest retained request name for an approved person until a profile arrives', async () => {
  const [root, author] = await identities()
  ROOT_ADMIN_DIDS.push(root.did)
  runtime = await createRuntime()
  const request = await makeWire(author, { type: 'gdmw:approval-request', displayName: ' Team Sakura ', message: '', requestedAt: 10 })
  const grant = await makeWire(root, {
    type: 'gdmw:approval', subject: author.did, role: 'member', issuedAt: 11, requestSignature: request.signature,
  })
  receive()([request], false)
  expect(runtime.displayNameFor(author.did)).toBeUndefined()
  receive()([grant], false)
  expect(runtime.displayNameFor(author.did)).toBe('Team Sakura')
  const profile = await makeWire(author, { type: 'gdmw:profile', displayName: 'Sakura Studio', updatedAt: 12 })
  receive()([profile], false)
  expect(runtime.displayNameFor(author.did)).toBe('Sakura Studio')
  receive()([await revoke(root, author, 13)], false)
  expect(runtime.displayNameFor(author.did)).toBeUndefined()
})

it('uses the submitted approval name to publish once after a role is granted', async () => {
  const [root] = await identities()
  ROOT_ADMIN_DIDS.push(root.did)
  const app = runtime = await createRuntime()
  await expect(app.requestApproval(' Local name ', '')).resolves.toBe(true)
  expect(app.preferences.get().displayName?.value).toBe('Local name')
  expect(sent()).toHaveBeenCalledTimes(1)
  expect(sent()).toHaveBeenLastCalledWith(null, expect.objectContaining({ type: 'gdmw:approval-request', displayName: 'Local name' }))

  receive()([await approve(root, app.identity, 'member', Date.now())], false)
  await vi.waitFor(() => expect(app.getCatalog().profiles.get(app.identity.did)?.displayName).toBe('Local name'))
  expect(sent()).toHaveBeenCalledTimes(2)
  await app.saveDisplayName(' Local name ')
  expect(sent()).toHaveBeenCalledTimes(2)

  await app.saveDisplayName('Local edit')
  expect(app.displayNameFor(app.identity.did)).toBe('Local edit')
  expect(sent()).toHaveBeenLastCalledWith(null, expect.objectContaining({ type: 'gdmw:profile', displayName: 'Local edit' }))

  await expect(app.requestApproval('Already approved', '')).resolves.toBe(false)
  expect(sent()).toHaveBeenCalledTimes(4)
  expect(sent()).toHaveBeenLastCalledWith(null, expect.objectContaining({ type: 'gdmw:profile', displayName: 'Already approved' }))
})

it('waits for mirror restore before bootstrapping a profile on startup', async () => {
  const identity = await ensureDidIdentity()
  ROOT_ADMIN_DIDS.push(identity.did)
  createLocalPreferences().setName('Old local name')
  const profile = await makeWire(identity, { type: 'gdmw:profile', displayName: 'Current name', updatedAt: 12 })
  vi.mocked(catalogReplica.read).mockResolvedValue(JSON.stringify({ v: 1, records: [profile] }))
  const app = runtime = await createRuntime()
  await vi.waitFor(() => expect(app.displayNameFor(identity.did)).toBe('Current name'))
  await app.saveDisplayName('Current name')
  expect(sent()).not.toHaveBeenCalled()
})

it('publishes stats for a public viewer and exposes totals after they become an admin', async () => {
  const [root, author] = await identities()
  ROOT_ADMIN_DIDS.push(root.did)
  const app = runtime = await createRuntime()
  receive()([await approve(root, author, 'member', 10), await upsert(author)], false)
  expect(app.getProjectStats(PROJECT_ID)).toBeUndefined()
  app.trackProject(PROJECT_ID, 'detail')
  window.dispatchEvent(new Event('pagehide'))
  await vi.waitFor(() => expect(sent()).toHaveBeenCalledExactlyOnceWith(null, expect.objectContaining({
    type: 'gdmw:stats', views: { [PROJECT_ID]: 2 },
  })))
  const now = Date.now()
  const selfView = await makeWire(author, { type: 'gdmw:stats', day: utcDay(now), updatedAt: now, views: { [PROJECT_ID]: 7 } })
  receive()([selfView, await approve(root, app.identity, 'admin', now)], false)
  expect(app.getProjectStats(PROJECT_ID)?.month).toEqual({ impression: 0, detail: 1, click: 0 })
})

it('creates a group, lets an invitee join and post under it, and enforces ownership', async () => {
  const [root, friend, stranger] = await identities()
  ROOT_ADMIN_DIDS.push(root.did)
  const app = runtime = await createRuntime()
  await expect(app.saveGroup({ name: 'Circle', members: [] })).rejects.toThrow()
  const now = Date.now()
  receive()([
    await approve(root, app.identity, 'member', now), await approve(root, friend, 'member', now),
    await approve(root, stranger, 'member', now),
  ], false)
  const avatarCid = 'A'.repeat(32)
  const groupId = await app.saveGroup({ name: ' Circle ', bio: ' Hello ', avatarCid, members: [friend.did, app.identity.did] })
  const group = app.getCatalog().groups.get(groupId)!
  expect(group.record).toMatchObject({ name: 'Circle', bio: 'Hello', avatarCid, members: [friend.did], rev: 1 })
  expect(group).toMatchObject({ owner: app.identity.did, members: [app.identity.did], invited: [friend.did] })
  await expect(app.setGroupMembership(groupId, false)).rejects.toThrow()

  // The invitee accepts through a record signed by their own leaf.
  receive()([await makeWire(friend, { type: 'gdmw:group-membership', groupId, joined: true, updatedAt: Date.now() })], false)
  expect(app.getCatalog().groups.get(groupId)?.members).toEqual([app.identity.did, friend.did])

  const fields = { title: 'Game', summary: 'Fun', description: '', url: 'https://example.com/', tags: [] }
  const projectId = await app.saveProject({ ...fields, groupId })
  expect(app.groupFor(app.getCatalog().projects.get(projectId)!)?.record.groupId).toBe(groupId)
  await expect(app.saveProject({ ...fields, groupId: PROJECT_ID })).rejects.toThrow()

  const strangerGroup = await makeWire(stranger, {
    type: 'gdmw:group-upsert', groupId: PROJECT_ID, name: 'Other', members: [app.identity.did],
    createdAt: Date.now(), updatedAt: Date.now(), rev: 1,
  })
  receive()([strangerGroup], false)
  await expect(app.saveGroup({ name: 'Hijack', avatarCid, members: [] }, PROJECT_ID)).rejects.toThrow()
  await app.setGroupMembership(PROJECT_ID, false)
  expect(app.getCatalog().groups.get(PROJECT_ID)).toMatchObject({ invited: [], declined: [app.identity.did] })
  await app.setGroupMembership(PROJECT_ID, true)
  expect(app.getCatalog().groups.get(PROJECT_ID)?.members).toEqual([stranger.did, app.identity.did])

  await app.saveGroup({ name: 'Circle', bio: 'Hello', avatarCid: 'B'.repeat(32), members: [friend.did] }, groupId)
  expect(app.getCatalog().groups.get(groupId)?.record.avatarCid).toBe('B'.repeat(32))
  await app.saveGroup({ name: 'Circle', bio: 'Hello', members: [friend.did] }, groupId)
  expect(app.getCatalog().groups.get(groupId)?.record.avatarCid).toBeUndefined()
  await app.deleteGroup(groupId)
  expect(app.getCatalog().groups.has(groupId)).toBe(false)
  expect(app.groupFor(app.getCatalog().projects.get(projectId)!)).toBeUndefined()
})

it('keeps the signed bio and avatar when only the display name changes, and allows clearing them', async () => {
  const [root] = await identities()
  ROOT_ADMIN_DIDS.push(root.did)
  const app = runtime = await createRuntime()
  receive()([await approve(root, app.identity, 'member', Date.now())], false)
  const avatarCid = 'A'.repeat(32)
  await app.saveProfile({ displayName: ' Sakura ', bio: ' About us ', avatarCid })
  expect(app.bioFor(app.identity.did)).toBe('About us')
  expect(app.avatarFor(app.identity.did)).toBe(avatarCid)
  await app.saveDisplayName('Sakura Studio')
  expect(app.getCatalog().profiles.get(app.identity.did)).toMatchObject({ displayName: 'Sakura Studio', bio: 'About us', avatarCid })
  await app.saveProfile({ displayName: 'Sakura Studio', bio: '', avatarCid: null })
  expect(app.bioFor(app.identity.did)).toBeUndefined()
  expect(app.avatarFor(app.identity.did)).toBeUndefined()
})
