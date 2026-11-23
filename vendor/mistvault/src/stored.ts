export function read(key: string, storage?: Storage): unknown { try { return JSON.parse(storage?.getItem(key) ?? 'null') } catch { return null } }
export function write(key: string, value: unknown, storage?: Storage): void { try { storage?.setItem(key, JSON.stringify(value)) } catch { /* Storage is optional. */ } }

type Listener = (storage: Storage | undefined, key: string | null) => void
const listeners = new Set<Listener>()
export function notifyStored(storage: Storage | undefined, key: string) {
  for (const cb of listeners) cb(storage, key)
}
export function subscribeStored(cb: () => void, storage: Storage | undefined, target: EventTarget | undefined,
  relevant: (key: string | null) => boolean): () => void {
  const local: Listener = (area, key) => { if (area === storage && relevant(key)) cb() }
  const external = (event: Event) => {
    const e = event as StorageEvent
    if ((!e.storageArea || e.storageArea === storage) && relevant(e.key)) cb()
  }
  listeners.add(local); target?.addEventListener('storage', external)
  return () => { listeners.delete(local); target?.removeEventListener('storage', external) }
}
