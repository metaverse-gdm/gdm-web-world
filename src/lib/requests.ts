import { compareStrings } from './wireSign'
import { isObject, personId, readRecord, REQUEST_INTERVAL_MS } from './wires'
import type { CatalogRecord, RequestRecord, Role } from './wires'

const KEY = 'gdm-world:approval-requests:v1'
type Request = Extract<RequestRecord, { type: 'gdmw:approval-request' }>

export function createRequestStore() {
  const byDid = new Map<string, Request>()
  const decisions = new Map<string, Extract<RequestRecord, { type: 'gdmw:request-reject' }>>()
  const lastLive = new Map<string, number>()
  const listeners = new Set<() => void>()
  const get = (): RequestRecord[] => [...byDid.values(), ...decisions.values()]
  const replace = (record: RequestRecord) => {
    const person = personId(record)
    if (record.type === 'gdmw:approval-request') {
      const old = byDid.get(person)
      if (old && (record.requestedAt - old.requestedAt || compareStrings(record.signature, old.signature)) <= 0) return false
      byDid.set(person, record)
    } else {
      const key = `${record.subject}:${record.requestSignature}:${person}`
      const old = decisions.get(key)
      if (old && (record.rejectedAt - old.rejectedAt || compareStrings(record.signature, old.signature)) <= 0) return false
      decisions.set(key, record)
    }
    return true
  }

  let readable = false
  function load() {
    try {
      const raw = localStorage.getItem(KEY)
      const value: unknown = raw === null ? { v: 1, records: [] } : JSON.parse(raw)
      if (!isObject(value) || value.v !== 1 || !Array.isArray(value.records)) return
      for (const entry of value.records) {
        const record = readRecord(entry)
        if (record?.type === 'gdmw:approval-request' || record?.type === 'gdmw:request-reject') replace(record)
      }
      readable = true
    } catch { /* Keep the in-memory queue. */ }
  }
  load()
  return {
    get,
    latest: (did: string) => byDid.get(did),
    merge(incoming: readonly RequestRecord[], live = false, now = Date.now()) {
      let changed = false
      for (const record of incoming) {
        if (record.type === 'gdmw:approval-request') {
          const person = personId(record)
          if (live && (lastLive.get(person) ?? -Infinity) + REQUEST_INTERVAL_MS > now) continue
          if (live) lastLive.set(person, now)
        }
        changed = replace(record) || changed
      }
      if (!changed) return
      if (!readable) load()
      if (readable) try { localStorage.setItem(KEY, JSON.stringify({ v: 1, records: get() })) } catch { /* Best effort. */ }
      for (const cb of listeners) cb()
    },
    subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } },
  }
}

export function pendingRequests(
  requests: readonly RequestRecord[], catalog: readonly CatalogRecord[], roles: Map<string, Role | null>,
): Request[] {
  const closed = new Set<string>()
  for (const record of [...requests, ...catalog]) {
    if (!('requestSignature' in record) || !record.requestSignature || roles.get(personId(record)) !== 'admin') continue
    closed.add(`${record.subject}:${record.requestSignature}`)
  }
  return requests.filter((record): record is Request => record.type === 'gdmw:approval-request'
    && !roles.get(personId(record)) && !closed.has(`${personId(record)}:${record.signature}`))
    .sort((a, b) => b.requestedAt - a.requestedAt || compareStrings(a.signature, b.signature))
}
