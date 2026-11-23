// A single MistNode owns the engine callback. Catalog, vault and pairing rooms
// share it via fan-out and explicit room leases.
import {
  MistNode, DELIVERY_RELIABLE, EVENT_RAW, EVENT_PEER_CONNECTED, EVENT_PEER_DISCONNECTED,
  EVENT_ALL_CONNECTIONS_LOST, EVENT_ROOM_JOINED, EVENT_ROOM_LEFT, EVENT_ROOM_JOIN_FAILED,
  storage_add, storage_get, storage_add_pinned, storage_kv_get, storage_kv_set,
} from '@tik-choco/mistlib-web'
import type { MistNodeLike } from '@tik-choco/mistvault'
import type { SharedStorageBackend } from '../crypto/didIdentity'
import type { Replica } from './mirror'
import { mistSignalingConfig } from './mistSignaling'

export {
  DELIVERY_RELIABLE, EVENT_RAW, EVENT_PEER_CONNECTED, EVENT_PEER_DISCONNECTED,
  EVENT_ALL_CONNECTIONS_LOST, EVENT_ROOM_JOINED, EVENT_ROOM_LEFT, EVENT_ROOM_JOIN_FAILED,
}
export const localNodeId = () => nodeId ??= crypto.randomUUID()
let nodeId: string | undefined
let initializing: Promise<MistNode> | undefined
type EventListener = (type: number, from: string, payload: unknown, roomId: string) => void
const listeners = new Set<EventListener>()

export function getNode(): Promise<MistNode> {
  return initializing ??= (async () => {
    const node = new MistNode(localNodeId(), mistSignalingConfig())
    await node.init()
    node.onEvent((type, from, payload, roomId) => {
      for (const listener of listeners) {
        try { listener(type, from, payload, roomId) }
        catch (error) { console.warn('mist event listener', error) }
      }
    })
    return node
  })().catch(error => { initializing = undefined; throw error })
}
export function subscribeEvent(listener: EventListener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

type Lease = { refs: number; ready: Promise<MistNode> }
const rooms = new Map<string, Lease>()
export function acquireRoom(roomId: string) {
  let lease = rooms.get(roomId)
  if (!lease) {
    lease = { refs: 0, ready: getNode().then(async node => {
      if (!node.isRoomJoined(roomId)) await node.joinRoomAsync(roomId)
      return node
    }) }
    rooms.set(roomId, lease)
  }
  const held = lease
  held.refs++
  let released = false
  return {
    ready: held.ready,
    release() {
      if (released) return
      released = true
      held.refs--
      const leave = (node?: MistNode) => {
        if (held.refs || rooms.get(roomId) !== held) return
        rooms.delete(roomId)
        if (node?.isRoomJoined(roomId)) node.leaveRoom(roomId)
      }
      void held.ready.then(leave, () => leave()).catch(error => console.warn('mist leave', error))
    },
  }
}

export function createMistNode(): MistNodeLike {
  let lease: ReturnType<typeof acquireRoom> | undefined
  let unsubscribe: (() => void) | undefined
  let currentRoom: string | undefined
  let node: MistNode | undefined
  let handler: Parameters<MistNodeLike['onEvent']>[0]
  async function join(roomId: string) {
    stop()
    currentRoom = roomId
    unsubscribe = subscribeEvent((type, from, payload, room) => {
      if (room === currentRoom) handler?.(type, from, payload, room)
    })
    const acquired = acquireRoom(roomId)
    lease = acquired
    try {
      const next = await acquired.ready
      if (lease === acquired) node = next
    } catch (error) {
      if (lease === acquired) stop()
      throw error
    }
  }
  function stop(roomId?: string) {
    if (roomId !== undefined && roomId !== currentRoom) return
    unsubscribe?.()
    unsubscribe = undefined
    lease?.release()
    lease = undefined
    currentRoom = undefined
    node = undefined
  }
  return {
    async init() { await getNode() },
    onEvent(cb) { handler = cb },
    joinRoom(roomId) { void join(roomId).catch(error => console.warn('mist join', error)) },
    joinRoomAsync: join,
    leaveRoom: stop,
    sendMessage(to, data, delivery = DELIVERY_RELIABLE, room = currentRoom) {
      const acquired = lease
      if (!acquired || room === undefined || room !== currentRoom) return
      if (node) {
        try { node.sendMessage(to, data, delivery, room) }
        catch (error) { console.warn('mist send', error) }
      } else {
        // mistai starts sending before the asynchronous join finishes.
        void acquired.ready.then(ready => {
          if (lease === acquired) ready.sendMessage(to, data, delivery, room)
        }).catch(error => console.warn('mist send', error))
      }
    },
  }
}

export const createVaultRoomHandle = createMistNode

export async function addBlob(name: string, bytes: Uint8Array) {
  await getNode()
  return storage_add(name, bytes)
}
export async function getBlob(cid: string) {
  await getNode()
  return storage_get(cid)
}
export async function pinBlob(name: string, bytes: Uint8Array) {
  await getNode()
  return storage_add_pinned(name, bytes)
}

export const identityBackend: SharedStorageBackend = {
  store: bytes => addBlob('tc-shared-did-identity.json', bytes),
  retrieve: getBlob,
}

export function opfsReplica(key: string): Replica {
  return {
    async read() {
      await getNode()
      const bytes = await storage_kv_get(key)
      return bytes ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : null
    },
    async write(value) {
      await getNode()
      await storage_kv_set(key, new TextEncoder().encode(value))
    },
  }
}

export const catalogReplica = opfsReplica('gdm-world:catalog:v1')
