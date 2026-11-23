import { computeAuthorizations } from './authz'
import { compareStrings } from './wireSign'
import { personId } from './wires'
import type { CatalogRecord, DeleteRecord, PolicyRecord, ProfileRecord, ProjectRecord, Role } from './wires'

export function mergeRecords<T extends { signature: string }>(left: readonly T[], right: readonly T[]): T[] {
  const records = new Map([...left, ...right].map(record => [record.signature, record]))
  return [...records.values()].sort((a, b) => compareStrings(a.signature, b.signature))
}

const claimOrder = (a: ProjectRecord, b: ProjectRecord) =>
  a.createdAt - b.createdAt || compareStrings(personId(a), personId(b)) || compareStrings(a.fromId, b.fromId)
export const editOrder = (a: ProjectRecord, b: ProjectRecord) =>
  a.updatedAt - b.updatedAt || a.rev - b.rev || compareStrings(a.signature, b.signature)
const deleteOrder = (a: DeleteRecord, b: DeleteRecord) =>
  a.deletedAt - b.deletedAt || compareStrings(a.signature, b.signature)

export type Catalog = {
  roles: Map<string, Role | null>
  projects: Map<string, ProjectRecord>
  owners: Map<string, ProjectRecord>
  tombstones: Map<string, DeleteRecord>
  profiles: Map<string, ProfileRecord>
}

export function deriveCatalog(records: readonly CatalogRecord[], roots: readonly string[], now: number): Catalog {
  const policy: PolicyRecord[] = []
  const upserts = new Map<string, ProjectRecord[]>()
  const deletes: DeleteRecord[] = []
  const profiles = new Map<string, ProfileRecord>()
  for (const record of records) {
    if (record.type === 'gdmw:approval' || record.type === 'gdmw:revocation') policy.push(record)
    else if (record.type === 'gdmw:project-delete') deletes.push(record)
    else if (record.type === 'gdmw:profile') {
      const did = personId(record)
      const previous = profiles.get(did)
      if (!previous || (record.updatedAt - previous.updatedAt || compareStrings(record.signature, previous.signature)) > 0) {
        profiles.set(did, record)
      }
    } else {
      const list = upserts.get(record.projectId) ?? []
      list.push(record)
      upserts.set(record.projectId, list)
    }
  }

  const roles = computeAuthorizations(policy, roots, now)
  for (const did of profiles.keys()) if (!roles.get(did)) profiles.delete(did)
  const historicallyEligible = new Set(policy.filter(record => record.type === 'gdmw:approval').map(record => record.subject))
  const historicalRoles = new Map<number, ReturnType<typeof computeAuthorizations>>()
  const roleAt = (did: string, at: number) => {
    if (!historicallyEligible.has(did) || at > now) return null
    let historical = historicalRoles.get(at)
    if (!historical) {
      historical = computeAuthorizations(policy, roots, at)
      historicalRoles.set(at, historical)
    }
    return historical.get(did)
  }
  const eligibleClaim = (record: ProjectRecord) => roles.get(personId(record)) || roleAt(personId(record), record.createdAt)

  const owners = new Map<string, ProjectRecord>()
  const projects = new Map<string, ProjectRecord>()
  const tombstones = new Map<string, DeleteRecord>()
  for (const [id, list] of upserts) {
    list.sort(claimOrder)
    // Revision 1 claims the UUID. Later revisions can arrive first, but
    // they cannot replace the original author or establish ownership.
    const owner = list.find(record => record.rev === 1 && eligibleClaim(record))
    if (!owner) continue
    owners.set(id, owner)
    const author = personId(owner)
    if (!roles.get(author)) continue
    const latest = list.reduce((winner, record) =>
      personId(record) === author && record.createdAt === owner.createdAt && editOrder(record, winner) > 0
        ? record : winner, owner)
    projects.set(id, latest)
  }

  for (const record of deletes) {
    const owner = owners.get(record.projectId)
    const author = personId(record)
    const role = roles.get(author)
    const oldRole = role === 'admin' ? null : roleAt(author, record.deletedAt)
    if (!(role === 'admin' || oldRole === 'admin' || (role || oldRole) && (!owner || personId(owner) === author))) continue
    const previous = tombstones.get(record.projectId)
    if (!previous || deleteOrder(record, previous) > 0) tombstones.set(record.projectId, record)
  }
  for (const [id, tombstone] of tombstones) {
    const project = projects.get(id)
    if (project && tombstone.deletedAt >= project.updatedAt) projects.delete(id)
  }
  return { roles, projects, owners, tombstones, profiles }
}

export function createRecordStore<T extends { signature: string }>(keyOf: (record: T) => string = record => record.signature) {
  const byKey = new Map<string, T>()
  const listeners = new Set<() => void>()
  let cache: T[] | undefined
  return {
    get: () => cache ??= mergeRecords([], [...byKey.values()]),
    has: (signature: string) => byKey.has(signature),
    merge(incoming: readonly T[]) {
      let changed = false
      for (const record of incoming) {
        const key = keyOf(record)
        if (byKey.get(key)?.signature === record.signature) continue
        byKey.set(key, record)
        changed = true
      }
      if (changed) {
        cache = undefined
        for (const cb of listeners) cb()
      }
      return changed
    },
    subscribe(cb: () => void) {
      listeners.add(cb)
      return () => { listeners.delete(cb) }
    },
  }
}
