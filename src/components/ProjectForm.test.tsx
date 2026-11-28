import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LanguageContext } from '../i18n'
import { emptyLlmConfig, saveLlmConfig } from '@tik-choco/mistai/llm-config'
import { createLocalPreferences, emptyDraft } from '../lib/localPreferences'
import type { Draft } from '../lib/localPreferences'
import type { Runtime } from '../lib/runtime'
import type { ProjectRecord } from '../lib/wires'
import { PROJECT_ID, projectFields } from '../test/fixtures'
import { ProjectForm } from './ProjectForm'
import { translateProjectText } from '../lib/ai/translate'
import { saveMediaImage, saveThumbnail } from '../lib/thumbnails'
import { resolvePreviewImage } from '../lib/linkPreview'

vi.mock('../lib/ai/translate', () => ({ translateProjectText: vi.fn() }))
vi.mock('../lib/thumbnails', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/thumbnails')>(),
  saveMediaImage: vi.fn(), loadMediaImage: vi.fn(async () => 'blob:gallery-preview'),
  saveThumbnail: vi.fn(), loadThumbnail: vi.fn(async () => 'blob:small-preview'),
}))
vi.mock('../lib/linkPreview', () => ({ resolvePreviewImage: vi.fn(), resolveScreenshot: vi.fn() }))

let host: HTMLDivElement
beforeEach(() => {
  localStorage.clear()
  vi.mocked(translateProjectText).mockReset()
  vi.mocked(saveMediaImage).mockReset()
  vi.mocked(saveThumbnail).mockReset().mockResolvedValue('b'.repeat(32))
  vi.mocked(resolvePreviewImage).mockReset().mockResolvedValue('https://example.com/auto.png')
  host = document.body.appendChild(document.createElement('div'))
})
afterEach(() => { act(() => render(null, host)); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

function setup(project?: ProjectRecord, draft?: Draft) {
  const preferences = createLocalPreferences()
  if (draft) preferences.setDraft(project?.projectId ?? 'new', draft)
  const saveProject = vi.fn<Runtime['saveProject']>(async () => PROJECT_ID)
  const runtime = {
    preferences, saveProject, getSelf: () => ({ id: 'did:key:self' }), getCatalog: () => ({ groups: new Map() }), displayNameFor: () => 'Me',
  } as unknown as Runtime
  function Harness() {
    const [, refresh] = useState(0)
    useEffect(() => preferences.subscribe(() => refresh(n => n + 1)), [])
    return <LanguageContext.Provider value="en"><ProjectForm runtime={runtime} project={project} /></LanguageContext.Provider>
  }
  act(() => render(<Harness />, host))
  return { preferences, saveProject }
}

function type(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
  act(() => {
    input.value = value
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
  })
}

const activePanel = '[role="tabpanel"]:not([hidden])'
const tab = (lang: string) => host.querySelector<HTMLButtonElement>(`[role="tab"][lang="${lang}"]`)!
const submit = () => act(async () => {
  host.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
})

function configureAi() {
  const config = emptyLlmConfig()
  config.providers.push({ id: 'api', label: 'API', apiKey: '', baseUrl: 'https://example.com/v1' })
  config.defaultModel = { providerId: 'api', model: 'translator' }
  saveLlmConfig(config)
}

const button = (label: string) => [...host.querySelectorAll('button')].find(element => element.textContent === label)!
const translated = { title: '中文标题', summary: '中文概要', description: '# 说明' }

it('fills the selected target tab as a draft and keeps the primary language', async () => {
  configureAi()
  const { preferences, saveProject } = setup()
  vi.mocked(translateProjectText).mockResolvedValue(translated)
  type(activePanel + ' input', 'English title')
  type(activePanel + ' textarea', 'English summary')
  act(() => tab('zh-Hans').click())
  await act(async () => { button('AI translate from English').click(); await vi.dynamicImportSettled() })
  expect(translateProjectText).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'English title' }), 'en', 'zh')
  expect(preferences.get().drafts.new.value).toMatchObject({ lang: 'en', title: 'English title', translations: { zh: translated } })
  expect(host.querySelector<HTMLInputElement>(activePanel + ' input')?.value).toBe(translated.title)
  expect(saveProject).not.toHaveBeenCalled()
})

