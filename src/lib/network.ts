import { GLOBAL_ROOM_ID } from '../config'
import type { DidIdentity } from '../crypto/didIdentity'
import {
  acquireRoom, DELIVERY_RELIABLE, EVENT_ALL_CONNECTIONS_LOST, EVENT_PEER_CONNECTED,
  EVENT_PEER_DISCONNECTED, EVENT_RAW, EVENT_ROOM_JOIN_FAILED, EVENT_ROOM_LEFT,
  localNodeId, subscribeEvent,
} from './mistClient'
import { createHistorySync, decodeFrame, encodeFrame } from './sync'
import { isRecord, LIMITS, readWire } from './wires'
import type { Verified, VerifiedRecord } from './wires'

export type NetworkView = { status: 'joining' | 'joined' | 'offline'; peers: number }
type ConfigWire = Extract<Verified, { type: 'gdmw:vault-config' }>
type Options = {
  identity: DidIdentity
  snapshot: () => readonly VerifiedRecord[]
  has: (key: string) => boolean
  receive: (records: readonly VerifiedRecord[], live: boolean) => void
  receiveConfig: (wire: ConfigWire) => void
  broadcastConfig: (to: string | null) => void
  changed: (view: NetworkView) => void
}

export function createNetwork(options: Options) {
  const peers = new Set<string>()
  const peerTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let lease: ReturnType<typeof acquireRoom> | undefined
  let node: Awaited<NonNullable<typeof lease>['ready']> | undefined
  let status: NetworkView['status'] = 'offline'
  let retry: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const changed = () => options.changed({ status, peers: peers.size })
  const isPeer = (id: string) => peers.has(id)
  const report = (error: unknown) => console.warn('gdm-world peer sync', error)

  function send(to: string | null, wire: Verified) {
    if (!node || status !== 'joined') return
    try {
      const bytes = encodeFrame(wire)
      if (bytes.byteLength <= LIMITS.wireBytes) node.sendMessage(to, bytes, DELIVERY_RELIABLE, GLOBAL_ROOM_ID)
    } catch (error) { report(error) }
  }
  const sync = createHistorySync({ ...options, send, isPeer })
  function announce(to: string | null) {
    if (status !== 'joined' || (to === null ? !peers.size : !isPeer(to))) return
    void sync.announce(to).catch(report)
    options.broadcastConfig(to)
  }
  function connect() {
    if (lease || stopped) return
    clearTimeout(retry)
    status = 'joining'
    changed()
    const held = acquireRoom(GLOBAL_ROOM_ID)
    lease = held
    void held.ready.then(ready => {
      if (lease !== held) return
      node = ready
      status = 'joined'
      changed()
      announce(null)
    }).catch(error => {
      if (lease !== held) return
      report(error)
      disconnect()
    })
  }
  function disconnect() {
    lease?.release()
    lease = undefined
    node = undefined
    for (const timer of peerTimers.values()) clearTimeout(timer)
    peerTimers.clear()
    peers.clear()
    status = 'offline'
    changed()
    clearTimeout(retry)
    if (!stopped) retry = setTimeout(connect, 5000)
  }
  const off = subscribeEvent((type, from, payload, room) => {
    if (room !== GLOBAL_ROOM_ID || from === localNodeId() && type === EVENT_RAW) return
    if (type === EVENT_PEER_CONNECTED && from && from !== localNodeId()) {
      if (peers.has(from)) return
      peers.add(from)
      changed()
      peerTimers.set(from, setTimeout(() => {
        peerTimers.delete(from)
        announce(from)
      }, 200))
    } else if (type === EVENT_PEER_DISCONNECTED) {
      if (peers.delete(from)) changed()
      clearTimeout(peerTimers.get(from))
      peerTimers.delete(from)
    } else if (type === EVENT_ALL_CONNECTIONS_LOST) {
      peers.clear()
      changed()
    } else if (type === EVENT_ROOM_LEFT || type === EVENT_ROOM_JOIN_FAILED) {
      if (lease) disconnect()
    } else if (type === EVENT_RAW) {
      const wire = readWire(decodeFrame(payload))
      if (!wire) return
      if (isRecord(wire)) options.receive([wire], true)
      else if (wire.type === 'gdmw:vault-config') options.receiveConfig(wire)
      else if (isPeer(from)) void sync.handle(from, wire).catch(report)
    }
  })
  const periodic = setInterval(() => announce(null), 30_000)
  window.addEventListener('online', connect)
  return {
    start: connect,
    send,
    isWriter: () => status === 'joined' && [...peers].every(id => localNodeId() < id),
    dispose() {
      stopped = true
      off()
      window.removeEventListener('online', connect)
      clearInterval(periodic)
      disconnect()
    },
  }
}
