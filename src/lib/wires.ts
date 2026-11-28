import { loadDelegationFor, signWireWithDelegation } from '@tik-choco/mistai/identity'
import { GLOBAL_ROOM_ID } from '../config'
import { isEd25519DidKey } from '../crypto/didIdentity'
import type { DidIdentity } from '../crypto/didIdentity'
import { CLOCK_SKEW_MS, DAY_MS, verifyDelegationSync } from './delegation'
import { isLanguage } from './languages'
import type { Language } from './languages'
import { parseStatsDay, retainedStatsDay } from './statsDays'
import { isSignature, verifyWire } from './wireSign'

export const LIMITS = {
  title: 100, summary: 240, description: 4000, url: 512, tags: 8, tag: 24,
  // Leave room for mistlib's framing within its 64 KiB transport limit.
  displayName: 48, bio: 1000, request: 600, note: 240, wireBytes: 63 * 1024, recordBytes: 56 * 1024, syncKeys: 128, syncRecords: 64,
  statsProjects: 200, statsBytes: 10 * 1024, groupName: 48, groupMembers: 50, media: 12,
} as const
export const REQUEST_INTERVAL_MS = 60_000
export type Role = 'member' | 'admin'
export type VaultConfig = { mode: 'off' | 'auto' | 'custom'; room: string; rev: number; by: string }

export type ProjectText = { title: string; summary: string; description: string }
/**
 * One gallery entry: an uploaded image blob (with an optional small `thumb` blob
 * for cards and filmstrips), or an https image / video file / video page URL.
 * The first entry is the project's cover.
 */
export type MediaItem = { cid: string; thumb?: string } | { url: string }
export type ProjectFields = ProjectText & {
  lang?: Language; translations?: Partial<Record<Language, ProjectText>>
  url: string; repoUrl?: string; tags: string[]; thumbnailCid?: string; thumbnailUrl?: string
  /** Gallery shown on the detail view, in order. Omitted rather than empty. */
  media?: MediaItem[]
  /** Shown under the group only while the author is one of its current members. */
  groupId?: string
}
type ProjectUpsert = ProjectFields & {
  type: 'gdmw:project-upsert'; projectId: string; createdAt: number; updatedAt: number; rev: number
}
type ProjectDelete = { type: 'gdmw:project-delete'; projectId: string; deletedAt: number }
type Approval = {
  type: 'gdmw:approval'; subject: string; role: Role; issuedAt: number; expiresAt?: number; note?: string
  requestSignature?: string
}
type Revocation = { type: 'gdmw:revocation'; subject: string; revokedAt: number }
export type GroupFields = { name: string; bio?: string; members: string[] }
type GroupUpsert = GroupFields & {
  type: 'gdmw:group-upsert'; groupId: string; createdAt: number; updatedAt: number; rev: number
}
type GroupDelete = { type: 'gdmw:group-delete'; groupId: string; deletedAt: number }
/** Signed by an invited person to accept (`joined`) or leave a group. */
type GroupMembership = { type: 'gdmw:group-membership'; groupId: string; joined: boolean; updatedAt: number }
type Profile = { type: 'gdmw:profile'; displayName: string; bio?: string; updatedAt: number }
type ApprovalRequest = { type: 'gdmw:approval-request'; displayName: string; message: string; requestedAt: number }
type RequestReject = { type: 'gdmw:request-reject'; subject: string; requestSignature: string; rejectedAt: number }
export const STATS_FLAGS = { impression: 1, detail: 2, click: 4 } as const
export type StatsMetric = keyof typeof STATS_FLAGS
type Stats = { type: 'gdmw:stats'; day: string; views: Record<string, number>; updatedAt: number }
type Digest = { type: 'gdmw:sync-digest'; keys: string[]; statsDays?: string[] }
type Want = { type: 'gdmw:sync-want'; keys: string[] }
type SyncRecords = { type: 'gdmw:sync-records'; records: SignedRecord[] }
type Config = { type: 'gdmw:vault-config'; config: VaultConfig; configuredAt?: number }

export type CatalogPayload = ProjectUpsert | ProjectDelete | Approval | Revocation | Profile
  | GroupUpsert | GroupDelete | GroupMembership
export type RequestPayload = ApprovalRequest | RequestReject
export type WirePayload = CatalogPayload | RequestPayload | Stats | Digest | Want | SyncRecords | Config

