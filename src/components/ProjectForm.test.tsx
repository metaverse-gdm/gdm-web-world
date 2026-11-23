import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LanguageContext } from '../i18n'
import { createLocalPreferences, emptyDraft } from '../lib/localPreferences'
import type { Runtime } from '../lib/runtime'
import { PROJECT_ID } from '../test/fixtures'
import { ProjectForm } from './ProjectForm'

let host: HTMLDivElement
beforeEach(() => {
  localStorage.clear()
  host = document.body.appendChild(document.createElement('div'))
})
afterEach(() => { act(() => render(null, host)); host.remove() })

function setup() {
  const preferences = createLocalPreferences()
  const saveProject = vi.fn(async () => PROJECT_ID)
  const runtime = { preferences, saveProject } as unknown as Runtime
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
