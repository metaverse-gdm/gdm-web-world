import { isRecord, safeInt, HASH_RE } from './core/head.js'
import { PART_ID_RE } from './core/crypto.js'

export interface PartState { seq: number; hash: string; headHash?: string; unreferencedSince?: number }
export interface VaultAppState {
  v: 1; enabled: boolean; lastSeq: number; lastHash: string | null; dirty: boolean
  savedAt: number; restoredAt: number; parts: Record<string, PartState>; omitted: string[]
  scope?: string; editVersion?: number; editToken?: string
  pendingDeletes?: Record<string, PartState>
  partsObservedSeq?: number
}
export const defaultAppState = (): VaultAppState => ({ v: 1, enabled: true, lastSeq: 0, lastHash: null,
  dirty: false, savedAt: 0, restoredAt: 0, parts: {}, omitted: [] })

export function parseAppState(v: unknown): VaultAppState {
  const validParts = (parts: unknown) => isRecord(parts) && Object.entries(parts).every(([id, p]) =>
    PART_ID_RE.test(id) && isRecord(p) && safeInt(p.seq, 1) && typeof p.hash === 'string' && HASH_RE.test(p.hash) &&
    (p.headHash === undefined || typeof p.headHash === 'string' && HASH_RE.test(p.headHash)) &&
    (p.unreferencedSince === undefined || safeInt(p.unreferencedSince, 0)))
  if (!isRecord(v) || v.v !== 1 || typeof v.enabled !== 'boolean' || typeof v.dirty !== 'boolean' ||
    !safeInt(v.lastSeq, 0) || !(v.lastHash === null || typeof v.lastHash === 'string' && HASH_RE.test(v.lastHash)) ||
    (v.lastSeq === 0) !== (v.lastHash === null) || !safeInt(v.savedAt, 0) || !safeInt(v.restoredAt, 0) ||
    !validParts(v.parts) || (v.pendingDeletes !== undefined && !validParts(v.pendingDeletes)) ||
    (v.partsObservedSeq !== undefined && !safeInt(v.partsObservedSeq, 0)) ||
    (v.scope !== undefined && typeof v.scope !== 'string') ||
    (v.editVersion !== undefined && !safeInt(v.editVersion, 0)) ||
    (v.editToken !== undefined && typeof v.editToken !== 'string') ||
    !Array.isArray(v.omitted) || !v.omitted.every(id => typeof id === 'string' && PART_ID_RE.test(id))) return defaultAppState()
  return v as unknown as VaultAppState
}
