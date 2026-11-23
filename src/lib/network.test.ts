import { expect, it, vi } from 'vitest'
import { computePairingMac, pairingMacKey, pairingRoomId, requestDelegation, signDelegation } from '@tik-choco/mistai/identity'
import { GLOBAL_ROOM_ID } from '../config'
import { identities, upsert } from '../test/fixtures'
import { acquireRoom, createMistNode, EVENT_RAW } from './mistClient'
import { createNetwork } from './network'
import { decodeFrame, encodeFrame, recordChunks } from './sync'
import { LIMITS, makeWire, readWire } from './wires'

const mist = vi.hoisted(() => {
  const rooms = new Set<string>()
  return {
    rooms, create: vi.fn(), send: vi.fn(),
    join: vi.fn(async (room: string) => { rooms.add(room) }),
    leave: vi.fn((room: string) => { rooms.delete(room) }),
    listener: undefined as ((type: number, from: string, data: unknown, room: string) => void) | undefined,
  }
})
vi.mock('@tik-choco/mistlib-web', () => ({
  MistNode: class {
    constructor() { mist.create() }
    async init() {}
    onEvent(cb: typeof mist.listener) { mist.listener = cb }
    isRoomJoined(room: string) { return mist.rooms.has(room) }
    joinRoomAsync = mist.join
    leaveRoom = mist.leave
    sendMessage = mist.send
  },
  DELIVERY_RELIABLE: 0, EVENT_RAW: 0, EVENT_PEER_CONNECTED: 2, EVENT_PEER_DISCONNECTED: 3,
  EVENT_ALL_CONNECTIONS_LOST: 9, EVENT_ROOM_JOINED: 10, EVENT_ROOM_JOIN_FAILED: 11, EVENT_ROOM_LEFT: 12,
  storage_add: vi.fn(), storage_get: vi.fn(), storage_add_pinned: vi.fn(),
  storage_kv_get: vi.fn(), storage_kv_set: vi.fn(),
}))

it('joins one room and verifies replayed records without trusting their forwarder', async () => {
  const [self, author, forwarder] = await identities()
  const local = await upsert(self)
  const remote = await upsert(author, { title: 'Replay' })
  const received = vi.fn()
  const receiveConfig = vi.fn()
  const changed = vi.fn()
  const network = createNetwork({
    identity: self, snapshot: () => [local], has: key => key === local.signature,
    receive: received, receiveConfig, broadcastConfig: vi.fn(), changed,
  })
  try {
    network.start()
    await vi.waitFor(() => expect(changed).toHaveBeenLastCalledWith({ status: 'joined', peers: 0 }))
    expect(mist.join).toHaveBeenCalledWith(GLOBAL_ROOM_ID)
    const emit = (type: number, data: unknown, room = GLOBAL_ROOM_ID) =>
      mist.listener?.(type, 'test-peer', data, room)
    emit(0, encodeFrame(remote), 'foreign-room')
    expect(received).not.toHaveBeenCalled()
    emit(2, 'joined')
    await vi.waitFor(() => {
      const packet = mist.send.mock.calls.find(([to]) => to === 'test-peer')
      expect(packet?.slice(2)).toEqual([0, GLOBAL_ROOM_ID])
      expect(readWire(decodeFrame(packet?.[1]))).toMatchObject({ type: 'gdmw:sync-digest', keys: [local.signature] })
    })
    const digest = await makeWire(forwarder, { type: 'gdmw:sync-digest', keys: [remote.signature, local.signature] })
    emit(0, encodeFrame(digest))
    await vi.waitFor(() => expect(mist.send.mock.calls.some(([, data]) => {
      const wire = readWire(decodeFrame(data))
      return wire?.type === 'gdmw:sync-want' && wire.keys.length === 1 && wire.keys[0] === remote.signature
    })).toBe(true))
    const batch = await makeWire(forwarder, { type: 'gdmw:sync-records', records: [{ ...remote, title: 'Forged' }, remote] })
    emit(0, encodeFrame(batch))
    expect(received).toHaveBeenLastCalledWith([remote], false)
    const profile = await makeWire(author, { type: 'gdmw:profile', displayName: 'Replay author', updatedAt: 25 })
    const withProfile = await makeWire(forwarder, {
      type: 'gdmw:sync-records', records: [remote, { ...profile, displayName: 'Forged' }, profile],
    })
    emit(0, encodeFrame(withProfile))
    expect(received).toHaveBeenLastCalledWith([remote, profile], false)
    emit(0, encodeFrame(remote))
    expect(received).toHaveBeenLastCalledWith([remote], true)
    const config = await makeWire(author, {
      type: 'gdmw:vault-config', config: { mode: 'custom', room: 'escrow', rev: 1, by: author.did },
    })
    emit(0, encodeFrame(config), 'foreign-room')
    emit(0, encodeFrame({ ...config, config: { ...config.config, room: 'forged' } }))
    expect(receiveConfig).not.toHaveBeenCalled()
    emit(0, encodeFrame(config))
    expect(receiveConfig).toHaveBeenCalledWith(config)
    emit(3, 'left')
    expect(changed).toHaveBeenLastCalledWith({ status: 'joined', peers: 0 })
  } finally { network.dispose() }
  await vi.waitFor(() => expect(mist.leave).toHaveBeenCalledWith(GLOBAL_ROOM_ID))
})

