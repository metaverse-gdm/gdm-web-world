import { beforeEach, expect, it, vi } from 'vitest'
import { emptyLlmConfig, saveLlmConfig } from '@tik-choco/mistai/llm-config'
import { aiConfigured, loadLocalSettings, localSettingsAdapter, parseLocalSettings, SETTINGS_KEY, subscribeAiSettings } from './settings'

beforeEach(() => localStorage.clear())

it('defaults to following the shared default with no reasoning effort', () => {
  const expected = { tasks: { translate: { reasoningEffort: 'none' } }, roomProvide: {}, recentModels: [] }
  expect(loadLocalSettings()).toEqual(expected)
  localStorage.setItem(SETTINGS_KEY, '{')
  expect(loadLocalSettings()).toEqual(expected)
  expect(parseLocalSettings({ tasks: { translate: { ref: { model: 42 }, reasoningEffort: 'invalid' } } })).toEqual(expected)
  expect(aiConfigured()).toBe(false)
})

it('validates model references, keeps one task and deduplicates recent models', () => {
  const ref = { providerId: 'api', model: 'translator' }
  const settings = parseLocalSettings({
    tasks: { translate: { ref: { ...ref, ignored: true }, reasoningEffort: 'high' }, other: { ref } },
    recentModels: [ref, null, ref, { providerId: 'api' }],
    roomProvide: { room: { enabled: true, shared: [ref, ref, {}] } },
  })
  expect(settings).toEqual({
    tasks: { translate: { ref, reasoningEffort: 'high' } }, recentModels: [ref], roomProvide: { room: { enabled: true, shared: [ref] } },
  })
  localSettingsAdapter.set(settings)
  expect(localSettingsAdapter.get()).toEqual(settings)
})

it('uses the shared default and reacts to shared and local config changes', () => {
  const callback = vi.fn()
  const stop = subscribeAiSettings(callback)
  const ref = { providerId: 'api', model: 'translator' }
  const shared = emptyLlmConfig()
  shared.providers.push({ id: 'api', label: 'API', baseUrl: 'https://example.com/v1', apiKey: '' })
  shared.defaultModel = ref
  saveLlmConfig(shared)
  expect(aiConfigured()).toBe(true)
  localSettingsAdapter.set(parseLocalSettings({ tasks: { translate: { ref, reasoningEffort: 'low' } } }))
  expect(callback).toHaveBeenCalledTimes(2)
  stop()
  shared.providers[0].enabled = false
  saveLlmConfig(shared)
  expect(aiConfigured()).toBe(false)
  expect(callback).toHaveBeenCalledTimes(2)
})
