import { deriveAutoRoom } from './core/crypto.js'
import { isRecord, safeInt } from './core/head.js'
import type { VaultOptions, VaultView } from './controller.js'
import { defaultAppState, parseAppState } from './appState.js'
import { browserStorage, loadSettings, validVaultRoom } from './settings.js'
import type { VaultMode } from './settings.js'
import { createVaultSession } from './session.js'
import type { AcquireTransport } from './session.js'
import { scopeStateKey } from './scopeKey.js'
import { read, write, notifyStored, subscribeStored } from './stored.js'

export interface ScopeConfig { mode: VaultMode; room: string; rev: number; by: string }
type Setting = Pick<ScopeConfig, 'mode' | 'room'>
export interface ScopeVaultOptions<S> extends VaultOptions<S> {
  app: string
  roomId: string
  nodeId: string
  isWriter?: () => boolean
  defaultConfig?: () => Setting | Promise<Setting>
}
export interface ScopeVaultView extends Omit<VaultView, 'hasCode' | 'appEnabled'> {
  config: ScopeConfig
  providerSeen: boolean
}
export interface ScopeVault {
  getView(): ScopeVaultView
  subscribe(cb: (view: ScopeVaultView) => void): () => void
  configure(mode: VaultMode, room?: string): boolean
  materializeDefault(): Promise<boolean>
  receiveConfig(cfg: unknown, from: string): boolean
  onConfig(cb: (cfg: ScopeConfig) => void): () => void
  changed(): void
  saveNow(): Promise<void>
  restoreNow(): Promise<void>
  dispose(): void
}

const validNode = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128
const auto = (): Setting => ({ mode: 'auto', room: '' })
// A local default has no author. Only authored configs are valid on the wire.
const localConfig = ({ mode, room }: Setting): ScopeConfig => ({ mode, room, rev: 0, by: '' })
const validSetting = (v: unknown): v is Setting => isRecord(v) && typeof v.room === 'string' &&
  (v.mode === 'custom' ? validVaultRoom(v.room) : (v.mode === 'off' || v.mode === 'auto') && v.room === '')
const newer = (a: ScopeConfig, b: ScopeConfig) => a.rev > b.rev || a.rev === b.rev && a.by > b.by
const CFG_STEP = 1000
const peerRevisionLimit = Number.MAX_SAFE_INTEGER - CFG_STEP
// Reopening a scope can replace its adapter while the old apply still owns the store.
const scopeWorkQueues = new Map<string, Promise<void>>()

function parseConfig(value: unknown, roomId: string): ScopeConfig | undefined {
  if (!isRecord(value)) return
  const { rev, by } = value
  if (!validNode(by) || !safeInt(rev, 0) || !validSetting(value) || value.room === roomId) return
  return { mode: value.mode, room: value.room, rev, by }
}

function personalRoomSetting(storage: Storage | undefined): Setting | Promise<Setting> {
  const personal = loadSettings(storage)
  if (!personal.code || personal.mode === 'off') return auto()
  if (personal.mode === 'custom') return { mode: 'custom', room: personal.room }
  return deriveAutoRoom('tc-vault', personal.code).then(room => ({ mode: 'custom', room }))
}
export async function defaultScopeConfig(storage = browserStorage()): Promise<Setting> {
  return personalRoomSetting(storage)
}
// Always explicit: unlike tc-linkai, a joiner's own default may differ (personal vault room), so 'auto' is spelled out.
// Custom rooms carry a 'c:' prefix so a room literally named 'auto' or 'off' stays unambiguous.
export function scopeInviteParam(cfg: Setting): string {
  return cfg.mode === 'auto' ? 'auto' : cfg.mode === 'off' ? 'off' : 'c:' + cfg.room
}
export function parseScopeInviteParam(v: unknown): Setting | null {
  if (v === 'auto' || v === 'off') return { mode: v, room: '' }
  if (v === '') return { mode: 'off', room: '' }
  if (typeof v === 'string' && v.startsWith('c:')) return validVaultRoom(v.slice(2)) ? { mode: 'custom', room: v.slice(2) } : null
  return typeof v === 'string' && validVaultRoom(v) ? { mode: 'custom', room: v } : null
}

export function createScopeVault<S>(o: ScopeVaultOptions<S>): ScopeVault {
  return openScopeVault(o, () => ({ transport: typeof o.transport === 'function' ? o.transport() : o.transport }))
}