type Envelope = { v: 1; roomId: typeof GLOBAL_ROOM_ID; fromId: string; signature: string; delegation?: unknown }
export type Wire = WirePayload & Envelope
type SignedRecord = (CatalogPayload | RequestPayload | Stats) & Envelope
declare const verifiedBrand: unique symbol
export type Verified<T = Wire> = T & { readonly [verifiedBrand]: true }
export type VerifiedRecord = Verified<SignedRecord>
export type CatalogRecord = Verified<CatalogPayload & Envelope>
export type RequestRecord = Verified<RequestPayload & Envelope>
export type StatsRecord = Verified<Stats & Envelope>
export type PolicyRecord = Verified<(Approval | Revocation) & Envelope>
export type ProjectRecord = Verified<ProjectUpsert & Envelope>
export type DeleteRecord = Verified<ProjectDelete & Envelope>
export type ProfileRecord = Verified<Profile & Envelope>
export type GroupRecord = Verified<GroupUpsert & Envelope>
export type GroupDeleteRecord = Verified<GroupDelete & Envelope>
export type MembershipRecord = Verified<GroupMembership & Envelope>

export const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
export const hasOnly = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every(key => keys.includes(key))
export const validDid = (value: unknown): value is string =>
  typeof value === 'string' && value.length === 56 && isEd25519DidKey(value)
export const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
export const validCid = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9]+$/.test(value) && value.length >= 32 && value.length <= 128
export const bounded = (value: unknown, max: number, empty = false): value is string =>
  typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0)
const validInteger = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max
export const validDate = (value: unknown): value is number => validInteger(value, 8_640_000_000_000_000)
export function isHttpUrl(value: unknown): value is string {
  if (!bounded(value, LIMITS.url) || !/^https?:\/\//i.test(value) || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname && !url.username && !url.password
  } catch {
    return false
  }
}

export const isHttpsUrl = (value: unknown): value is string => isHttpUrl(value) && /^https:\/\//i.test(value)

function validProjectText(value: Record<string, unknown>, draft: boolean) {
  return bounded(value.title, LIMITS.title, draft) && bounded(value.summary, LIMITS.summary, draft)
    && bounded(value.description, LIMITS.description, true)
}

export function validProjectLanguages({ lang, translations }: Record<string, unknown>, draft = false): boolean {
  if (lang !== undefined && !isLanguage(lang)) return false
  if (translations === undefined) return true
  if (!isObject(translations)) return false
  const entries = Object.entries(translations)
  return entries.length <= 2 && entries.every(([language, text]) =>
    isLanguage(language) && language !== lang && isObject(text)
    && hasOnly(text, ['title', 'summary', 'description']) && validProjectText(text, draft))
}

export function validMediaItem(value: unknown, draft = false): value is MediaItem {
  if (!isObject(value)) return false
  if ('cid' in value) return hasOnly(value, ['cid', 'thumb']) && validCid(value.cid)
    && (value.thumb === undefined || validCid(value.thumb))
  return hasOnly(value, ['url']) && (draft ? bounded(value.url, LIMITS.url) : isHttpsUrl(value.url))
}

export function validMediaList(value: unknown, draft = false): value is MediaItem[] {
  return Array.isArray(value) && value.length <= LIMITS.media && (draft || value.length > 0)
    && value.every(item => validMediaItem(item, draft))
}

const projectKeys = ['title', 'summary', 'description', 'lang', 'translations', 'url', 'repoUrl', 'tags', 'thumbnailCid', 'thumbnailUrl', 'media', 'groupId']
export function validProjectFields(value: Record<string, unknown>): boolean {
  return validProjectText(value, false) && validProjectLanguages(value) && isHttpUrl(value.url)
    && (value.repoUrl === undefined || isHttpUrl(value.repoUrl))
    && Array.isArray(value.tags) && value.tags.length <= LIMITS.tags
    && value.tags.every(tag => bounded(tag, LIMITS.tag) && tag.trim() === tag)
    && new Set(value.tags).size === value.tags.length
    && (value.thumbnailCid === undefined || validCid(value.thumbnailCid))
    && (value.thumbnailUrl === undefined || value.thumbnailCid === undefined && isHttpsUrl(value.thumbnailUrl))
    && (value.media === undefined || validMediaList(value.media))
    && (value.groupId === undefined || validId(value.groupId))
}

export function validGroupFields(value: Record<string, unknown>): boolean {
  return bounded(value.name, LIMITS.groupName) && value.name.trim() === value.name
    && (value.bio === undefined || bounded(value.bio, LIMITS.bio) && value.bio.trim() === value.bio)
    && Array.isArray(value.members) && value.members.length <= LIMITS.groupMembers
    && value.members.every(validDid) && new Set(value.members).size === value.members.length
}

