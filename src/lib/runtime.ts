import { ROOT_ADMIN_DIDS } from '../config'
import { ensureSharedDidIdentity } from '../crypto/didIdentity'
import { policyTime } from './authz'
import { createRecordStore, deriveCatalog } from './catalogStore'
import { createLocalPerson } from './didPairing'
import { DAY_MS } from './delegation'
import { catalogReplica, identityBackend, opfsReplica } from './mistClient'
import { attachMirror, attachReplicaMirror } from './mirror'
import { createNetwork } from './network'
import type { NetworkView } from './network'
import { createLocalPreferences } from './localPreferences'
import { createRequestStore, pendingRequests } from './requests'
import { utcDay, utcDayStart } from './statsDays'
import { createStatsPublisher } from './statsPublisher'
import { createStatsStore, parseStatsSnapshot, STATS_KEY } from './statsStore'
import { createCatalogAdapter } from './vault/catalogAdapter'
import { createSharedVault } from './vault/controllers'
import { bounded, isCatalog, LIMITS, makeWire, personId, REQUEST_INTERVAL_MS, validProjectFields } from './wires'
import type { CatalogRecord, ProjectFields, RequestRecord, Role, StatsMetric, StatsRecord, VerifiedRecord } from './wires'

const transientIdentity = new Map<string, string>()
const identityStorage = {
  getItem(key: string) { try { return localStorage.getItem(key) ?? transientIdentity.get(key) ?? null } catch { return transientIdentity.get(key) ?? null } },
  setItem(key: string, value: string) {
    transientIdentity.set(key, value)
    try { localStorage.setItem(key, value) } catch { /* This session still has its identity. */ }
  },
}

