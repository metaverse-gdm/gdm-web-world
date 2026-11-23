import { parseVaultCode } from './code.js'
import { isRecord, safeInt } from './core/head.js'
export { defaultAppState } from './appState.js'
export type { VaultAppState, PartState } from './appState.js'
import type { VaultAppState } from './appState.js'
import { defaultAppState, parseAppState } from './appState.js'
import { read, write, notifyStored, subscribeStored } from './stored.js'

export type VaultMode = 'auto' | 'custom' | 'off'
export interface VaultSettings { v: 1; code: string; mode: VaultMode; room: string; rev: number }
export const SETTINGS_KEY = 'tc-vault:settings-v1'
export const appStateKey = (app: string): string => 'tc-vault:app:' + app + ':v1'
export const validVaultRoom = (room: string): boolean => /^[A-Za-z0-9_./:-]{1,96}$/.test(room)
export const defaultSettings = (): VaultSettings => ({ v: 1, code: '', mode: 'off', room: '', rev: 0 })
export function browserStorage(): Storage | undefined { try { return globalThis.localStorage } catch { return undefined } }
export function loadSettings(storage = browserStorage()): VaultSettings {
  const v = read(SETTINGS_KEY, storage)
  if (!isRecord(v) || v.v !== 1 || !safeInt(v.rev, 0) ||
    !(v.mode === 'auto' || v.mode === 'custom' || v.mode === 'off') || typeof v.room !== 'string' ||
    (v.mode === 'custom' ? !validVaultRoom(v.room) : v.room !== '') ||
    !(v.code === '' || typeof v.code === 'string' && parseVaultCode(v.code) === v.code)) return defaultSettings()
  return { v: 1, code: v.code as string, mode: v.mode, room: v.room, rev: v.rev }
}
export function saveSettings(value: VaultSettings, storage = browserStorage()): VaultSettings {
  const previous = loadSettings(storage)
  const rev = Math.max(value.rev, previous.rev)
  if (rev >= Number.MAX_SAFE_INTEGER) throw new Error('Vault settings revision exhausted')
  const next = { ...value, rev: rev + 1 }
  if (previous.code !== next.code || previous.mode !== 'off' && next.mode !== 'off' &&
    (previous.mode !== next.mode || previous.room !== next.room)) {
    // Reset unopened apps too; watermarks and attachment inventories belong to one destination.
    try {
      const keys = Array.from({ length: storage?.length ?? 0 }, (_, i) => storage!.key(i))
      for (const key of keys) if (key?.startsWith('tc-vault:app:') && key.endsWith(':v1')) {
        const app = key.slice(13, -3), old = loadAppState(app, storage)
        write(key, { ...defaultAppState(), enabled: old.enabled, dirty: old.dirty,
          editVersion: old.editVersion, editToken: old.editToken }, storage)
      }
    } catch { /* Controllers also reset their in-memory state. */ }
  }
  write(SETTINGS_KEY, next, storage)
  notifyStored(storage, SETTINGS_KEY)
  return next
}
export function loadAppState(app: string, storage = browserStorage()): VaultAppState {
  return parseAppState(read(appStateKey(app), storage))
}
export function saveAppState(app: string, value: VaultAppState, storage = browserStorage()): void {
  write(appStateKey(app), value, storage)
  notifyStored(storage, appStateKey(app))
}
export function subscribeSettings(cb: () => void, storage = browserStorage(), target: EventTarget | undefined = globalThis.window,
  app?: string): () => void {
  const relevant = (key: string | null) => key === null || key === SETTINGS_KEY || app !== undefined && key === appStateKey(app)
  return subscribeStored(cb, storage, target, relevant)
}
