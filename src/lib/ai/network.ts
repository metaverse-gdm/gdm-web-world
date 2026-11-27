import { createRoomConsumers, createSharedNodeScope } from '@tik-choco/mistai'
import type { MistDelivery, MistNodeLike } from '@tik-choco/mistai'
import { acquireRoom, DELIVERY_RELIABLE, getNode, localNodeId, subscribeEvent } from '../mistClient'

// The real node is already shared by the catalog, vault and pairing. Only
// acquire/release our leases; never leave their rooms directly.
class AiMistNode implements MistNodeLike {
  private node?: Awaited<ReturnType<typeof getNode>>
  private initializing?: Promise<void>
  private handler?: Parameters<MistNodeLike['onEvent']>[0]
  private leases = new Map<string, ReturnType<typeof acquireRoom>>()

  init(): Promise<void> {
    return this.initializing ??= getNode().then(node => {
      this.node = node
      subscribeEvent((type, from, payload, roomId) => {
        if (this.leases.has(roomId)) this.handler?.(type, from, payload, roomId)
      })
    }).catch(error => { this.initializing = undefined; throw error })
  }

  onEvent(handler: Parameters<MistNodeLike['onEvent']>[0]) { this.handler = handler }
  joinRoom(room: string) { return this.joinRoomAsync(room) }
  async joinRoomAsync(room: string) {
    let lease = this.leases.get(room)
    if (!lease) {
      lease = acquireRoom(room)
      this.leases.set(room, lease)
    }
    try { await lease.ready }
    catch (error) {
      if (this.leases.get(room) === lease) this.leaveRoom(room)
      throw error
    }
  }

  leaveRoom(room?: string) {
    for (const id of room === undefined ? [...this.leases.keys()] : [room]) {
      this.leases.get(id)?.release()
      this.leases.delete(id)
    }
  }

  sendMessage(to: string | null | undefined, payload: Uint8Array, delivery: MistDelivery = DELIVERY_RELIABLE, room?: string) {
    if (room !== undefined && this.leases.has(room) && this.node?.isRoomJoined(room)) {
      this.node.sendMessage(to, payload, delivery, room)
    }
  }
}

const sharedScope = createSharedNodeScope(() => new AiMistNode())
// The app's wire identity is per page, not mistai's persisted node ID.
export const rooms = createRoomConsumers(() => sharedScope(localNodeId()), {
  nodeIdStorageKey: 'gdm-world:ai-node-id',
})
