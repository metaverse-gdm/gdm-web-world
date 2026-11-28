import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LanguageContext } from '../i18n'
import { resolvePreviewImage } from '../lib/linkPreview'
import { loadMediaImage, loadThumbnail } from '../lib/thumbnails'
import type { MediaItem } from '../lib/wires'
import { MediaGallery } from './MediaGallery'

vi.mock('../lib/thumbnails', () => ({ loadMediaImage: vi.fn(), loadThumbnail: vi.fn() }))
vi.mock('../lib/linkPreview', () => ({ resolvePreviewImage: vi.fn() }))

const first = 'https://example.com/one.png'
const second = 'https://example.com/two.png'
const youtube = 'https://youtu.be/dQw4w9WgXcQ'
const cid = 'bafyGalleryImage'
let host: HTMLDivElement
const gallery = () => host.querySelector<HTMLElement>('.media-gallery')!
const stage = () => host.querySelector<HTMLElement>('.media-gallery-stage')!
const counter = () => gallery().querySelector('[aria-live="polite"]')?.textContent
const button = (name: string, parent: ParentNode = gallery()) => parent.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
const click = (name: string, parent?: ParentNode) => act(() => button(name, parent).click())

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  vi.mocked(resolvePreviewImage).mockResolvedValue(null)
  vi.mocked(loadMediaImage).mockResolvedValue('blob:gallery-image')
})

afterEach(() => {
  act(() => render(null, host))
  host.remove()
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

function setup(items: MediaItem[]) {
  act(() => render(<LanguageContext.Provider value="en"><MediaGallery items={items} title="Game" /></LanguageContext.Provider>, host))
}

it('announces the selected slide and supports previous, next, arrow keys and wrapping', () => {
  setup([{ url: first }, { url: second }])
  expect(gallery().tagName).toBe('SECTION')
  expect(gallery().getAttribute('aria-roledescription')).toBe('carousel')
  expect(gallery().getAttribute('aria-label')).toBe('Gallery')
  expect(counter()).toBe('1 / 2')
  expect(stage().querySelector('img')?.getAttribute('src')).toBe(first)
  click('Next item')
  expect(counter()).toBe('2 / 2')
  expect(stage().querySelector('img')?.getAttribute('alt')).toBe('Game image 2')
  expect(stage().querySelector('img')?.getAttribute('src')).toBe(second)
  click('Previous item')
  expect(counter()).toBe('1 / 2')
  gallery().focus()
  act(() => { gallery().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })) })
  expect(counter()).toBe('2 / 2')
  click('Next item')
  expect(counter()).toBe('1 / 2')
})

it('selects a filmstrip thumbnail and scrolls it into view', () => {
  setup([{ url: first }, { url: second }, { url: youtube }])
  const third = button('Show item 3')
  const scrollIntoView = vi.fn()
  Object.defineProperty(third, 'scrollIntoView', { value: scrollIntoView })
  expect(button('Show item 1').getAttribute('aria-current')).toBe('true')
  click('Show item 3')
  expect(counter()).toBe('3 / 3')
  expect(third.getAttribute('aria-current')).toBe('true')
  expect(button('Show item 1').hasAttribute('aria-current')).toBe(false)
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  expect(button('Play video', stage())).not.toBeNull()
})

it('moves focus with keyboard filmstrip navigation but leaves editable controls alone', () => {
  setup([{ url: first }, { url: second }])
  const thumb = button('Show item 1')
  thumb.focus()
  act(() => { thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })) })
  expect(counter()).toBe('2 / 2')
  expect(document.activeElement).toBe(button('Show item 2'))
  const input = gallery().appendChild(document.createElement('input'))
  input.focus()
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })) })
  expect(counter()).toBe('2 / 2')
  input.remove()
})

