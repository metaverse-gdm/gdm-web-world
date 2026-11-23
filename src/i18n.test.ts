import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getInitialLanguage, persistLanguage } from './i18n'

const languageKey = 'gdm-world:language'

beforeEach(() => {
  localStorage.removeItem(languageKey)
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(languageKey)
  document.documentElement.lang = 'ja'
})

it.each([
  { preferences: ['fr-FR', 'zh-CN', 'en-US'], expected: 'zh' },
  { preferences: ['ZH-Hant-TW', 'ja-JP'], expected: 'zh' },
  { preferences: ['en-GB', 'zh'], expected: 'en' },
  { preferences: ['ja-JP', 'en'], expected: 'ja' },
  { preferences: ['fr-FR', 'de'], expected: 'ja' },
  { preferences: [], expected: 'ja' },
])('detects $expected from $preferences', ({ preferences, expected }) => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(preferences)
  expect(getInitialLanguage()).toBe(expected)
})

it('prefers a saved supported language and applies the Chinese document tag', () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  localStorage.setItem(languageKey, 'fr')
  expect(getInitialLanguage()).toBe('en')

  persistLanguage('zh')
  expect(document.documentElement.lang).toBe('zh-Hans')
  expect(localStorage.getItem(languageKey)).toBe('zh')
  expect(getInitialLanguage()).toBe('zh')
})