const envelopeKeys = ['v', 'type', 'roomId', 'fromId', 'signature', 'delegation']
const encoder = new TextEncoder()
function validate(value: unknown, recordsOnly = false): value is Wire {
  if (!isObject(value) || value.v !== 1 || value.roomId !== GLOBAL_ROOM_ID || !validDid(value.fromId)
    || !isSignature(value.signature)) return false
  const fields = (...keys: string[]) => hasOnly(value, [...envelopeKeys, ...keys])
  switch (value.type) {
    case 'gdmw:project-upsert':
      return fields('projectId', 'createdAt', 'updatedAt', 'rev', ...projectKeys)
        && validId(value.projectId) && validDate(value.createdAt) && validDate(value.updatedAt)
        && value.updatedAt >= value.createdAt && validInteger(value.rev, Number.MAX_SAFE_INTEGER) && validProjectFields(value)
    case 'gdmw:project-delete':
      return fields('projectId', 'deletedAt') && validId(value.projectId) && validDate(value.deletedAt)
    case 'gdmw:approval':
      return fields('subject', 'role', 'issuedAt', 'expiresAt', 'note', 'requestSignature')
        && validDid(value.subject) && (value.role === 'admin' || value.role === 'member')
        && validDate(value.issuedAt) && (value.expiresAt === undefined || validDate(value.expiresAt) && value.expiresAt > value.issuedAt)
        && (value.note === undefined || bounded(value.note, LIMITS.note, true))
        && (value.requestSignature === undefined || isSignature(value.requestSignature))
    case 'gdmw:revocation':
      return fields('subject', 'revokedAt') && validDid(value.subject) && validDate(value.revokedAt)
    case 'gdmw:profile':
      return fields('displayName', 'bio', 'updatedAt') && bounded(value.displayName, LIMITS.displayName)
        && value.displayName.trim() === value.displayName && validDate(value.updatedAt)
        && (value.bio === undefined || bounded(value.bio, LIMITS.bio) && value.bio.trim() === value.bio)
    case 'gdmw:group-upsert':
      return fields('groupId', 'createdAt', 'updatedAt', 'rev', 'name', 'bio', 'members')
        && validId(value.groupId) && validDate(value.createdAt) && validDate(value.updatedAt)
        && value.updatedAt >= value.createdAt && validInteger(value.rev, Number.MAX_SAFE_INTEGER) && validGroupFields(value)
    case 'gdmw:group-delete':
      return fields('groupId', 'deletedAt') && validId(value.groupId) && validDate(value.deletedAt)
    case 'gdmw:group-membership':
      return fields('groupId', 'joined', 'updatedAt') && validId(value.groupId) && typeof value.joined === 'boolean'
        && validDate(value.updatedAt)
    case 'gdmw:approval-request':
      return fields('displayName', 'message', 'requestedAt') && bounded(value.displayName, LIMITS.displayName)
        && bounded(value.message, LIMITS.request, true) && validDate(value.requestedAt)
    case 'gdmw:request-reject':
      return fields('subject', 'requestSignature', 'rejectedAt') && validDid(value.subject)
        && isSignature(value.requestSignature) && validDate(value.rejectedAt)
    case 'gdmw:stats': {
      if (!fields('day', 'views', 'updatedAt') || !validDate(value.updatedAt) || !isObject(value.views)) return false
      const at = parseStatsDay(value.day)
      if (!(value.updatedAt >= at - CLOCK_SKEW_MS && value.updatedAt < at + DAY_MS + CLOCK_SKEW_MS)) return false
      const views = Object.entries(value.views)
      return views.length > 0 && views.length <= LIMITS.statsProjects
        && views.every(([id, flags]) => validId(id) && validInteger(flags, 7))
    }
    case 'gdmw:sync-digest':
    case 'gdmw:sync-want':
      return !recordsOnly && (value.type === 'gdmw:sync-digest' ? fields('keys', 'statsDays') : fields('keys'))
        && Array.isArray(value.keys) && value.keys.length <= LIMITS.syncKeys
        && value.keys.every(isSignature)
        && (value.statsDays === undefined || Array.isArray(value.statsDays) && value.statsDays.length === value.keys.length
          && value.statsDays.every(day => Number.isFinite(parseStatsDay(day))))
    case 'gdmw:sync-records':
      return !recordsOnly && fields('records') && Array.isArray(value.records)
        && value.records.length > 0 && value.records.length <= LIMITS.syncRecords
        && value.records.every(record => validate(record, true))
    case 'gdmw:vault-config': {
      const cfg = value.config
      return !recordsOnly && fields('config', 'configuredAt')
        && (value.configuredAt === undefined || validDate(value.configuredAt))
        && isObject(cfg) && hasOnly(cfg, ['mode', 'room', 'rev', 'by'])
        && cfg.by === value.fromId && validInteger(cfg.rev, Number.MAX_SAFE_INTEGER)
        && (cfg.mode === 'custom' ? typeof cfg.room === 'string' && /^[A-Za-z0-9_./:-]{1,96}$/.test(cfg.room)
          : (cfg.mode === 'off' || cfg.mode === 'auto') && cfg.room === '')
    }
    default:
      return false
  }
}

