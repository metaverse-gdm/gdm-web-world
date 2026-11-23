import { deriveAutoRoom, generateVaultCode, saveSettings } from '@tik-choco/mistvault'
import { saveDelegation, signDelegation } from '@tik-choco/mistai/identity'
import { beforeEach, expect, it, vi } from 'vitest'
import { APP_ID, CATALOG_SCOPE_ID } from '../../config'
import type { DidIdentity } from '../../crypto/didIdentity'
import { identities } from '../../test/fixtures'
import { createRecordStore } from '../catalogStore'
import { makeWire, readWire } from '../wires'
import type { CatalogRecord } from '../wires'
import { createCatalogAdapter } from './catalogAdapter'
import { createSharedVault } from './controllers'

vi.mock('../mistClient', () => ({
  createVaultRoomHandle: () => ({
    async init() {},
    onEvent: vi.fn(),
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(),
    sendMessage: vi.fn(),
  }),
  addBlob: vi.fn(),
  getBlob: vi.fn(),
}))

beforeEach(() => localStorage.clear())

function openVault(identity: DidIdentity, admins = new Set<string>(), selfId = () => identity.did) {
  const send = vi.fn()
  return {
    send,
    vault: createSharedVault({
      identity, adapter: createCatalogAdapter(createRecordStore<CatalogRecord>()),
      isWriter: () => false, isAdmin: did => admins.has(did), selfId, send,
    }),
  }
}

it('derives one automatic escrow room for fresh peers regardless of existing vault settings', async () => {
  const [first, second] = await identities()
  const expectedRoom = await deriveAutoRoom(APP_ID, CATALOG_SCOPE_ID)
  for (const [index, peer] of [first, second].entries()) {
    localStorage.clear()
    saveSettings({ v: 1, mode: 'custom', room: `browser-room-${index}`, code: generateVaultCode(), rev: 0 })
    const { vault } = openVault(peer)
    try {
      expect(vault.panel.getView().config).toEqual({ mode: 'auto', room: '', rev: 0, by: '' })
      await vi.waitFor(() => expect(vault.panel.getView().room).toBe(expectedRoom))
    } finally { vault.dispose() }
  }
})

it('accepts and relays signed configurations only from current admins', async () => {
  const [self, admin, member] = await identities()
  const admins = new Set([admin.did])
  const { vault, send } = openVault(self, admins)
  const config = { mode: 'custom', room: 'shared-escrow', rev: 1, by: admin.did } as const
  try {
    expect(vault.panel.configure('custom', 'local-room')).toBe(false)
    await expect(vault.panel.materializeDefault()).resolves.toBe(false)
    expect(vault.panel.receiveConfig(config, admin.did)).toBe(false)

    const memberWire = await makeWire(member, {
      type: 'gdmw:vault-config', config: { ...config, by: member.did, rev: 2 },
    })
    vault.receive(memberWire)
    expect(vault.panel.getView().config.mode).toBe('auto')

    const adminWire = await makeWire(admin, { type: 'gdmw:vault-config', config })
    vault.receive(adminWire)
    expect(vault.panel.getView().config).toEqual(config)
    vault.announce('new-peer')
    expect(send).toHaveBeenCalledWith('new-peer', adminWire)

    admins.delete(admin.did)
    const revokedWire = await makeWire(admin, {
      type: 'gdmw:vault-config', config: { ...config, room: 'revoked-room', rev: 2 },
    })
    vault.receive(revokedWire)
    vault.announce('later-peer')
    expect(vault.panel.getView().config).toEqual(config)
    expect(send).toHaveBeenCalledTimes(1)

    admins.add(self.did)
    expect(vault.panel.configure('auto')).toBe(true)
    await vi.waitFor(() => expect(readWire(send.mock.lastCall?.[1])).toMatchObject({
      type: 'gdmw:vault-config', fromId: self.did, config: { mode: 'auto', room: '', rev: 2, by: self.did },
    }))
  } finally { vault.dispose() }
})

it('accepts and relays a delegated admin config after its signed-time delegation expires', async () => {
  const [self, root, leaf] = await identities()
  const now = Date.now()
  const day = 86_400_000
  saveDelegation(await signDelegation(root, leaf.did, { now: now - day, ttlMs: day + 60_000 }))
  const config = { mode: 'custom', room: 'paired-admin-escrow', rev: 1, by: leaf.did } as const
  const wire = await makeWire(leaf, { type: 'gdmw:vault-config', config, configuredAt: now })
  const replayed = readWire(JSON.parse(JSON.stringify(wire)), now + day)
  const { vault, send } = openVault(self, new Set([root.did]))
  try {
    if (replayed?.type !== 'gdmw:vault-config') throw new Error('Expected verified vault config')
    vault.receive(replayed)
    expect(vault.panel.getView().config).toEqual(config)
    vault.announce('peer')
    expect(send).toHaveBeenCalledWith('peer', wire)
  } finally { vault.dispose() }
})