export async function createRuntime() {
  const identity = await ensureSharedDidIdentity({ backend: identityBackend, storage: identityStorage })
  const store = createRecordStore<CatalogRecord>()
  const requests = createRequestStore()
  const stats = createStatsStore()
  const preferences = createLocalPreferences()
  const mirror = attachMirror(store, catalogReplica)
  const statsMirror = attachReplicaMirror(stats, opfsReplica(STATS_KEY), {
    key: STATS_KEY, parse: parseStatsSnapshot, cacheEpoch: () => utcDay(Date.now()),
  })
  const listeners = new Set<() => void>()
  let networkView: NetworkView = { status: 'joining', peers: 0 }
  let catalog = deriveCatalog(store.get(), ROOT_ADMIN_DIDS, Date.now())
  let nextPolicy = Infinity
  let policyTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let profileOwner: string | undefined
  let profileWrites = Promise.resolve()

  const emit = () => { for (const cb of listeners) cb() }
  const localPerson = createLocalPerson(identity.did, () => {
    bootstrapProfile()
    emit()
  })
  function updateCatalog() {
    const now = Date.now()
    const records = store.get()
    catalog = deriveCatalog(records, ROOT_ADMIN_DIDS, now)
    nextPolicy = Infinity
    for (const record of records) {
      if (record.type !== 'gdmw:approval' && record.type !== 'gdmw:revocation') continue
      const at = policyTime(record)
      if (at > now) nextPolicy = Math.min(nextPolicy, at)
      if (record.type === 'gdmw:approval' && record.expiresAt !== undefined && record.expiresAt > now) {
        nextPolicy = Math.min(nextPolicy, record.expiresAt)
      }
    }
    clearTimeout(policyTimer)
    if (Number.isFinite(nextPolicy)) policyTimer = setTimeout(updateCatalog, Math.min(nextPolicy - now, 2_147_483_647))
    bootstrapProfile()
    emit()
  }
  const current = () => {
    if (Date.now() >= nextPolicy) updateCatalog()
    return catalog
  }
  const isAdmin = (did: string) => current().roles.get(did) === 'admin'
  const offCatalog = store.subscribe(updateCatalog)
  const offRequests = requests.subscribe(emit)
  const offPreferences = preferences.subscribe(emit)
  const offStats = stats.subscribe(emit)
  let statsRollover: ReturnType<typeof setTimeout>
  function scheduleStatsRollover() {
    const now = Date.now()
    statsRollover = setTimeout(() => {
      stats.prune()
      void statsMirror.refresh()
      emit()
      scheduleStatsRollover()
    }, utcDayStart(now) + DAY_MS - now)
  }
  scheduleStatsRollover()
  function receive(records: readonly VerifiedRecord[], live: boolean) {
    const catalogRecords: CatalogRecord[] = []
    const requestRecords: RequestRecord[] = []
    const statRecords: StatsRecord[] = []
    for (const record of records) {
      if (isCatalog(record)) catalogRecords.push(record)
      else if (record.type === 'gdmw:stats') statRecords.push(record)
      else requestRecords.push(record)
    }
    store.merge(catalogRecords)
    requests.merge(requestRecords, live)
    if (statRecords.length) stats.merge(statRecords)
  }

  let previouslyWriter = false
  const network = createNetwork({
    identity,
    snapshot: () => [...store.get(), ...requests.get(), ...stats.get()],
    has: key => store.has(key) || stats.has(key) || requests.get().some(record => record.signature === key),
    receive,
    receiveConfig: wire => sharedVault.receive(wire),
    broadcastConfig: to => sharedVault.announce(to),
    changed(view) {
      networkView = view
      const writer = network.isWriter()
      if (writer && !previouslyWriter && store.get().length) sharedVault.panel.changed()
      previouslyWriter = writer
      emit()
    },
  })
  const sharedVault = createSharedVault({
    identity, adapter: createCatalogAdapter(store, mirror.ready),
    isWriter: () => network.isWriter() && store.get().length > 0,
    isAdmin,
    selfId: () => localPerson.get().id,
    send: network.send,
  })
  network.start()
  const publish = (wire: VerifiedRecord) => {
    receive([wire], false)
    network.send(null, wire)
  }
  const statsPublisher = createStatsPublisher({ identity, selfId: () => localPerson.get().id, store: stats, ready: statsMirror.ready, publish })
  function writeProfile(did: string, name: string, onlyIfMissing = false) {
    const operation = profileWrites.then(async () => {
      await mirror.ready
      const eligible = () => !disposed && localPerson.get().id === did && !!current().roles.get(did)
        && (!onlyIfMissing || preferences.get().displayName?.value.trim() === name)
      while (eligible()) {
        const previous = catalog.profiles.get(did)
        if (previous && (onlyIfMissing || previous.displayName === name)) return
        const updatedAt = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1)
        const wire = await makeWire(identity, { type: 'gdmw:profile', displayName: name, updatedAt })
        if (!eligible() || personId(wire) !== did) return
        // A peer may have updated the same profile while this leaf was signing.
        if (catalog.profiles.get(did)?.signature !== previous?.signature) continue
        publish(wire)
        return
      }
    })
    profileWrites = operation.catch(() => {})
    return operation
  }
  function bootstrapProfile() {
    const did = localPerson.get().id
    const approved = catalog.roles.get(did) ? did : undefined
    if (approved === profileOwner) return
    profileOwner = approved
    const name = preferences.get().displayName?.value.trim()
    if (approved && name && !catalog.profiles.has(approved)) {
      void writeProfile(approved, name, true).catch(reason => console.error('profile publish', reason))
    }
  }
  async function saveDisplayName(value: string) {
    const name = value.trim()
    if (!bounded(name, LIMITS.displayName, true)) throw new Error('入力内容を確認してください。')
    const did = localPerson.get().id
    if (name !== preferences.get().displayName?.value) preferences.setName(name)
    if (name) await writeProfile(did, name)
  }
  bootstrapProfile()
  const requireAdmin = () => {
    const id = localPerson.get().id
    if (!isAdmin(id)) throw new Error('管理者権限が必要です。')
    return id
  }
  const requireMember = () => {
    const id = localPerson.get().id
    if (!current().roles.get(id)) throw new Error('投稿には承認が必要です。')
    return id
  }
  function requireSamePerson(wire: VerifiedRecord, id: string) {
    if (localPerson.get().id !== id || personId(wire) !== id) {
      throw new Error('mistl の連携状態が変わりました。確認してからもう一度お試しください。')
    }
  }
  return {
    identity, preferences, scopeVault: sharedVault.panel,
    getSelf: localPerson.get,
    refreshDelegation: localPerson.refresh,
    getCatalog: current,
    getNetwork: () => networkView,
    trackProject(projectId: string, metric: StatsMetric) {
      const project = current().projects.get(projectId)
      if (project) statsPublisher.track(projectId, personId(project), metric)
    },
    getProjectStats(projectId: string) {
      const project = current().projects.get(projectId)
      if (!project) return
      const self = localPerson.get().id
      const author = personId(project)
      if (self === author || isAdmin(self)) return stats.summary(projectId, author)
    },
    displayNameFor(did: string) {
      const { roles, profiles } = current()
      if (roles.get(did)) return profiles.get(did)?.displayName ?? requests.latest(did)?.displayName.trim()
    },
    saveDisplayName,
    getRequests: () => isAdmin(localPerson.get().id) ? pendingRequests(requests.get(), store.get(), current().roles) : [],
    getKnownLeaves() {
      const leaves = new Map<string, Set<string>>()
      const roles = current().roles
      function add(person: string, leaf: string) {
        if (person === leaf || !roles.get(person)) return
        const known = leaves.get(person) ?? new Set<string>()
        known.add(leaf)
        leaves.set(person, known)
      }
      for (const wire of store.get()) add(personId(wire), wire.fromId)
      for (const wire of requests.get()) add(personId(wire), wire.fromId)
      add(localPerson.get().id, identity.did)
      return leaves
    },
    subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } },

    async saveProject(fields: ProjectFields, id?: string) {
      const check = () => {
        const author = requireMember()
        const previous = id ? current().projects.get(id) : undefined
        if (id && (!previous || personId(previous) !== author)) throw new Error('このプロジェクトを編集できません。')
        return previous
      }
      const author = localPerson.get().id
      const previous = check()
      if (!validProjectFields(fields)) throw new Error('入力内容を確認してください。URL は http:// または https:// で入力してください。')
      const projectId = id ?? crypto.randomUUID()
      const updatedAt = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1)
      const wire = await makeWire(identity, {
        ...fields, type: 'gdmw:project-upsert', projectId,
        updatedAt, createdAt: previous?.createdAt ?? updatedAt, rev: (previous?.rev ?? 0) + 1,
      })
      requireSamePerson(wire, author)
      check()
      publish(wire)
      return projectId
    },
    async deleteProject(projectId: string) {
      const check = () => {
        const author = requireMember()
        const project = current().projects.get(projectId)
        if (!project || !(personId(project) === author || isAdmin(author))) {
          throw new Error('このプロジェクトを削除できません。')
        }
        return project
      }
      const author = localPerson.get().id
      const project = check()
      const wire = await makeWire(identity, {
        type: 'gdmw:project-delete', projectId, deletedAt: Math.max(Date.now(), project.updatedAt),
      })
      requireSamePerson(wire, author)
      if (check().signature !== project.signature) throw new Error('更新されたプロジェクトを開き直してください。')
      publish(wire)
    },
    async approve(subject: string, role: Role, requestSignature?: string) {
      const admin = requireAdmin()
      if (ROOT_ADMIN_DIDS.includes(subject)) throw new Error('ルート管理者の権限は構成ファイルで管理します。')
      const wire = await makeWire(identity, { type: 'gdmw:approval', subject, role, issuedAt: Date.now(), requestSignature })
      requireSamePerson(wire, admin)
      requireAdmin()
      publish(wire)
    },
    async revoke(subject: string) {
      const admin = requireAdmin()
      if (ROOT_ADMIN_DIDS.includes(subject)) throw new Error('ルート管理者の権限は構成ファイルで管理します。')
      const wire = await makeWire(identity, { type: 'gdmw:revocation', subject, revokedAt: Date.now() })
      requireSamePerson(wire, admin)
      requireAdmin()
      publish(wire)
    },
    async reject(subject: string, requestSignature: string) {
      const admin = requireAdmin()
      const wire = await makeWire(identity, { type: 'gdmw:request-reject', subject, requestSignature, rejectedAt: Date.now() })
      requireSamePerson(wire, admin)
      requireAdmin()
      publish(wire)
    },
    async requestApproval(displayName: string, message: string) {
      const requester = localPerson.get().id
      const check = () => {
        const now = Date.now()
        if ((requests.latest(requester)?.requestedAt ?? -Infinity) + REQUEST_INTERVAL_MS > now) {
          throw new Error('承認申請を続けて送る場合は、1分ほどお待ちください。')
        }
        return now
      }
      const name = displayName.trim()
      if (!bounded(name, LIMITS.displayName)) throw new Error('入力内容を確認してください。')
      if (current().roles.get(requester)) {
        await saveDisplayName(name)
        return false
      }
      const wire = await makeWire(identity, { type: 'gdmw:approval-request', displayName: name, message, requestedAt: check() })
      requireSamePerson(wire, requester)
      const requested = !current().roles.get(requester)
      if (requested) {
        check()
        publish(wire)
      }
      await saveDisplayName(name)
      return requested
    },
    dispose() {
      disposed = true
      sharedVault.dispose()
      network.dispose()
      mirror.dispose()
      statsPublisher.dispose()
      statsMirror.dispose()
      localPerson.dispose()
      offCatalog(); offRequests(); offPreferences()
      offStats()
      clearTimeout(policyTimer)
      clearTimeout(statsRollover)
    },
  }
}

export type Runtime = Awaited<ReturnType<typeof createRuntime>>