function signedTime(wire: Wire): number | undefined {
  switch (wire.type) {
    case 'gdmw:project-upsert':
    case 'gdmw:stats':
    case 'gdmw:profile':
    case 'gdmw:group-upsert':
    case 'gdmw:group-membership': return wire.updatedAt
    case 'gdmw:project-delete':
    case 'gdmw:group-delete': return wire.deletedAt
    case 'gdmw:approval': return wire.issuedAt
    case 'gdmw:revocation': return wire.revokedAt
    case 'gdmw:approval-request': return wire.requestedAt
    case 'gdmw:request-reject': return wire.rejectedAt
    case 'gdmw:vault-config': return wire.configuredAt
    default: return undefined
  }
}

const resolvedPeople = new WeakMap<Wire, string>()
export const personId = (wire: Verified): string => resolvedPeople.get(wire) ?? wire.fromId

function readVerified(value: unknown, recordsOnly: boolean, now: number): Verified | undefined {
  try {
    if (!validate(value, recordsOnly)) return undefined
    if (value.type === 'gdmw:stats' && !retainedStatsDay(value.day, now)) return undefined
    const at = signedTime(value)
    if (at !== undefined) {
      if (at > now + CLOCK_SKEW_MS) return undefined
      const maxBytes = value.type === 'gdmw:stats' ? LIMITS.statsBytes : LIMITS.recordBytes
      if (value.type !== 'gdmw:vault-config' && encoder.encode(JSON.stringify(value)).byteLength > maxBytes) return undefined
    }
    if (!verifyWire(value)) return undefined
    // Older vault configs have no signed time. Sync envelopes are ephemeral.
    const delegationTime = value.type === 'gdmw:vault-config' ? at : at ?? now
    const delegation = value.delegation
    const person = delegationTime !== undefined && verifyDelegationSync(delegation, value.fromId, delegationTime)
      ? delegation.root : value.fromId
    resolvedPeople.set(value, person)
    return value as Verified
  } catch {
    return undefined
  }
}

export function readWire(value: unknown, now = Date.now()): Verified | undefined {
  return readVerified(value, false, now)
}
export function readRecord(value: unknown, now = Date.now()): VerifiedRecord | undefined {
  return readVerified(value, true, now) as VerifiedRecord | undefined
}
export function isCatalog(record: Wire): record is CatalogPayload & Envelope {
  return record.type === 'gdmw:project-upsert' || record.type === 'gdmw:project-delete'
    || record.type === 'gdmw:approval' || record.type === 'gdmw:revocation' || record.type === 'gdmw:profile'
    || record.type === 'gdmw:group-upsert' || record.type === 'gdmw:group-delete' || record.type === 'gdmw:group-membership'
}
export function isRecord(wire: Verified): wire is VerifiedRecord {
  return isCatalog(wire) || wire.type === 'gdmw:approval-request' || wire.type === 'gdmw:request-reject' || wire.type === 'gdmw:stats'
}

export async function makeWire<T extends WirePayload>(identity: DidIdentity, payload: T): Promise<Verified<T & Envelope>> {
  const delegation = await loadDelegationFor(identity.did)
  const fields = {
    ...payload, v: 1, roomId: GLOBAL_ROOM_ID, fromId: identity.did,
    ...(payload.type === 'gdmw:vault-config' && delegation && { configuredAt: payload.configuredAt ?? Date.now() }),
  }
  const wire = readWire(await signWireWithDelegation(fields, identity, delegation))
  if (!wire) throw new Error('入力内容と署名を確認してください。')
  return wire as unknown as Verified<T & Envelope>
}