it('offers a settings link when no model is configured', async () => {
  setup()
  type(activePanel + ' input', 'English title')
  act(() => tab('zh-Hans').click())
  await act(async () => { button('AI translate from English').click() })
  expect(host.querySelector('a[href="#/settings"]')?.textContent).toBe('Open AI translation settings')
  expect(translateProjectText).not.toHaveBeenCalled()
})

it('bulk translates only empty tabs and preserves edits made during the request', async () => {
  configureAi()
  const { preferences } = setup()
  act(() => preferences.setDraft('new', { ...emptyDraft(), lang: 'en', title: 'Title', summary: 'Summary', translations: { ja: { title: '日本語', summary: '', description: '' } } }))
  let complete!: (value: typeof translated) => void
  vi.mocked(translateProjectText).mockReturnValue(new Promise(resolve => { complete = resolve }))
  act(() => button('AI translate empty languages').click())
  await vi.waitFor(() => expect(translateProjectText).toHaveBeenCalledTimes(1))
  expect(button('AI translate empty languages').disabled).toBe(true)
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Translating')
  type('input[type="url"]', 'https://project.example')
  await act(async () => { complete(translated) })
  expect(preferences.get().drafts.new.value).toMatchObject({ url: 'https://project.example', translations: { ja: { title: '日本語' }, zh: translated } })
})

it('asks before overwriting existing translations and respects cancellation', async () => {
  configureAi()
  const { preferences } = setup()
  act(() => preferences.setDraft('new', { ...emptyDraft(), lang: 'en', title: 'Title', translations: { zh: translated } }))
  act(() => tab('zh-Hans').click())
  const confirm = vi.fn(() => false)
  vi.stubGlobal('confirm', confirm)
  await act(async () => { button('AI translate from English').click() })
  expect(confirm).toHaveBeenCalledOnce()
  expect(translateProjectText).not.toHaveBeenCalled()
  expect(preferences.get().drafts.new.value?.translations?.zh).toEqual(translated)
})

it('translates empty languages sequentially and skips a tab filled during translation', async () => {
  configureAi()
  const { preferences } = setup()
  act(() => preferences.setDraft('new', { ...emptyDraft(), lang: 'en', title: 'Title', summary: 'Summary' }))
  let complete!: (value: typeof translated) => void
  vi.mocked(translateProjectText).mockReturnValueOnce(new Promise(resolve => { complete = resolve })).mockResolvedValue(translated)
  act(() => button('AI translate empty languages').click())
  await vi.waitFor(() => expect(translateProjectText).toHaveBeenCalledTimes(1))
  expect(translateProjectText).toHaveBeenCalledWith(expect.anything(), 'en', 'ja')
  act(() => tab('zh-Hans').click())
  type(activePanel + ' input', '手动输入')
  await act(async () => { complete({ title: '日本語', summary: '概要', description: '' }) })
  expect(translateProjectText).toHaveBeenCalledTimes(1)
  expect(preferences.get().drafts.new.value?.translations).toMatchObject({ ja: { title: '日本語' }, zh: { title: '手动输入' } })
})

it('opens the incomplete language and publishes the translations and pending tag once complete', async () => {
  const { saveProject, preferences } = setup()
  expect(tab('en').getAttribute('aria-selected')).toBe('true')
  act(() => {
    tab('en').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
  })
  expect(document.activeElement).toBe(tab('zh-Hans'))
  type(activePanel + ' textarea', '中文概要')
  expect(tab('zh-Hans').dataset.filled).toBe('true')
  act(() => tab('en').click())
  type(activePanel + ' input', 'English title')
  type(activePanel + ' textarea', 'English summary')
  type('input[type="url"]', 'https://project.example')
  await submit()
  expect(saveProject).not.toHaveBeenCalled()
  expect(tab('zh-Hans').getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(host.querySelector(activePanel + ' input'))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('中文')
  expect(preferences.get().drafts.new.value?.translations?.zh?.summary).toBe('中文概要')

  type(activePanel + ' input', '中文标题')
  type('.tag-input input', ' Tool ')
  await submit()
  expect(saveProject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    lang: 'en', title: 'English title', summary: 'English summary', tags: ['Tool'],
    translations: { zh: { title: '中文标题', summary: '中文概要', description: '' } },
  }), undefined)
  expect(preferences.get().drafts.new.value).toBeNull()
  expect(saveProject.mock.calls[0][0]).not.toHaveProperty('media')
})