it('only mounts the privacy-enhanced YouTube player on play and resets it when leaving the slide', () => {
  setup([{ url: youtube }, { url: first }])
  expect(stage().querySelector('iframe')).toBeNull()
  expect(stage().querySelector('img')?.getAttribute('src')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg')
  expect(gallery().textContent).toContain('Playing loads the YouTube player.')
  const watch = gallery().querySelector<HTMLAnchorElement>('.media-gallery-embed-info a')!
  expect(watch.textContent?.trim()).toBe('Open on YouTube')
  expect(watch.href).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  expect(watch.rel).toBe('noopener noreferrer')
  expect(watch.target).toBe('_blank')
  click('Play video', stage())
  const iframe = stage().querySelector('iframe')!
  expect(iframe.getAttribute('src')).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1')
  expect(iframe.title).toBe('Game video 1')
  expect(iframe.getAttribute('allow')).toBe('autoplay; encrypted-media; fullscreen; picture-in-picture')
  expect(iframe.hasAttribute('allowfullscreen')).toBe(true)
  expect(iframe.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin')
  click('Next item')
  expect(host.querySelector('iframe')).toBeNull()
  click('Previous item')
  expect(stage().querySelector('iframe')).toBeNull()
  expect(button('Play video', stage())).not.toBeNull()
})

it.each([
  ['https://www.bilibili.com/video/av123/', 'https://www.bilibili.com/video/av123/', 'https://player.bilibili.com/'],
  ['https://vimeo.com/12345', 'https://vimeo.com/12345', 'https://player.vimeo.com/'],
  ['https://nico.ms/sm1234', 'https://www.nicovideo.jp/watch/sm1234', 'https://embed.nicovideo.jp/'],
])('resolves a poster for %s without mounting a player', async (url, watchUrl, playerUrl) => {
  vi.mocked(resolvePreviewImage).mockResolvedValue(second)
  setup([{ url }])
  await vi.waitFor(() => expect(stage().querySelector('img')?.getAttribute('src')).toBe(second))
  expect(resolvePreviewImage).toHaveBeenCalledExactlyOnceWith(watchUrl)
  expect(stage().querySelector('iframe')).toBeNull()
  expect(button('Next item')).toBeNull()
  click('Play video', stage())
  expect(stage().querySelector('iframe')?.getAttribute('src')).toContain(playerUrl)
})

it('keeps a playable facade when no poster can be resolved', async () => {
  setup([{ url: 'https://vimeo.com/12345' }])
  await vi.waitFor(() => expect(resolvePreviewImage).toHaveBeenCalledOnce())
  expect(stage().querySelector('img')).toBeNull()
  expect(stage().querySelector('.media-gallery-fallback')?.textContent).toBe('Vimeo')
  expect(button('Play video', stage())).not.toBeNull()
})

it('renders a native direct-file player rather than an embed or image', () => {
  setup([{ url: 'https://example.com/demo.webm' }])
  const video = stage().querySelector('video')!
  expect(video.getAttribute('src')).toBe('https://example.com/demo.webm')
  expect(video.hasAttribute('controls')).toBe(true)
  expect(video.hasAttribute('playsinline')).toBe(true)
  expect(video.getAttribute('preload')).toBe('metadata')
  expect(stage().querySelector('iframe')).toBeNull()
  expect(button('View larger')).toBeNull()
  expect(host.querySelector('.media-gallery-filmstrip')).toBeNull()
})

it('fades loaded images in and displays a fallback on error', () => {
  setup([{ url: first }])
  const image = stage().querySelector('img')!
  expect(image.dataset.loaded).toBe('false')
  act(() => { image.dispatchEvent(new Event('load')) })
  expect(image.dataset.loaded).toBe('true')
  act(() => { image.dispatchEvent(new Event('error')) })
  expect(stage().querySelector('img')).toBeNull()
  expect(stage().textContent).toContain('G')
  expect(stage().querySelector('.media-gallery-fallback small')).not.toBeNull()
})

it('swipes image slides without opening the lightbox', () => {
  setup([{ url: first }, { url: second }])
  const imageButton = button('View larger', stage())
  act(() => {
    imageButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 1, clientX: 180, clientY: 50 }))
    imageButton.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 52 }))
  })
  expect(counter()).toBe('2 / 2')
  act(() => { button('View larger', stage()).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
  expect(host.querySelector('dialog')).toBeNull()
})

it('shares uploaded images between stage and thumbs and revokes their object URLs', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  setup([{ cid }, { url: second }])
  await vi.waitFor(() => expect(stage().querySelector('img')?.getAttribute('src')).toBe('blob:gallery-image'))
  expect(loadMediaImage).toHaveBeenCalledExactlyOnceWith(cid)
  expect(button('Show item 1').querySelector('img')?.getAttribute('src')).toBe('blob:gallery-image')
  click('Next item')
  expect(revoke).not.toHaveBeenCalled()
  act(() => render(null, host))
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:gallery-image')
})

