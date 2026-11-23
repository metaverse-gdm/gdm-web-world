import type { VaultAdapter } from '@tik-choco/mistvault'
import { APP_ID } from '../../config'
import { mergeRecords } from '../catalogStore'
import { hasOnly, isCatalog, isObject, readRecord } from '../wires'
import type { CatalogRecord } from '../wires'

export type CatalogSnapshot = { v: 1; records: CatalogRecord[] }
type CatalogSource = {
  get(): CatalogRecord[]
  merge(records: CatalogRecord[]): unknown
  subscribe(cb: () => void): () => void
}

export function parseCatalogSnapshot(value: unknown): CatalogSnapshot {
  if (!isObject(value) || !hasOnly(value, ['v', 'records']) || value.v !== 1 || !Array.isArray(value.records)) {
    throw new Error('Invalid catalog checkpoint envelope')
  }
  const records: CatalogRecord[] = []
  for (const raw of value.records) {
    const record = readRecord(raw)
    if (record && isCatalog(record)) records.push(record)
  }
  return { v: 1, records: mergeRecords([], records) }
}

export function createCatalogAdapter(source: CatalogSource, ready: Promise<void> = Promise.resolve()): VaultAdapter<CatalogSnapshot> {
  return {
    app: APP_ID,
    schema: 'gdm-world.catalog.v1',
    async snapshot() { await ready; return { v: 1, records: source.get() } },
    parse: parseCatalogSnapshot,
    merge: (local, remote) => ({ v: 1, records: mergeRecords(local.records, remote.records) }),
    // Re-union with live state, preserving edits that arrived during restore.
    apply: next => { source.merge(next.records) },
    subscribe: source.subscribe,
  }
}
