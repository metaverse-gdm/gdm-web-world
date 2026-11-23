import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { screenshotUrl } from '../lib/linkPreview'
import { Thumbnail } from './Thumbnail'

let host: HTMLDivElement
let show: () => void
beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      show = () => callback([{ isIntersecting: true }])
    }
    observe() {}
    disconnect() {}
  })
})
afterEach(() => {
  act(() => render(null, host))
  host.remove()
  vi.unstubAllGlobals()
})

it('uses a direct URL with lazy loading and falls back to the initial on error', () => {
  const onError = vi.fn()
  const url = 'https://project.example/direct.png'
  act(() => render(<Thumbnail url={url} title="Project" onError={onError} />, host))
  act(show)
  const image = host.querySelector('img')!
  expect(image.getAttribute('src')).toBe(url)
  expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
  expect(image.getAttribute('loading')).toBe('lazy')
  expect(image.getAttribute('decoding')).toBe('async')
  act(() => { image.dispatchEvent(new Event('load')) })
  expect(image.dataset.loaded).toBe('true')
  act(() => { image.dispatchEvent(new Event('error')) })
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('.image-fallback')?.textContent).toBe('P')
  expect(onError).toHaveBeenCalledOnce()
})

it('resolves visible project URLs and tries mshots after an Open Graph image error', async () => {
  const fetch = vi.fn(async () => new Response('<meta property="og:image" content="/cover.png">'))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('Image', class {
    naturalWidth = 720
    onload?: () => void
    set src(_: string) { queueMicrotask(() => this.onload?.()) }
  })
  const page = 'https://project.example/game'
  act(() => render(<Thumbnail projectUrl={page} title="Game" />, host))
  expect(fetch).not.toHaveBeenCalled()
  act(show)
  await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('https://project.example/cover.png'))
  const image = host.querySelector('img')!
  act(() => { image.dispatchEvent(new Event('error')) })
  await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe(screenshotUrl(page)))
  const screenshot = host.querySelector('img')!
  act(() => { screenshot.dispatchEvent(new Event('error')) })
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('.image-fallback')?.textContent).toBe('G')
})
