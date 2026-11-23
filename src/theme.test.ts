import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.removeItem('tc-theme')
  delete document.documentElement.dataset.theme
  vi.resetModules()
})

afterEach(() => {
  localStorage.removeItem('tc-theme')
  delete document.documentElement.dataset.theme
  vi.restoreAllMocks()
})

it('follows the system until chosen and restores the shared choice after reload', async () => {
  const media = Object.assign(new EventTarget(), { matches: false })
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList)
  const { getTheme, setTheme, subscribeTheme } = await import('./theme')
  const changed = vi.fn()
  const unsubscribe = subscribeTheme(changed)
  expect(getTheme()).toBe('light')

  media.matches = true
  media.dispatchEvent(new Event('change'))
  expect(changed.mock.calls).toEqual([['light'], ['dark']])
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false)

  setTheme('light')
  expect(localStorage.getItem('tc-theme')).toBe('light')
  expect(document.documentElement.dataset.theme).toBe('light')
  media.dispatchEvent(new Event('change'))
  expect(changed.mock.calls).toEqual([['light'], ['dark'], ['light']])
  unsubscribe()

  vi.resetModules()
  const reloaded = await import('./theme')
  expect(reloaded.getTheme()).toBe('light')
})
