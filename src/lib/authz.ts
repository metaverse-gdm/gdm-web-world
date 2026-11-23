import { compareStrings } from './wireSign'
import { personId } from './wires'
import type { PolicyRecord, Role } from './wires'

export function policyTime(record: PolicyRecord): number {
  return record.type === 'gdmw:approval' ? record.issuedAt : record.revokedAt
}

/** Uses the issuer's current admin role. The winning grant must trace back to a root. */
export function computeAuthorizations(
  records: readonly PolicyRecord[], roots: readonly string[], now: number,
): Map<string, Role | null> {
  const rootSet = new Set(roots)
  const candidates = new Map<string, PolicyRecord[]>()
  const roles = new Map<string, Role | null>(roots.map(did => [did, 'admin']))
  for (const record of records) {
    if (rootSet.has(record.subject)) continue
    roles.set(record.subject, null)
    if (policyTime(record) > now) continue
    const list = candidates.get(record.subject) ?? []
    list.push(record)
    candidates.set(record.subject, list)
  }
  for (const list of candidates.values()) {
    list.sort((a, b) => Number(rootSet.has(personId(b))) - Number(rootSet.has(personId(a)))
      || policyTime(b) - policyTime(a)
      || Number(b.type === 'gdmw:revocation') - Number(a.type === 'gdmw:revocation')
      || compareStrings(b.signature, a.signature))
  }

  const blocked = new Set<string>()
  let eligible = new Set(roots)
  const seen = new Map<string, number>()
  let states: Set<string>[] = []

  for (;;) {
    const grants = new Map<string, { subject: string; role: Role }[]>()
    for (const [subject, list] of candidates) {
      const winner = list.find(record => eligible.has(personId(record)))
      if (!winner || winner.type !== 'gdmw:approval' || (winner.expiresAt !== undefined && winner.expiresAt <= now)) continue
      const issuer = personId(winner)
      const children = grants.get(issuer) ?? []
      children.push({ subject, role: winner.role })
      grants.set(issuer, children)
    }
    const next = new Set(roots)
    for (const did of roles.keys()) roles.set(did, rootSet.has(did) ? 'admin' : null)
    // Set iteration visits appended admins, so only rooted winning edges can confer roles.
    for (const admin of next) {
      for (const { subject, role } of grants.get(admin) ?? []) {
        if (blocked.has(subject)) continue
        roles.set(subject, role)
        if (role === 'admin') next.add(subject)
      }
    }

    if (next.size === eligible.size && Array.from(next).every(did => eligible.has(did))) return roles

    const key = [...next].sort(compareStrings).join(',')
    const repeated = seen.get(key)
    if (repeated !== undefined || states.length > 2 * candidates.size + 2) {
      // A negative dependency can oscillate (an admin revokes the DID that
      // grants their own role). Withhold the unstable grants, then reevaluate.
      const cycle = [...states.slice(repeated ?? 0), next]
      const union = new Set(cycle.flatMap(state => [...state]))
      for (const did of union) if (cycle.some(state => !state.has(did))) blocked.add(did)
      states = []
      seen.clear()
      eligible = new Set(roots)
    } else {
      seen.set(key, states.length)
      states.push(next)
      eligible = next
    }
  }
}
