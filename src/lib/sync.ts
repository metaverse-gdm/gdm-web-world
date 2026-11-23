import type { DidIdentity } from '../crypto/didIdentity'
import { retainedStatsDay } from './statsDays'
import { LIMITS, makeWire, readRecord } from './wires'
import type { Verified, VerifiedRecord, WirePayload } from './wires'

const encode = new TextEncoder()
export function encodeFrame(value: unknown) {
  return encode.encode(JSON.stringify(value))
}
export function decodeFrame(value: unknown): unknown {
  if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) return undefined
  if (value.byteLength > LIMITS.wireBytes) return undefined
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)) }
  catch { return undefined }
}

function* chunks<T>(values: readonly T[], count: number) {
  for (let index = 0; index < values.length; index += count) yield values.slice(index, index + count)
}

export function* recordChunks(records: readonly VerifiedRecord[]) {
  const overhead = 1024 // Signed envelope, delegation and array delimiters.
  let batch: VerifiedRecord[] = []
  let bytes = overhead
  for (const record of records) {
    const size = encodeFrame(record).length + 1
    if (batch.length && (bytes + size > LIMITS.wireBytes || batch.length === LIMITS.syncRecords)) {
      yield batch
      batch = []
      bytes = overhead
    }
    if (size + overhead > LIMITS.wireBytes) continue
    batch.push(record)
    bytes += size
  }
  if (batch.length) yield batch
}

export function createHistorySync(options: {
  identity: DidIdentity
  snapshot: () => readonly VerifiedRecord[]
  has: (key: string) => boolean
  receive: (records: readonly VerifiedRecord[], live: boolean) => void
  send: (to: string | null, wire: Verified) => void
  isPeer: (id: string) => boolean
}) {
  async function send(to: string | null, payload: WirePayload) {
    const wire = await makeWire(options.identity, payload)
    if (to === null || options.isPeer(to)) options.send(to, wire)
  }
  async function announce(to: string | null) {
    const keys: string[] = []
    const stats: { signature: string; day: string }[] = []
    const now = Date.now()
    for (const record of options.snapshot()) {
      if (record.type !== 'gdmw:stats') keys.push(record.signature)
      else if (retainedStatsDay(record.day, now)) stats.push(record)
    }
    for (const chunk of chunks(keys.sort(), LIMITS.syncKeys)) {
      if (to !== null && !options.isPeer(to)) return
      await send(to, { type: 'gdmw:sync-digest', keys: chunk })
    }
    for (const chunk of chunks(stats, LIMITS.syncKeys)) {
      if (to !== null && !options.isPeer(to)) return
      await send(to, { type: 'gdmw:sync-digest', keys: chunk.map(record => record.signature), statsDays: chunk.map(record => record.day) })
    }
  }
  async function handle(from: string, wire: Verified) {
    if (wire.type === 'gdmw:sync-digest') {
      const now = Date.now()
      const eligible = wire.keys.filter((key, index) => !options.has(key)
        && (!wire.statsDays || retainedStatsDay(wire.statsDays[index], now)))
      const keys = [...new Set(eligible)]
      if (keys.length) await send(from, { type: 'gdmw:sync-want', keys })
    } else if (wire.type === 'gdmw:sync-want') {
      const wanted = new Set(wire.keys)
      const selected = options.snapshot().filter(record => wanted.has(record.signature))
      // Keep legacy catalog/request replies readable by peers that predate stats.
      for (const group of [selected.filter(record => record.type !== 'gdmw:stats'), selected.filter(record => record.type === 'gdmw:stats')]) {
        for (const records of recordChunks(group.filter(record => record.type !== 'gdmw:stats' || retainedStatsDay(record.day, Date.now())))) {
          if (!options.isPeer(from)) return
          await send(from, { type: 'gdmw:sync-records', records })
        }
      }
    } else if (wire.type === 'gdmw:sync-records') {
      const accepted: VerifiedRecord[] = []
      const seen = new Set<string>()
      for (const raw of wire.records) {
        if (seen.has(raw.signature) || options.has(raw.signature)) continue
        const record = readRecord(raw)
        if (record) { accepted.push(record); seen.add(record.signature) }
      }
      options.receive(accepted, false)
    }
  }
  return { announce, handle }
}