it('loads small thumbnails for the filmstrip and full images only when selected in the stage or lightbox', async () => {
  const secondCid = 'bafySecondImage'
  const thumb = 'bafyFirstThumb'
  const secondThumb = 'bafySecondThumb'
  vi.mocked(loadMediaImage).mockImplementation(async id => `blob:full-${id}`)
  vi.mocked(loadThumbnail).mockImplementation(async id => `blob:thumb-${id}`)
  setup([{ cid, thumb }, { cid: secondCid, thumb: secondThumb }])
  await vi.waitFor(() => {
    expect(stage().querySelector('img')?.getAttribute('src')).toBe(`blob:full-${cid}`)
    expect(button('Show item 1').querySelector('img')?.getAttribute('src')).toBe(`blob:thumb-${thumb}`)
    expect(button('Show item 2').querySelector('img')?.getAttribute('src')).toBe(`blob:thumb-${secondThumb}`)
  })
  expect(vi.mocked(loadThumbnail).mock.calls).toEqual([[thumb], [secondThumb]])
  expect(loadMediaImage).toHaveBeenCalledExactlyOnceWith(cid)
  click('View larger', stage())
  const dialog = host.querySelector<HTMLDialogElement>('.media-lightbox')!
  click('Next item', dialog)
  await vi.waitFor(() => expect(dialog.querySelector('img')?.getAttribute('src')).toBe(`blob:full-${secondCid}`))
  expect(loadMediaImage).toHaveBeenNthCalledWith(2, secondCid)
  click('Close', dialog)
  expect(stage().querySelector('img')?.getAttribute('src')).toBe(`blob:full-${cid}`)
  click('Next item')
  expect(stage().querySelector('img')?.getAttribute('src')).toBe(`blob:full-${secondCid}`)
  expect(loadMediaImage).toHaveBeenCalledTimes(2)
})

it('revokes a late blob result after the gallery is gone', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  let resolve!: (url: string) => void
  vi.mocked(loadMediaImage).mockReturnValueOnce(new Promise(r => { resolve = r }))
  setup([{ cid }])
  expect(loadMediaImage).toHaveBeenCalledOnce()
  act(() => render(null, host))
  await act(async () => resolve('blob:late-image'))
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:late-image')
})

it('opens the nested lightbox, skips video slides and closes without dismissing the project dialog', () => {
  const outer = document.body.appendChild(document.createElement('dialog'))
  outer.showModal()
  outer.appendChild(host)
  const outerCancel = vi.fn()
  const outerClick = vi.fn()
  outer.addEventListener('cancel', outerCancel)
  outer.addEventListener('click', outerClick)
  try {
    setup([{ url: first }, { url: youtube }, { url: second }])
    const opener = button('View larger', stage())
    opener.focus()
    click('View larger', stage())
    const dialog = host.querySelector<HTMLDialogElement>('.media-lightbox')!
    expect(dialog.open).toBe(true)
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(first)
    outerClick.mockClear()
    click('Next item', dialog)
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(second)
    expect(dialog.querySelector('img')?.getAttribute('alt')).toBe('Game image 3')
    expect(outerClick).not.toHaveBeenCalled()
    const event = new Event('cancel', { cancelable: true, bubbles: true })
    act(() => { dialog.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(outerCancel).not.toHaveBeenCalled()
    expect(outer.open).toBe(true)
    expect(dialog.open).toBe(false)
    expect(host.querySelector('.media-lightbox')).toBeNull()
    expect(document.activeElement).toBe(opener)
    click('View larger', stage())
    outerClick.mockClear()
    const reopened = host.querySelector<HTMLDialogElement>('.media-lightbox')!
    act(() => reopened.click())
    expect(outerClick).not.toHaveBeenCalled()
    expect(outer.open).toBe(true)
    expect(host.querySelector('.media-lightbox')).toBeNull()
  } finally {
    outer.close()
    document.body.appendChild(host)
    outer.remove()
  }
})
