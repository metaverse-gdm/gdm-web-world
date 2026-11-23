import { expect, it } from 'vitest'
import { PROJECT_ID } from '../test/fixtures'
import { createLocalPreferences, emptyDraft } from './localPreferences'

it('keeps preferences and drafts deleted in another browser tab across reloads', () => {
  localStorage.clear()
  const first = createLocalPreferences()
  first.setDraft('new', { ...emptyDraft(), title: 'Unpublished' })
  const second = createLocalPreferences()
  expect(second.get().drafts.new.value?.title).toBe('Unpublished')
  second.setDraft('new', null)
  second.setTheme('dark')
  first.setName('制作チーム')

  const saved = createLocalPreferences().get()
  expect(saved.displayName?.value).toBe('制作チーム')
  expect(saved.theme?.value).toBe('dark')
  expect(saved.drafts.new.value).toBeNull()
})

it('loads legacy drafts alongside translated drafts and other preferences', () => {
  const legacy = { ...emptyDraft(), title: 'Old draft', tags: 'Game, Tool' }
  localStorage.setItem('gdm-world:preferences:v1', JSON.stringify({
    v: 1, theme: { at: 1, value: 'light' }, displayName: { at: 1, value: 'Author' },
    drafts: { new: { at: 1, value: legacy } },
  }))
  const preferences = createLocalPreferences()
  const translated = {
    ...emptyDraft(), lang: 'ja' as const, thumbnailUrl: 'https://',
    translations: { en: { title: '', summary: 'Partially written', description: '' } },
  }
  preferences.setDraft(PROJECT_ID, translated)
  preferences.setDraft('new', { ...legacy, lang: 'en', translations: { en: translated.translations.en } })
  const saved = createLocalPreferences().get()
  expect(saved.drafts.new.value).toEqual(legacy)
  expect(saved.drafts[PROJECT_ID].value).toEqual(translated)
  expect(saved.theme?.value).toBe('light')
  expect(saved.displayName?.value).toBe('Author')
})
