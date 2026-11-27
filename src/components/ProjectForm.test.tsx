import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LanguageContext } from '../i18n'
import { emptyLlmConfig, saveLlmConfig } from '@tik-choco/mistai/llm-config'
import { createLocalPreferences, emptyDraft } from '../lib/localPreferences'
import type { Runtime } from '../lib/runtime'
import { PROJECT_ID } from '../test/fixtures'
import { ProjectForm } from './ProjectForm'
import { translateProjectText } from '../lib/ai/translate'

vi.mock('../lib/ai/translate', () => ({ translateProjectText: vi.fn() }))

let host: HTMLDivElement
beforeEach(() => {
  localStorage.clear()
  vi.mocked(translateProjectText).mockReset()
  host = document.body.appendChild(document.createElement('div'))
})
afterEach(() => { act(() => render(null, host)); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function setup() {
  const preferences = createLocalPreferences()
  const saveProject = vi.fn(async () => PROJECT_ID)
  const runtime = {
    preferences, saveProject, getSelf: () => ({ id: 'did:key:self' }), getCatalog: () => ({ groups: new Map() }),
  } as unknown as Runtime
  function Harness() {
    const [, refresh] = useState(0)
    useEffect(() => preferences.subscribe(() => refresh(n => n + 1)), [])
    return <LanguageContext.Provider value="en"><ProjectForm runtime={runtime} /></LanguageContext.Provider>
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
})

it('promotes a filled language when the default tab is empty and rejects an HTTP thumbnail', async () => {
  const { saveProject, preferences } = setup()
  act(() => preferences.setDraft('new', { ...emptyDraft(), thumbnailCid: 'a'.repeat(32) }))
  act(() => tab('ja').click())
  type(activePanel + ' input', '日本語タイトル')
  type(activePanel + ' textarea', '日本語概要')
  type('input[type="url"]', 'https://project.example')
  type('input[inputmode="url"]', 'http://project.example/image.png')
  expect(preferences.get().drafts.new.value?.thumbnailCid).toBeUndefined()
  await submit()
  expect(saveProject).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('https://')

  type('input[inputmode="url"]', 'https://project.example/image.png')
  await submit()
  expect(saveProject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    lang: 'ja', title: '日本語タイトル', summary: '日本語概要',
    translations: undefined, thumbnailCid: undefined, thumbnailUrl: 'https://project.example/image.png',
  }), undefined)
})
