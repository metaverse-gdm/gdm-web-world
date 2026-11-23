import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { didKeyFromEd25519PublicKey } from '../crypto/didIdentity'
import { LanguageContext } from '../i18n'
import { PersonName } from './common'
import { ToastContext } from './Toast'

const did = didKeyFromEd25519PublicKey(new Uint8Array(32).fill(7))
let host: HTMLDivElement

beforeEach(() => { host = document.body.appendChild(document.createElement('div')) })
afterEach(() => {
  act(() => render(null, host))
  host.remove()
  vi.restoreAllMocks()
})

it('reveals the full DID, copies it and restores focus on Escape', async () => {
  const showToast = vi.fn()
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  act(() => render(<LanguageContext.Provider value="en"><ToastContext.Provider value={showToast}>
    <PersonName did={did} name="Team Sakura" delegated />
  </ToastContext.Provider></LanguageContext.Provider>, host))
  const trigger = host.querySelector<HTMLButtonElement>('.person-name-trigger')!
  const popup = document.getElementById(trigger.getAttribute('aria-controls')!)!
  expect(trigger.textContent).toBe('Team Sakuramistl')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(popup.hasAttribute('inert')).toBe(true)

  act(() => trigger.click())
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(popup.getAttribute('aria-hidden')).toBe('false')
  expect(popup.querySelector('code')?.textContent).toBe(did)
  const copyButton = popup.querySelector('button')!
  copyButton.focus()
  await act(async () => { copyButton.click() })
  expect(copy).toHaveBeenCalledExactlyOnceWith(did)
  expect(showToast).toHaveBeenCalledWith({ message: 'Copied', kind: 'status' })

  act(() => {
    copyButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(popup.hasAttribute('inert')).toBe(true)
  expect(document.activeElement).toBe(trigger)
})

it('uses a short DID when a name is missing and dismisses on outside click', () => {
  act(() => render(<PersonName did={did} />, host))
  const trigger = host.querySelector<HTMLButtonElement>('.person-name-trigger')!
  expect(trigger.textContent).toBe(`${did.slice(0, 15)}…${did.slice(-6)}`)
  act(() => trigger.click())
  act(() => host.click())
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})