it('promotes a filled language when the default tab is empty and uses the gallery as the only image editor', async () => {
  const { saveProject } = setup()
  expect(host.querySelectorAll('input[type="file"]')).toHaveLength(1)
  expect(host.querySelectorAll('input[inputmode="url"]')).toHaveLength(1)
  expect(host.querySelector('.image-url-field, .draft-image')).toBeNull()
  act(() => tab('ja').click())
  type(activePanel + ' input', '日本語タイトル')
  type(activePanel + ' textarea', '日本語概要')
  type('input[type="url"]', 'https://project.example')
  type('.media-editor-url input', 'https://project.example/image.png')
  act(() => button('Add').click())
  await submit()
  expect(saveProject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    lang: 'ja', title: '日本語タイトル', summary: '日本語概要',
    translations: undefined, media: [{ url: 'https://project.example/image.png' }],
  }), undefined)
  expect(saveProject.mock.calls[0][0]).not.toHaveProperty('thumbnailCid')
  expect(saveProject.mock.calls[0][0]).not.toHaveProperty('thumbnailUrl')
})

const galleryUrl = 'https://example.com/gallery.png'
const legacyUrl = 'https://example.com/legacy.png'

it('migrates a stored draft cover to the first item and saves only the gallery', async () => {
  const cid = 'a'.repeat(32)
  const { preferences, saveProject } = setup(undefined, {
    ...emptyDraft(), title: 'Title', summary: 'Summary', url: 'https://example.com',
    thumbnailCid: cid, media: [{ url: galleryUrl }, { cid }],
  })
  const media = [{ cid, thumb: cid }, { url: galleryUrl }]
  expect(preferences.get().drafts.new.value?.media).toEqual(media)
  expect(preferences.get().drafts.new.value).not.toHaveProperty('thumbnailCid')
  expect(host.querySelector('.media-editor-tile[data-cover="true"] .media-editor-cover-badge')?.textContent).toBe('Thumbnail')
  await submit()
  expect(saveProject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ media }), undefined)
  expect(saveProject.mock.calls[0][0]).not.toHaveProperty('thumbnailCid')
  expect(saveProject.mock.calls[0][0]).not.toHaveProperty('thumbnailUrl')
})

it('folds a published legacy URL into the gallery when editing and saves no legacy fields', async () => {
  const project = { ...projectFields, projectId: PROJECT_ID, thumbnailUrl: legacyUrl, media: [{ url: galleryUrl }, { url: legacyUrl }] } as ProjectRecord
  const { saveProject } = setup(project)
  expect([...host.querySelectorAll('.media-editor-tile img')].map(img => img.getAttribute('src'))).toEqual([legacyUrl, galleryUrl])
  await submit()
  expect(saveProject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ media: [{ url: legacyUrl }, { url: galleryUrl }] }), PROJECT_ID)
  expect(saveProject.mock.calls[0][0]).not.toHaveProperty('thumbnailCid')
  expect(saveProject.mock.calls[0][0]).not.toHaveProperty('thumbnailUrl')
})

it('debounces the automatic preview URL and hides the preview when media is added', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IntersectionObserver', undefined)
  setup()
  type('input[type="url"]', 'http://example.com/game')
  expect(host.querySelector('.media-editor-auto-cover')).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(350) })
  expect(host.querySelector('.media-editor-auto-cover')).not.toBeNull()
  expect(resolvePreviewImage).toHaveBeenCalledExactlyOnceWith('http://example.com/game')
  type('.media-editor-url input', galleryUrl)
  act(() => button('Add').click())
  expect(host.querySelector('.media-editor-auto-cover')).toBeNull()
})