it('bounds sync frames by UTF-8 byte size', async () => {
  const [author] = await identities()
  const description = '日'.repeat(LIMITS.description)
  const translation = { title: '漢'.repeat(LIMITS.title), summary: '語'.repeat(LIMITS.summary), description }
  const records = await Promise.all(Array.from({ length: 4 }, (_, rev) =>
    upsert(author, { description, lang: 'ja', translations: { en: translation, zh: translation }, rev: rev + 1 })))
  expect(encodeFrame(records[0]).byteLength).toBeGreaterThan(24 * 1024)
  const batches = [...recordChunks(records)]
  expect(batches.length).toBeGreaterThan(1)
  expect(batches.flat()).toEqual(records)
  for (const chunk of batches) {
    const wire = await makeWire(author, { type: 'gdmw:sync-records', records: chunk })
    expect(encodeFrame(wire).byteLength).toBeLessThanOrEqual(LIMITS.wireBytes)
    expect(readWire(decodeFrame(encodeFrame(wire)))).toEqual(wire)
  }
  expect(decodeFrame(new Uint8Array(LIMITS.wireBytes + 1))).toBeUndefined()
})

it('shares the engine and leases pairing rooms independently of the global room', async () => {
  const global = acquireRoom(GLOBAL_ROOM_ID)
  const pairing = createMistNode()
  const second = createMistNode()
  const listener = vi.fn()
  const room = 'test-pairing'
  const bytes = new Uint8Array([1, 2, 3])
  try {
    await global.ready
    await pairing.init()
    pairing.onEvent(listener)
    pairing.joinRoom(room)
    pairing.sendMessage(null, bytes)
    await second.joinRoomAsync?.(room)
    expect(mist.send).toHaveBeenCalledWith(null, bytes, 0, room)
    expect(mist.create).toHaveBeenCalledTimes(1)
    expect(mist.join.mock.calls.filter(([joined]) => joined === room)).toHaveLength(1)

    mist.listener?.(EVENT_RAW, 'peer', bytes, GLOBAL_ROOM_ID)
    expect(listener).not.toHaveBeenCalled()
    mist.listener?.(EVENT_RAW, 'peer', bytes, room)
    expect(listener).toHaveBeenCalledWith(EVENT_RAW, 'peer', bytes, room)
    pairing.leaveRoom(room)
    await Promise.resolve()
    expect(mist.rooms.has(room)).toBe(true)
    second.leaveRoom(room)
    await vi.waitFor(() => expect(mist.rooms.has(room)).toBe(false))
    expect(mist.rooms.has(GLOBAL_ROOM_ID)).toBe(true)
  } finally {
    pairing.leaveRoom()
    second.leaveRoom()
    global.release()
  }
})

it('completes the mistai pairing exchange over the shared room adapter', async () => {
  const [root, leaf] = await identities()
  const code = '0123456789ABCDEF'
  const room = await pairingRoomId(code)
  const delegation = await signDelegation(root, leaf.did)
  const session = requestDelegation({ code, leaf: leaf.did, app: 'gdm-world', createNode: createMistNode, timeoutMs: 1000 })
  void session.catch(() => {})
  const request = await vi.waitFor(() => {
    const frame = mist.send.mock.calls.find(([, , , toRoom]) => toRoom === room)
    expect(frame).toBeDefined()
    return decodeFrame(frame?.[1]) as { nonce: string; leaf: string }
  })
  expect(request).toMatchObject({ type: 'tc-did-pair:request', leaf: leaf.did })
  const response = { v: 1, type: 'tc-did-pair:response', nonce: request.nonce, delegation }
  const mac = await computePairingMac(response, await pairingMacKey(code))
  mist.listener?.(EVENT_RAW, 'mock-mistl', encodeFrame({ ...response, mac }), room)
  await expect(session).resolves.toEqual(delegation)
  await vi.waitFor(() => expect(mist.rooms.has(room)).toBe(false))
})
