import type { CatalogRecord } from './wires'
import { parseCatalogSnapshot } from './vault/catalogAdapter'

const KEY = 'gdm-world:catalog:v1'
export type Replica = {
  read(): Promise<string | null>
  write(value: string): Promise<void>
}

export function browserReplica(key: string): Replica {
  return {
    async read() { return localStorage.getItem(key) },
    async write(value) { localStorage.setItem(key, value) },
  }
}

type MirrorSource<T> = {
  get(): T[]
  merge(records: readonly T[]): boolean
  subscribe(cb: () => void): () => void
}

export function attachMirror(source: MirrorSource<CatalogRecord>, primary: Replica, fallback = browserReplica(KEY)) {
  return attachReplicaMirror(source, primary, { key: KEY, parse: parseCatalogSnapshot, fallback })
}

export function attachReplicaMirror<T>(source: MirrorSource<T>, primary: Replica, {
  key, parse, fallback = browserReplica(key), cacheEpoch = () => '',
}: {
  key: string; parse(value: unknown): { records: T[]; pruned?: boolean }; fallback?: Replica; cacheEpoch?(): string
}) {
  let applying = false
  let pending = false
  let disposed = false
  let operations = Promise.resolve()
  const lastRead = new Map<Replica, { raw: string | null; epoch: string }>()
  let channel: BroadcastChannel | undefined
  try { if (typeof BroadcastChannel === 'function') channel = new BroadcastChannel(key) }
  catch { /* The mirror still works without cross-tab notifications. */ }
  const merge = (records: T[]) => {
    applying = true
    try { source.merge(records) } finally { applying = false }
  }
  async function readReplica(replica: Replica) {
    try {
      let raw = await replica.read()
      const epoch = cacheEpoch()
      const cached = lastRead.get(replica)
      if (raw !== null && (raw !== cached?.raw || epoch !== cached.epoch)) {
        const { records, pruned } = parse(JSON.parse(raw))
        merge(records)
        if (pruned) {
          const cleaned = JSON.stringify({ v: 1, records })
          try { await replica.write(cleaned); raw = cleaned }
          catch { lastRead.delete(replica); return true }
        }
      }
      lastRead.set(replica, { raw, epoch })
      return true
    } catch {
      return false
    }
  }
  function exclusive(op: () => Promise<void>) {
    return navigator.locks ? navigator.locks.request(key, op) : op()
  }
  async function refresh() {
    await readReplica(fallback)
    await readReplica(primary)
  }
  async function flush() {
    const fallbackReadable = await readReplica(fallback)
    const primaryReadable = await readReplica(primary)
    const epoch = cacheEpoch()
    const records = source.get()
    if (!records.length) return
    const payload = JSON.stringify({ v: 1, records })
    for (const replica of [primaryReadable ? primary : null, fallbackReadable ? fallback : null]) {
      if (!replica) continue
      try {
        await replica.write(payload)
        lastRead.set(replica, { raw: payload, epoch })
        channel?.postMessage('changed')
        return
      } catch { /* Retry via the other replica or a later edit. */ }
    }
  }
  function enqueue(op: () => Promise<void>) {
    operations = operations.then(() => disposed ? undefined : exclusive(op)).catch(() => {
      // Local persistence remains best-effort if the browser denies storage.
    })
    return operations
  }
  const ready = enqueue(refresh)
  const off = source.subscribe(() => {
    if (applying || pending) return
    pending = true
    void enqueue(async () => {
      pending = false
      await flush()
    })
  })
  if (channel) channel.onmessage = () => { void enqueue(refresh) }
  return { ready, refresh: () => enqueue(refresh), drained: () => operations, dispose() { disposed = true; off(); channel?.close() } }
}
