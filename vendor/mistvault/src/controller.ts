import type { EscrowTransport } from './core/client.js'
import { generateVaultCode, parseVaultCode } from './code.js'
import { browserStorage, defaultAppState, loadAppState, loadSettings, saveAppState, saveSettings, subscribeSettings, validVaultRoom } from './settings.js'
import type { VaultMode, VaultSettings } from './settings.js'
import type { VaultParts } from './parts.js'
import { createVaultSession } from './session.js'

export interface VaultAdapter<S> {
  app: string; schema: string
  legacySchemas?: readonly string[]
  snapshot(): S | Promise<S>
  /** `schema` is the restored head's schema (adapter.schema or one of legacySchemas); optional for callers written before it existed. */
  parse(value: unknown, schema?: string): S
  merge(local: S, remote: S): S
  apply(next: S): void | Promise<void>
  subscribe(onChange: () => void): () => void
  parts?: VaultParts<S>
}
export interface VaultView {
  mode: VaultMode; appEnabled: boolean; room: string; autoRoom: string; hasCode: boolean
  status: 'off' | 'searching' | 'noProvider' | 'restoring' | 'saving' | 'saved' | 'restored' | 'upToDate' | 'error'
  error?: string; savedAt: number; restoredAt: number; lastSeq: number
  parts: { stored: number; pending: number; omitted: number }
  hasParts?: boolean
}
export interface VaultController {
  getView(): VaultView
  subscribe(cb: (view: VaultView) => void): () => void
  enable(): void; disable(): void
  setAppEnabled(on: boolean): void
  configure(mode: VaultMode, room?: string): boolean
  importCode(code: string): boolean
  revealCode(): string | null
  saveNow(): Promise<void>; restoreNow(): Promise<void>
  dispose(): void
}
export interface VaultOptions<S> {
  adapter: VaultAdapter<S>; transport: EscrowTransport | (() => EscrowTransport)
  storage?: Storage; now?: () => number
  /** Minimum observed time without main references before collecting a part. Defaults to 24 hours. */
  partGcGraceMs?: number
}

export function createVault<S>(o: VaultOptions<S>): VaultController {
  const app = o.adapter.app, storage = o.storage ?? browserStorage()
  let settings = loadSettings(storage), writing = false, disposed = false
  const core = createVaultSession({
    ...o, app, autoRoomApp: 'tc-vault', lockName: 'tc-vault:' + app,
    loadState: () => loadAppState(app, storage), saveState: state => saveAppState(app, state, storage),
    acquire: () => ({ transport: typeof o.transport === 'function' ? o.transport() : o.transport }),
  })
  function start(next: VaultSettings, enabled: boolean) {
    const codeChanged = settings.code !== next.code
    settings = next
    if (codeChanged) core.resetState({ ...defaultAppState(), enabled, dirty: core.state.dirty })
    else core.state.enabled = enabled
    core.start(settings)
    if (codeChanged) core.persist()
  }
  function readSettings() {
    if (disposed || writing || core.writing) return
    const next = loadSettings(storage), shared = loadAppState(app, storage), old = settings
    const codeChanged = next.code !== old.code, enableChanged = shared.enabled !== core.state.enabled
    if (codeChanged || enableChanged || next.mode !== old.mode || next.room !== old.room) start(next, shared.enabled)
    else { settings = next; core.sharedStateChanged(shared) }
  }
  function applySettings(next: VaultSettings) {
    writing = true
    try { saveSettings(next, storage) } finally { writing = false }
    start(next, core.state.enabled)
  }
  function configure(mode: VaultMode, room = ''): boolean {
    if (disposed || !['auto', 'custom', 'off'].includes(mode) || mode === 'custom' && !validVaultRoom(room)) return false
    applySettings({ ...settings, mode, room: mode === 'custom' ? room : '',
      code: settings.code || (mode !== 'off' ? generateVaultCode() : '') })
    return true
  }
  const offSettings = subscribeSettings(readSettings, storage, globalThis.window, app)
  core.start(settings)
  return {
    getView: core.getView, subscribe: core.subscribe,
    enable: () => { configure('auto') }, disable: () => { configure('off') }, configure,
    setAppEnabled(on) { if (!disposed) { core.state.enabled = on; core.persist(); core.start(settings) } },
    importCode(input) {
      const code = parseVaultCode(input)
      if (!code || disposed) return false
      if (code !== settings.code) applySettings({ ...settings, code })
      return true
    },
    revealCode: () => settings.code || null,
    saveNow: core.saveNow, restoreNow: core.restoreNow,
    dispose() { disposed = true; offSettings(); core.dispose() },
  }
}