it('persists gallery URLs in the draft and includes them when publishing', async () => {
  const { preferences, saveProject } = setup()
  type(activePanel + ' input', 'Title')
  type(activePanel + ' textarea', 'Summary')
  type('input[type="url"]', 'https://project.example')
  type('.media-editor-url input', galleryUrl)
  act(() => button('Add').click())
  expect(preferences.get().drafts.new.value?.media).toEqual([{ url: galleryUrl }])
  await submit()
  expect(saveProject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ media: [{ url: galleryUrl }] }), undefined)
})

it('loads the published gallery when editing and omits the emptied gallery on save', async () => {
  const project = { ...projectFields, projectId: PROJECT_ID, media: [{ url: galleryUrl }] } as ProjectRecord
  const { preferences, saveProject } = setup(project)
  expect(host.querySelector('.media-editor-tile img')?.getAttribute('src')).toBe(galleryUrl)
  act(() => host.querySelector<HTMLButtonElement>('.media-editor [data-action="remove"]')!.click())
  expect(preferences.get().drafts[PROJECT_ID].value?.media).toBeUndefined()
  await submit()
  expect(saveProject).toHaveBeenCalledOnce()
  expect(saveProject.mock.calls[0][0]).not.toHaveProperty('media')
  expect(saveProject.mock.calls[0][0]).not.toHaveProperty('thumbnailCid')
  expect(saveProject.mock.calls[0][0]).not.toHaveProperty('thumbnailUrl')
  expect(saveProject.mock.calls[0][1]).toBe(PROJECT_ID)
})

it('omits invalid draft media and blocks publishing until an image upload finishes', async () => {
  const { preferences, saveProject } = setup()
  act(() => preferences.setDraft('new', {
    ...emptyDraft(), title: 'Title', summary: 'Summary', url: 'https://example.com',
    media: [{ url: 'http://example.com/invalid.png' }],
  }))
  let finish!: (cid: string) => void
  let finishThumb!: (cid: string) => void
  vi.mocked(saveMediaImage).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  vi.mocked(saveThumbnail).mockReturnValueOnce(new Promise(resolve => { finishThumb = resolve }))
  const picker = host.querySelector<HTMLInputElement>('.media-editor input[type="file"]')!
  const transfer = new DataTransfer()
  transfer.items.add(new File(['image'], 'gallery.png', { type: 'image/png' }))
  picker.files = transfer.files
  act(() => { picker.dispatchEvent(new Event('change', { bubbles: true })) })
  const publish = host.querySelector<HTMLButtonElement>('button[type="submit"]')!
  expect(publish.disabled).toBe(true)
  expect(host.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true)
  await submit()
  expect(saveProject).not.toHaveBeenCalled()
  const cid = 'a'.repeat(32)
  await act(async () => finish(cid))
  const item = { cid, thumb: 'b'.repeat(32) }
  expect(publish.disabled).toBe(true)
  await submit()
  expect(saveProject).not.toHaveBeenCalled()
  await act(async () => finishThumb(item.thumb))
  await vi.waitFor(() => expect(publish.disabled).toBe(false))
  expect(preferences.get().drafts.new.value?.media).toContainEqual(item)
  await submit()
  expect(saveProject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ media: [item] }), undefined)
})

it('previews the unsaved draft without submitting it', () => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
  const { saveProject } = setup(undefined, { ...emptyDraft(), lang: 'en', title: 'Preview me', summary: 'Draft summary', url: 'https://example.com' })
  const button = [...host.querySelectorAll('button')].find(element => element.textContent === 'Preview')!
  act(() => button.click())
  const dialog = host.querySelector('dialog')!
  expect(dialog.textContent).toContain('Preview me')
  expect(dialog.textContent).toContain('Draft summary')
  act(() => dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click())
  expect(host.querySelector('dialog')).toBeNull()
  expect(saveProject).not.toHaveBeenCalled()
})
