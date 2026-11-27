import { expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => {
  const refs = new Map<string, number>()
  const node = { isRoomJoined: (room: string) => refs.has(room), sendMessage: vi.fn() }
  const subscribeEvent = vi.fn<(listener: (type: number, from: string, payload: unknown, room: string) => void) => void>()
  const acquireRoom = vi.fn((room: string) => {
    refs.set(room, (refs.get(room) ?? 0) + 1)
    return { ready: Promise.resolve(node), release: () => {
      const remaining = (refs.get(room) ?? 0) - 1
      if (remaining > 0) refs.set(room, remaining)
      else refs.delete(room)
    } }
  })
  return { refs, node, subscribeEvent, acquireRoom, getNode: vi.fn(async () => node) }
})

vi.mock('../mistClient', () => ({ ...mocked, localNodeId: () => 'local-node', DELIVERY_RELIABLE: 0 }))
import { rooms } from './network'

it('uses one lazy singleton, independently leases rooms and forwards only matching events', async () => {
  expect(mocked.getNode).not.toHaveBeenCalled()
  expect(mocked.acquireRoom).not.toHaveBeenCalled()
  const catalogLease = mocked.acquireRoom('catalog')
  const a = rooms.nodeScope('ignored')
  const b = rooms.nodeScope('ignored')
  const c = rooms.nodeScope('ignored')
  await Promise.all([a.init(), b.init(), c.init()])
  expect(mocked.getNode).toHaveBeenCalledTimes(1)
  expect(mocked.subscribeEvent).toHaveBeenCalledTimes(1)
  const eventA = vi.fn(), eventB = vi.fn()
  a.onEvent(eventA)
  b.onEvent(eventB)
  await Promise.all([a.joinRoom('catalog'), b.joinRoom('provider'), c.joinRoom('provider')])
  await a.joinRoom('catalog')
  expect(mocked.refs).toEqual(new Map([['catalog', 2], ['provider', 1]]))
  const emit = mocked.subscribeEvent.mock.calls[0][0]
  const payload = new Uint8Array([1])
  emit(0, 'peer', payload, 'provider')
  expect(eventA).not.toHaveBeenCalled()
  expect(eventB).toHaveBeenCalledExactlyOnceWith(0, 'peer', payload)
  b.sendMessage('peer', payload)
  expect(mocked.node.sendMessage).toHaveBeenCalledExactlyOnceWith('peer', payload, 0, 'provider')
  a.leaveRoom()
  b.leaveRoom('provider')
  expect(mocked.refs).toEqual(new Map([['catalog', 1], ['provider', 1]]))
  c.leaveRoom()
  expect(mocked.refs).toEqual(new Map([['catalog', 1]]))
  catalogLease.release()
  expect(mocked.refs.size).toBe(0)
})
