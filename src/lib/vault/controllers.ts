import { createMistVaultTransport, createScopeVault } from '@tik-choco/mistvault'
import type { ScopeVault, VaultAdapter } from '@tik-choco/mistvault'
import { APP_ID, CATALOG_SCOPE_ID } from '../../config'
import type { DidIdentity } from '../../crypto/didIdentity'
import { addBlob, createVaultRoomHandle, getBlob } from '../mistClient'
import { makeWire, personId, readWire } from '../wires'
import type { Verified } from '../wires'
import type { CatalogSnapshot } from './catalogAdapter'

const CONFIG_KEY = 'gdm-world:scope-config-signature:v1'
type ConfigWire = Extract<Verified, { type: 'gdmw:vault-config' }>
const transport = () => createMistVaultTransport({
  createNode: createVaultRoomHandle, storageAdd: addBlob, storageGet: getBlob,
})

export function createSharedVault(options: {
  identity: DidIdentity
  adapter: VaultAdapter<CatalogSnapshot>
  isWriter: () => boolean
  isAdmin: (did: string) => boolean
  selfId: () => string
  send: (to: string | null, wire: ConfigWire) => void
}) {
  const { identity, adapter, isWriter, isAdmin, selfId, send } = options
  const vault = createScopeVault({
    app: APP_ID, roomId: CATALOG_SCOPE_ID, nodeId: identity.did,
    adapter, transport, isWriter,
    // Every browser derives the same escrow room from the app and the catalog scope.
    defaultConfig: () => ({ mode: 'auto', room: '' }),
  })
  let current: ConfigWire | undefined
  try {
    const wire = readWire(JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null'))
    if (wire?.type === 'gdmw:vault-config') current = wire
  } catch { /* Explicit configuration is also retained by the vault controller. */ }

  function remember(wire: ConfigWire) {
    current = wire
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(wire)) } catch { /* Best effort. */ }
  }
  const matches = (wire: ConfigWire) => {
    const cfg = vault.getView().config
    return cfg.rev === wire.config.rev && cfg.by === wire.config.by && cfg.mode === wire.config.mode && cfg.room === wire.config.room
  }
  async function broadcast(to: string | null) {
    const config = vault.getView().config
    if ((!current || !matches(current)) && config.by === identity.did && isAdmin(selfId())) {
      const signed = await makeWire(identity, { type: 'gdmw:vault-config', config })
      const author = personId(signed)
      if ((!current || !matches(current)) && matches(signed) && author === selfId() && isAdmin(author)) remember(signed)
    }
    if (current && matches(current) && isAdmin(personId(current))) send(to, current)
  }
  const announce = (to: string | null) => { void broadcast(to).catch(error => console.warn('scope config', error)) }
  const off = vault.onConfig(config => {
    if (config.by === identity.did) announce(null)
  })
  const panel: ScopeVault = {
    ...vault,
    configure: (mode, room) => isAdmin(selfId()) && vault.configure(mode, room),
    materializeDefault: async () => isAdmin(selfId()) && vault.materializeDefault(),
    // Peer configuration enters via receive(), after the network verifies the wire.
    receiveConfig: () => false,
  }
  return {
    panel,
    announce,
    receive(wire: ConfigWire) {
      if (isAdmin(personId(wire)) && (vault.receiveConfig(wire.config, wire.fromId) || matches(wire))) {
        remember(wire)
      }
    },
    dispose() { off(); vault.dispose() },
  }
}
