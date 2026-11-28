import { render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LanguageContext } from '../i18n'
import { loadMediaImage, loadThumbnail, saveMediaImage, saveThumbnail } from '../lib/thumbnails'
import { resolvePreviewImage } from '../lib/linkPreview'
import { LIMITS } from '../lib/wires'
import type { MediaItem } from '../lib/wires'
import { MediaEditor } from './MediaEditor'

vi.mock('../lib/thumbnails', () => ({
  loadMediaImage: vi.fn(), loadThumbnail: vi.fn(), saveMediaImage: vi.fn(), saveThumbnail: vi.fn(),
}))
vi.mock('../lib/linkPreview', () => ({ resolvePreviewImage: vi.fn(), resolveScreenshot: vi.fn() }))

const youtube = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const image = 'https://example.com/image.png'
const video = 'https://example.com/demo.mp4'
const cid1 = 'a'.repeat(32)
const cid2 = 'b'.repeat(32)
const thumb1 = 'c'.repeat(32)
const thumb2 = 'd'.repeat(32)
let host: HTMLDivElement

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  vi.mocked(saveMediaImage).mockReset()
  vi.mocked(saveThumbnail).mockReset().mockResolvedValue(thumb1)
  vi.mocked(loadMediaImage).mockReset().mockResolvedValue('blob:media-preview')
  vi.mocked(loadThumbnail).mockReset().mockResolvedValue('blob:small-preview')
  vi.mocked(resolvePreviewImage).mockReset().mockResolvedValue(image)
})
afterEach(() => { act(() => render(null, host)); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function setup(initial: MediaItem[] = [], autoPreviewUrl?: string) {
  const onChange = vi.fn<(items: MediaItem[]) => void>()
  const onBusyChange = vi.fn()
  const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault())
  function Harness() {
    const [items, setItems] = useState(initial)
    return <LanguageContext.Provider value="en"><form onSubmit={onSubmit}>
      <MediaEditor items={items} title="Project" autoPreviewUrl={autoPreviewUrl}
        onChange={next => { onChange(next); setItems(next) }} onBusyChange={onBusyChange} />
    </form></LanguageContext.Provider>
  }
  act(() => render(<Harness />, host))
  return { onChange, onBusyChange, onSubmit }
}

const input = () => host.querySelector<HTMLInputElement>('.media-editor-url input')!
const tiles = () => [...host.querySelectorAll<HTMLLIElement>('.media-editor-tile')]
const control = (index: number, action: string) => tiles()[index].querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!
const addButton = () => host.querySelector<HTMLButtonElement>('.media-editor-url button')!
const alert = () => host.querySelector('[role="alert"]')?.textContent
function typeUrl(value: string) {
  act(() => {
    input().value = value
    input().dispatchEvent(new InputEvent('input', { bubbles: true }))
  })
}
function addUrl(value: string) {
  typeUrl(value)
  act(() => addButton().click())
}
function pickFiles(files: File[]) {
  const picker = host.querySelector<HTMLInputElement>('input[type="file"]')!
  const transfer = new DataTransfer()
  files.forEach(file => transfer.items.add(file))
  picker.files = transfer.files
  act(() => { picker.dispatchEvent(new Event('change', { bubbles: true })) })
}

it('adds a YouTube URL with Enter without submitting and shows a poster and provider', () => {
  const { onChange, onSubmit } = setup()
  typeUrl(youtube)
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  act(() => { input().dispatchEvent(enter) })
  expect(enter.defaultPrevented).toBe(true)
  expect(onSubmit).not.toHaveBeenCalled()
  expect(onChange).toHaveBeenCalledExactlyOnceWith([{ url: youtube }])
  expect(input().value).toBe('')
  expect(tiles()[0].textContent).toContain('YouTube')
  const poster = tiles()[0].querySelector('img')!
  expect(poster.getAttribute('src')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg')
  expect(poster.getAttribute('referrerpolicy')).toBe('no-referrer')
  expect(tiles()[0].querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Project video 1')
})

it('rejects HTTP URLs and links the validation alert to the input', () => {
  const { onChange } = setup()
  addUrl('http://example.com/image.png')
  expect(onChange).not.toHaveBeenCalled()
  expect(alert()).toContain('https://')
  expect(input().getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById(input().getAttribute('aria-describedby')!)?.textContent).toBe(alert())
  expect(document.activeElement).toBe(input())
})

it('rejects duplicate URLs and clears the error when the input changes', () => {
  const { onChange } = setup([{ url: youtube }])
  addUrl(youtube)
  expect(onChange).not.toHaveBeenCalled()
  expect(alert()).toBe('This item is already in the gallery.')
  addUrl(image)
  expect(onChange).toHaveBeenCalledExactlyOnceWith([{ url: youtube }, { url: image }])
  expect(alert()).toBeUndefined()
  expect(tiles()[1].querySelector('img')?.alt).toBe('Project image 2')
})

it('reorders items, keeps focus with the moved tile and disables controls at the ends', () => {
  const { onChange } = setup([{ url: youtube }, { url: image }, { url: video }])
  expect(control(0, 'earlier').disabled).toBe(true)
  expect(control(2, 'later').disabled).toBe(true)
  const moved = control(0, 'later')
  act(() => { moved.focus(); moved.click() })
  expect(onChange).toHaveBeenLastCalledWith([{ url: image }, { url: youtube }, { url: video }])
  expect(document.activeElement).toBe(control(1, 'later'))
  expect(tiles()[1].textContent).toContain('YouTube')
  act(() => control(1, 'later').click())
  expect(onChange).toHaveBeenLastCalledWith([{ url: image }, { url: video }, { url: youtube }])
  expect(document.activeElement).toBe(control(2, 'earlier'))
  expect(tiles()[1].textContent).toContain('Video')
  act(() => control(2, 'earlier').click())
  expect(onChange).toHaveBeenLastCalledWith([{ url: image }, { url: youtube }, { url: video }])
  expect(document.activeElement).toBe(control(1, 'earlier'))
})

it('marks the first tile as the thumbnail and moves a chosen cover to the front', () => {
  const { onChange } = setup([{ url: youtube }, { url: image }, { url: video }])
  expect(tiles()[0].dataset.cover).toBe('true')
  expect(tiles()[0].querySelector('.media-editor-cover-badge')?.textContent).toBe('Thumbnail')
  expect(control(0, 'cover')).toBeNull()
  expect(control(2, 'cover').textContent).toBe('Use as thumbnail')
  act(() => { control(2, 'cover').focus(); control(2, 'cover').click() })
  expect(onChange).toHaveBeenCalledExactlyOnceWith([{ url: video }, { url: youtube }, { url: image }])
  expect(tiles()[0].textContent).toContain('Video')
  expect(tiles()[0].querySelector('.media-editor-cover-badge')?.textContent).toBe('Thumbnail')
  expect(tiles()[1].dataset.cover).toBe('false')
  expect(document.activeElement).toBe(control(0, 'later'))
})

it('shows the automatic thumbnail and hint only while the gallery is empty', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  const projectUrl = 'http://example.com/game'
  setup([], projectUrl)
  expect(host.textContent).toContain('Without images, a thumbnail is fetched automatically if you provide a project URL.')
  expect(host.querySelector('.media-editor-auto-cover .media-editor-cover-badge')?.textContent).toBe('Thumbnail')
  await vi.waitFor(() => expect(host.querySelector('.media-editor-auto-cover img')?.getAttribute('src')).toBe(image))
  expect(resolvePreviewImage).toHaveBeenCalledExactlyOnceWith(projectUrl)
  addUrl(youtube)
  expect(host.querySelector('.media-editor-empty')).toBeNull()
  expect(host.querySelector('.media-editor-auto-cover')).toBeNull()
})

it('removes items and moves focus to the next item or back to the URL field', () => {
  const { onChange } = setup([{ url: youtube }, { url: image }])
  expect(control(0, 'remove').getAttribute('aria-label')).toBe('Remove item 1')
  act(() => control(0, 'remove').click())
  expect(onChange).toHaveBeenLastCalledWith([{ url: image }])
  expect(document.activeElement).toBe(control(0, 'remove'))
  act(() => control(0, 'remove').click())
  expect(onChange).toHaveBeenLastCalledWith([])
  expect(tiles()).toHaveLength(0)
  expect(document.activeElement).toBe(input())
})

it('uploads sequentially, appends each result, reports progress, and stops at the gallery limit', async () => {
  const initial = Array.from({ length: LIMITS.media - 2 }, (_, i) => ({ url: `https://example.com/${i}.png` }))
  const { onChange, onBusyChange } = setup(initial)
  const files = ['one', 'two', 'three'].map(name => new File(['image'], `${name}.png`, { type: 'image/png' }))
  let finishFirst!: (cid: string) => void
  let finishSecond!: (cid: string) => void
  vi.mocked(saveMediaImage).mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve }))
    .mockReturnValueOnce(new Promise(resolve => { finishSecond = resolve }))
  vi.mocked(saveThumbnail).mockResolvedValueOnce(thumb1).mockResolvedValueOnce(thumb2)
  pickFiles(files)
  expect(saveMediaImage).toHaveBeenCalledExactlyOnceWith(files[0])
  expect(onBusyChange).toHaveBeenLastCalledWith(true)
  expect(addButton().disabled).toBe(true)
  expect(host.textContent).toContain('Saving images… (0/2)')
  await act(async () => finishFirst(cid1))
  expect(saveThumbnail).toHaveBeenNthCalledWith(1, files[0])
  await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith([...initial, { cid: cid1, thumb: thumb1 }]))
  expect(saveMediaImage).toHaveBeenNthCalledWith(2, files[1])
  expect(host.textContent).toContain('Saving images… (1/2)')
  await act(async () => finishSecond(cid2))
  expect(saveThumbnail).toHaveBeenNthCalledWith(2, files[1])
  await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith([...initial, { cid: cid1, thumb: thumb1 }, { cid: cid2, thumb: thumb2 }]))
  expect(saveMediaImage).toHaveBeenCalledTimes(2)
  expect(onBusyChange.mock.calls).toEqual([[true], [false]])
  expect(tiles()).toHaveLength(LIMITS.media)
  expect(host.textContent).toContain('The gallery holds up to 12 items.')
  expect(addButton().disabled).toBe(true)
  await vi.waitFor(() => expect(control(0, 'remove').disabled).toBe(false))
  act(() => control(0, 'remove').click())
  expect(addButton().disabled).toBe(false)
})

