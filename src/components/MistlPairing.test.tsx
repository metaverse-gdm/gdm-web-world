import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MistaiError, MESSAGES_JA } from '@tik-choco/mistai'
import { loadDelegation, requestDelegation, saveDelegation, SHARED_DELEGATION_KEY, signDelegation } from '@tik-choco/mistai/identity'
import { createLocalPerson, formatPairingError, importDidDelegation } from '../lib/didPairing'
import { CLOCK_SKEW_MS, DAY_MS } from '../lib/delegation'
import { identities } from '../test/fixtures'
import { MistlPairing } from './MistlPairing'

vi.mock('@tik-choco/mistlib-web', () => ({
  MistNode: vi.fn(),
  DELIVERY_RELIABLE: 0, EVENT_RAW: 0, EVENT_PEER_CONNECTED: 2, EVENT_PEER_DISCONNECTED: 3,
  EVENT_ALL_CONNECTIONS_LOST: 9, EVENT_ROOM_JOINED: 10, EVENT_ROOM_JOIN_FAILED: 11, EVENT_ROOM_LEFT: 12,
  storage_add: vi.fn(), storage_get: vi.fn(), storage_add_pinned: vi.fn(),
  storage_kv_get: vi.fn(), storage_kv_set: vi.fn(),
}))
vi.mock('@tik-choco/mistai/identity', async importOriginal => ({
  ...await importOriginal<typeof import('@tik-choco/mistai/identity')>(),
  requestDelegation: vi.fn(),
}))

beforeEach(() => { localStorage.clear(); document.documentElement.lang = 'ja'; vi.resetAllMocks() })
afterEach(() => { vi.useRealTimers(); localStorage.clear() })

it('formats mistai pairing and browser storage errors in Simplified Chinese', () => {
  expect(formatPairingError(new MistaiError('PAIRING_TIMEOUT', 'timeout'), 'zh')).toBe('配对超时。')
  expect(formatPairingError(new DOMException('Storage unavailable', 'StorageError'), 'zh'))
    .toBe('无法保存配对信息。请检查浏览器的存储设置。')
})

it('shows busy and localized errors, saves a successful pairing and unlinks it', async () => {
  const [root, leaf] = await identities()
  const delegation = await signDelegation(root, leaf.did)
  const host = document.body.appendChild(document.createElement('div'))
  const localPerson = createLocalPerson(leaf.did, () => draw())
  function draw() {
    render(<MistlPairing runtime={{ identity: leaf, getSelf: localPerson.get, refreshDelegation: localPerson.refresh }} />, host)
  }
  const code = '0123-4567-89AB-CDEF'
  function submit() {
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  }
  try {
    act(draw)
    const input = host.querySelector('input')!
    act(() => {
      input.value = code
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    let rejectPairing: (error: Error) => void = () => {}
    const pending = new Promise<Awaited<ReturnType<typeof requestDelegation>>>((_, reject) => { rejectPairing = reject })
    vi.mocked(requestDelegation).mockReturnValueOnce(pending)
    act(submit)
    expect(host.textContent).toContain('連携を確認しています')
    await act(async () => { rejectPairing(new MistaiError('PAIRING_TIMEOUT', 'timeout')) })
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toBe(MESSAGES_JA.errors.PAIRING_TIMEOUT))
    expect(loadDelegation()).toBeUndefined()

    vi.mocked(requestDelegation).mockResolvedValueOnce(delegation)
    await act(async () => { submit() })
    await vi.waitFor(() => expect(host.querySelector('time')?.dateTime).toBe(delegation.exp))
    expect(requestDelegation).toHaveBeenLastCalledWith({
      code, leaf: leaf.did, app: 'gdm-world', createNode: expect.any(Function),
    })
    expect(loadDelegation()).toEqual(delegation)
    expect(host.querySelector('.identity')?.getAttribute('aria-label')).toContain(root.did)
    expect(host.textContent).toContain('すべての tc アプリ')

    await act(async () => { host.querySelector<HTMLButtonElement>('button.danger')?.click() })
    expect(loadDelegation()).toBeUndefined()
    await vi.waitFor(() => expect(host.querySelector('time')).toBeNull())
  } finally {
    act(() => render(null, host))
    host.remove()
    localPerson.dispose()
  }
})

it('verifies manually pasted JSON against this leaf before saving', async () => {
  const [root, leaf, other] = await identities()
  const delegation = await signDelegation(root, leaf.did)
  await expect(importDidDelegation(JSON.stringify(delegation), other.did)).rejects.toMatchObject({
    code: 'PAIRING_INVALID_DELEGATION',
  })
  expect(loadDelegation()).toBeUndefined()
  await importDidDelegation(JSON.stringify(delegation), leaf.did)
  expect(loadDelegation()).toEqual(delegation)
})

it('refreshes across tabs and updates self at the seven-day warning and expiry', async () => {
  const [root, leaf] = await identities()
  const now = Date.now()
  const ttlMs = 7 * DAY_MS + 1000
  const delegation = await signDelegation(root, leaf.did, { now, ttlMs })
  vi.useFakeTimers({ now })
  const callback = vi.fn()
  const self = createLocalPerson(leaf.did, callback)
  try {
    expect(self.get().id).toBe(leaf.did)
    saveDelegation(delegation)
    window.dispatchEvent(new StorageEvent('storage', { key: SHARED_DELEGATION_KEY }))
    expect(callback).toHaveBeenCalledTimes(1)
    expect(self.get()).toMatchObject({ id: root.did, expiresSoon: false })
    vi.advanceTimersByTime(1000)
    expect(self.get()).toMatchObject({ id: root.did, expiresSoon: true })
    vi.advanceTimersByTime(7 * DAY_MS + CLOCK_SKEW_MS + 1)
    expect(self.get()).toMatchObject({ id: leaf.did, delegation: undefined })
  } finally { self.dispose() }
})
