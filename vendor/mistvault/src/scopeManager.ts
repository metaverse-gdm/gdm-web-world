import type { EscrowTransport } from './core/client.js'
import { openScopeVault } from './scopeVault.js'
import type { ScopeVault, ScopeVaultOptions } from './scopeVault.js'
import type { AcquireTransport } from './session.js'

export type ManagedScope<S> = Pick<ScopeVaultOptions<S>, 'roomId' | 'adapter' | 'isWriter' | 'defaultConfig'>
export interface ScopeVaultManagerOptions extends Pick<ScopeVaultOptions<unknown>, 'app' | 'nodeId' | 'storage' | 'now' | 'partGcGraceMs'> {
  transportFor(room: string): EscrowTransport
}
export interface ScopeVaultManager<S = unknown> {
  sync(scopes: readonly ManagedScope<S>[]): void
  get(roomId: string): ScopeVault | undefined
  rooms(): string[]
  subscribe(cb: () => void): () => void
  dispose(): void
}

interface Room {
  source: EscrowTransport
  leases: number
  members: Set<() => boolean>
  joined?: Promise<void>
}

function roomPool(transportFor: (room: string) => EscrowTransport): AcquireTransport {
  const pool = new Map<string, Room>()
  return (id, hasProvider) => {
    const room: Room = pool.get(id) ?? { source: transportFor(id), leases: 0, members: new Set() }
    pool.set(id, room)
    room.leases++
    let lastJoin: Promise<void> | undefined
    let probedJoin: Promise<void> | undefined
    const { source } = room
    function leave() {
      if (room.members.delete(hasProvider) && !room.members.size && room.joined) {
        room.joined = undefined; source.leave(id)
      }
    }
    return {
      transport: {
        join() {
          room.members.add(hasProvider)
          if (room.joined && room.joined === lastJoin) {
            // Probe once if a co-tenant still sees a provider. Its view may also
            // be stale, so a second unsuccessful discovery forces a fresh join.
            if (probedJoin !== room.joined && [...room.members].some(connected => connected())) {
              probedJoin = room.joined
            } else {
              room.joined = undefined
              source.leave(id)
            }
          }
          room.joined ??= source.join(id)
          lastJoin = room.joined
          return lastJoin
        },
        leave,
        send: (_, to, bytes) => source.send(id, to, bytes),
        onMessage: (_, cb) => source.onMessage(id, cb),
        onPeer: (_, cb) => source.onPeer(id, cb),
        storageAdd: (name, bytes) => source.storageAdd(name, bytes),
        storageGet: cid => source.storageGet(cid),
      },
      providerFound() { probedJoin = undefined },
      release() { leave(); if (--room.leases === 0) pool.delete(id) },
    }
  }
}

export function createScopeVaultManager<S = unknown>(o: ScopeVaultManagerOptions): ScopeVaultManager<S> {
  const acquire = roomPool(room => o.transportFor(room))
  const listeners = new Set<() => void>()
  const entries = new Map<string, { scope: ManagedScope<S>; vault: ScopeVault; room: string; off(): void }>()
  let disposed = false
  function emit() {
    for (const cb of listeners) { try { cb() } catch { /* Isolate subscribers. */ } }
  }
  function remove(id: string) {
    const entry = entries.get(id)!
    entries.delete(id); entry.off(); entry.vault.dispose()
  }
  return {
    sync(scopes) {
      if (disposed) return
      const wanted = new Map(scopes.map(scope => [scope.roomId, scope]))
      let changed = false
      for (const [id, entry] of entries) {
        if (wanted.get(id)?.adapter !== entry.scope.adapter) { remove(id); changed = true }
      }
      for (const [id, scope] of wanted) {
        const existing = entries.get(id)
        if (existing) { existing.scope = scope; continue }
        // The closing vault still needs its own election during its final save.
        const vault: ScopeVault = openScopeVault({ ...o, ...scope, isWriter: () => entry.scope.isWriter?.() ?? true }, acquire)
        const entry = { scope, vault, room: vault.getView().room, off: vault.subscribe(view => {
          if (view.room !== entry.room) { entry.room = view.room; emit() }
        }) }
        entries.set(id, entry); changed = true
      }
      if (changed) emit()
    },
    get: id => entries.get(id)?.vault,
    rooms: () => [...new Set(Array.from(entries.values(), entry => entry.room).filter(Boolean))].sort(),
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb) } },
    dispose() {
      disposed = true
      for (const id of entries.keys()) remove(id)
      listeners.clear()
    },
  }
}