export function openScopeVault<S>(o: Omit<ScopeVaultOptions<S>, 'transport'>, acquire: AcquireTransport): ScopeVault {
  const { app, roomId, nodeId } = o, storage = o.storage ?? browserStorage()
  if (!app || !roomId || !validNode(nodeId)) throw new Error('Scope app, room ID and node ID are required')
  const key = scopeStateKey(app, roomId)
  const load = () => {
    const raw = read(key, storage)
    let cfg: ScopeConfig | undefined
    if (isRecord(raw)) {
      if (raw.sharedConfig !== false) {
        cfg = parseConfig(raw.cfg, roomId)
        // Older clients persisted unchecked peer clocks. Keep the chosen room and
        // author, but let a saturated legacy clock start again at the first revision.
        if (cfg && raw.boundedClock !== true && cfg.rev >= peerRevisionLimit - CFG_STEP) cfg.rev = 0
      }
      else if (validSetting(raw.cfg) && raw.cfg.room !== roomId) cfg = localConfig(raw.cfg)
    }
    return { state: parseAppState(raw), cfg,
      providerSeen: isRecord(raw) && raw.providerSeen === true }
  }
  const stored = load()
  let cfg = stored.cfg ?? localConfig(auto())
  let providerSeen = stored.providerSeen, initialized = false, disposed = false
  const configListeners = new Set<(cfg: ScopeConfig) => void>()
  let ready!: () => void
  const initialization = new Promise<void>(resolve => { ready = resolve })
  const core = createVaultSession({
    ...o, acquire, autoRoomApp: app, lockName: key, workQueues: scopeWorkQueues,
    isWriter: o.isWriter ?? (() => true),
    loadState: () => load().state,
    saveState(state) {
      const latest = load()
      if (latest.cfg?.by && newer(latest.cfg, cfg)) return
      providerSeen ||= latest.providerSeen
      write(key, { ...state, ...(initialized && { cfg, sharedConfig: !!cfg.by, boundedClock: true }), providerSeen }, storage)
      notifyStored(storage, key)
    },
    waitForProvider: () => cfg.mode === 'custom' || providerSeen,
    providerFound() { if (!providerSeen) { providerSeen = true; core.persist() } },
  })
  function start() {
    initialized = true
    core.start({ ...cfg, code: roomId }); ready()
  }
  function announce() {
    for (const cb of configListeners) { try { cb({ ...cfg }) } catch { /* Isolate subscribers. */ } }
  }
  function adopt(next: ScopeConfig, fromStorage = false) {
    const switched = cfg.mode !== next.mode || cfg.room !== next.room
    cfg = next
    if (switched) core.resetState(fromStorage ? load().state : { ...defaultAppState(), dirty: true })
    if (switched || !initialized) start()
    if (!fromStorage) core.persist()
    announce()
  }
  function readShared() {
    if (disposed || core.writing) return
    const next = load()
    providerSeen ||= next.providerSeen
    if (next.cfg?.by && newer(next.cfg, cfg)) adopt(next.cfg, true)
    core.sharedStateChanged(next.state)
  }
  const offStorage = subscribeStored(readShared, storage, globalThis.window, k => k === key || k === null)
  function initialize(setting: Setting) {
    if (core.closed || initialized) return
    const initial = validSetting(setting) && setting.room !== roomId ? setting : auto()
    cfg = localConfig(initial)
    start(); core.persist()
  }
  if (stored.cfg) start()
  else {
    try {
      const initial = o.defaultConfig ? o.defaultConfig() : personalRoomSetting(storage)
      if (validSetting(initial)) initialize(initial)
      else void Promise.resolve(initial).then(initialize, () => initialize(auto()))
    } catch { initialize(auto()) }
  }
  function getView(): ScopeVaultView {
    const { hasCode, appEnabled, ...view } = core.getView()
    return { ...view, ...(!initialized && { mode: cfg.mode, status: 'searching' as const }), config: { ...cfg }, providerSeen }
  }
  return {
    getView, subscribe: cb => core.subscribe(() => cb(getView())),
    configure(mode, room = '') {
      if (disposed) return false
      readShared()
      const next = { mode, room: mode === 'custom' ? room : '', rev: cfg.rev + 1, by: nodeId }
      if (!parseConfig(next, roomId) || cfg.by && next.mode === cfg.mode && next.room === cfg.room) return false
      adopt(next); return true
    },
    async materializeDefault() {
      if (!disposed && !initialized) await initialization
      if (disposed || cfg.by) return false
      readShared()
      if (disposed || cfg.by) return false
      adopt({ ...cfg, rev: 1, by: nodeId }); return true
    },
    receiveConfig(value, from) {
      if (disposed || !validNode(from)) return false
      readShared()
      const next = parseConfig(value, roomId)
      if (!next || !newer(next, cfg)) return false
      // Bound each peer advance and reserve safe integer revisions for local edits.
      if (next.rev - cfg.rev > CFG_STEP || next.rev >= peerRevisionLimit) return false
      adopt(next); return true
    },
    onConfig(cb) { configListeners.add(cb); return () => { configListeners.delete(cb) } },
    changed: core.changed,
    async saveNow() { if (!disposed && !initialized) await initialization; await core.saveNow() },
    async restoreNow() { if (!disposed && !initialized) await initialization; await core.restoreNow() },
    dispose() {
      if (disposed) return
      disposed = true; offStorage(); configListeners.clear()
      void core.dispose(initialization).then(ready, ready)
    },
  }
}
