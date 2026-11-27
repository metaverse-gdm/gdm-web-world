import { computeAuthorizations } from './authz'
import { compareStrings } from './wireSign'
import { personId } from './wires'
import type {
  CatalogRecord, DeleteRecord, GroupDeleteRecord, GroupRecord, MembershipRecord, PolicyRecord, ProfileRecord, ProjectRecord, Role,
} from './wires'

export function mergeRecords<T extends { signature: string }>(left: readonly T[], right: readonly T[]): T[] {
  const records = new Map([...left, ...right].map(record => [record.signature, record]))
  return [...records.values()].sort((a, b) => compareStrings(a.signature, b.signature))
}

type Owned = ProjectRecord | GroupRecord
type Removal = DeleteRecord | GroupDeleteRecord

const claimOrder = (a: Owned, b: Owned) =>
  a.createdAt - b.createdAt || compareStrings(personId(a), personId(b)) || compareStrings(a.fromId, b.fromId)
export const editOrder = (a: Owned, b: Owned) =>
  a.updatedAt - b.updatedAt || a.rev - b.rev || compareStrings(a.signature, b.signature)
const deleteOrder = (a: Removal, b: Removal) =>
  a.deletedAt - b.deletedAt || compareStrings(a.signature, b.signature)
const membershipOrder = (a: MembershipRecord, b: MembershipRecord) =>
  a.updatedAt - b.updatedAt || compareStrings(a.signature, b.signature)

/**
 * A group as currently shown. Listed people with a current role are `members`
 * once they accept (owner first), `invited` until they answer, and `declined`
 * after declining or leaving; a declined person can still accept later.
 */
export type GroupView = { record: GroupRecord; owner: string; members: string[]; invited: string[]; declined: string[] }

export type Catalog = {
  roles: Map<string, Role | null>
  projects: Map<string, ProjectRecord>
  owners: Map<string, ProjectRecord>
  tombstones: Map<string, DeleteRecord>
  profiles: Map<string, ProfileRecord>
  groups: Map<string, GroupView>
}

type RoleAt = (did: string, at: number) => Role | null | undefined

/**
 * Shared ownership rules for projects and groups. Revision 1 claims the UUID,
 * later revisions can arrive first but cannot replace the original author,
 * and a tombstone at or after the latest edit hides the resource.
 */
function resolveOwned<T extends Owned, D extends Removal>(
  upserts: ReadonlyMap<string, T[]>, deletes: readonly D[], idOf: (record: D) => string,
  roles: ReadonlyMap<string, Role | null>, roleAt: RoleAt,
) {
  const eligibleClaim = (record: T) => roles.get(personId(record)) || roleAt(personId(record), record.createdAt)
  const owners = new Map<string, T>()
  const live = new Map<string, T>()
  const tombstones = new Map<string, D>()
  for (const [id, list] of upserts) {
    list.sort(claimOrder)
    const owner = list.find(record => record.rev === 1 && eligibleClaim(record))
    if (!owner) continue
    owners.set(id, owner)
    const author = personId(owner)
    if (!roles.get(author)) continue
    const latest = list.reduce((winner, record) =>
      personId(record) === author && record.createdAt === owner.createdAt && editOrder(record, winner) > 0
        ? record : winner, owner)
    live.set(id, latest)
  }
  for (const record of deletes) {
    const id = idOf(record)
    const owner = owners.get(id)
    const author = personId(record)
    const role = roles.get(author)
    const oldRole = role === 'admin' ? null : roleAt(author, record.deletedAt)
    if (!(role === 'admin' || oldRole === 'admin' || (role || oldRole) && (!owner || personId(owner) === author))) continue
    const previous = tombstones.get(id)
    if (!previous || deleteOrder(record, previous) > 0) tombstones.set(id, record)
  }
  for (const [id, tombstone] of tombstones) {
    const latest = live.get(id)
    if (latest && tombstone.deletedAt >= latest.updatedAt) live.delete(id)
  }
  return { owners, live, tombstones }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

export function deriveCatalog(records: readonly CatalogRecord[], roots: readonly string[], now: number): Catalog {
  const policy: PolicyRecord[] = []
  const upserts = new Map<string, ProjectRecord[]>()
  const deletes: DeleteRecord[] = []
  const groupUpserts = new Map<string, GroupRecord[]>()
  const groupDeletes: GroupDeleteRecord[] = []
  const memberships = new Map<string, MembershipRecord>()
  const profiles = new Map<string, ProfileRecord>()
  for (const record of records) {
    switch (record.type) {
      case 'gdmw:approval':
      case 'gdmw:revocation': policy.push(record); break
      case 'gdmw:project-delete': deletes.push(record); break
      case 'gdmw:project-upsert': push(upserts, record.projectId, record); break
      case 'gdmw:group-upsert': push(groupUpserts, record.groupId, record); break
      case 'gdmw:group-delete': groupDeletes.push(record); break
      case 'gdmw:group-membership': {
        const key = `${record.groupId} ${personId(record)}`
        const previous = memberships.get(key)
        if (!previous || membershipOrder(record, previous) > 0) memberships.set(key, record)
        break
      }
      case 'gdmw:profile': {
        const did = personId(record)
        const previous = profiles.get(did)
        if (!previous || (record.updatedAt - previous.updatedAt || compareStrings(record.signature, previous.signature)) > 0) {
          profiles.set(did, record)
        }
      }
    }
  }

  const roles = computeAuthorizations(policy, roots, now)
  for (const did of profiles.keys()) if (!roles.get(did)) profiles.delete(did)
  const historicallyEligible = new Set(policy.filter(record => record.type === 'gdmw:approval').map(record => record.subject))
  const historicalRoles = new Map<number, ReturnType<typeof computeAuthorizations>>()
  const roleAt: RoleAt = (did, at) => {
    if (!historicallyEligible.has(did) || at > now) return null
    let historical = historicalRoles.get(at)
    if (!historical) {
      historical = computeAuthorizations(policy, roots, at)
      historicalRoles.set(at, historical)
    }
    return historical.get(did)
  }

  const { owners, live: projects, tombstones } = resolveOwned(upserts, deletes, record => record.projectId, roles, roleAt)
  const groups = new Map<string, GroupView>()
  for (const [id, record] of resolveOwned(groupUpserts, groupDeletes, record => record.groupId, roles, roleAt).live) {
    const owner = personId(record)
    const members = [owner]
    const invited: string[] = []
    const declined: string[] = []
    for (const did of record.members) {
      if (did === owner || !roles.get(did)) continue
      const joined = memberships.get(`${id} ${did}`)?.joined
      const list = joined ? members : joined === false ? declined : invited
      list.push(did)
    }
    groups.set(id, { record, owner, members, invited, declined })
  }
  return { roles, projects, owners, tombstones, profiles, groups }
}

/** The group a project is shown under, while its author is a current member. */
export function projectGroup(catalog: Pick<Catalog, 'groups'>, project: ProjectRecord) {
  const group = project.groupId === undefined ? undefined : catalog.groups.get(project.groupId)
  return group?.members.includes(personId(project)) ? group : undefined
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