it('reports upload errors and unlocks the editor while retaining previous images', async () => {
  const { onChange, onBusyChange } = setup()
  vi.mocked(saveMediaImage).mockResolvedValueOnce(cid1).mockRejectedValueOnce(new Error('Upload failed'))
  const files = ['one', 'two'].map(name => new File(['image'], `${name}.png`, { type: 'image/png' }))
  await act(async () => pickFiles(files))
  await vi.waitFor(() => expect(alert()).toBe('Upload failed'))
  expect(onChange).toHaveBeenCalledExactlyOnceWith([{ cid: cid1, thumb: thumb1 }])
  expect(onBusyChange.mock.calls).toEqual([[true], [false]])
  expect(addButton().disabled).toBe(false)
})

it('keeps an uploaded image if its thumbnail save fails', async () => {
  const { onChange, onBusyChange } = setup()
  const file = new File(['image'], 'one.png', { type: 'image/png' })
  vi.mocked(saveMediaImage).mockResolvedValue(cid1)
  vi.mocked(saveThumbnail).mockRejectedValueOnce(new Error('Thumbnail failed'))
  await act(async () => pickFiles([file]))
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith([{ cid: cid1 }]))
  expect(alert()).toBeUndefined()
  expect(onBusyChange.mock.calls).toEqual([[true], [false]])
  expect(loadMediaImage).toHaveBeenCalledExactlyOnceWith(cid1)
  expect(loadThumbnail).not.toHaveBeenCalled()
})

it('loads the thumbnail blob rather than the full-size image for a tile', async () => {
  setup([{ cid: cid1, thumb: thumb1 }])
  await vi.waitFor(() => expect(tiles()[0].querySelector('img')?.getAttribute('src')).toBe('blob:small-preview'))
  expect(loadThumbnail).toHaveBeenCalledExactlyOnceWith(thumb1)
  expect(loadMediaImage).not.toHaveBeenCalled()
})

it('revokes loaded CID preview URLs on removal, including a load completed after unmount', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  let finishSecond!: (url: string) => void
  vi.mocked(loadMediaImage).mockResolvedValueOnce('blob:first')
    .mockReturnValueOnce(new Promise(resolve => { finishSecond = resolve }))
  setup([{ cid: cid1 }, { cid: cid2 }])
  await act(async () => {})
  expect(tiles()[0].querySelector('img')?.getAttribute('src')).toBe('blob:first')
  act(() => control(0, 'remove').click())
  expect(revoke).toHaveBeenCalledWith('blob:first')
  act(() => control(0, 'remove').click())
  await act(async () => finishSecond('blob:late'))
  expect(revoke).toHaveBeenCalledWith('blob:late')
})
