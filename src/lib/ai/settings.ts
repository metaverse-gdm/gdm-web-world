import {
  emptyLlmConfig, isModelRef, loadLlmConfig, migrateSharedLlmConfig, resolveModel, saveLlmConfig, subscribeLlmConfig,
} from '@tik-choco/mistai/llm-config'
import type { ModelRefV1 } from '@tik-choco/mistai/llm-config'
import type { LlmLocalSettings, LlmSettingsLocalAdapter, ReasoningEffort } from '@tik-choco/mistai/preact'

export const SETTINGS_KEY = 'gdm-world:ai-settings-v1'
const listeners = new Set<() => void>()
const efforts: readonly ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

function modelRef(value: unknown): ModelRefV1 | undefined {
  if (isModelRef(value) && value.providerId.trim() && value.model.trim()) {
    return { providerId: value.providerId, model: value.model }
  }
}

function uniqueRefs(value: unknown): ModelRefV1[] {
  const seen = new Set<string>()
  return (Array.isArray(value) ? value : []).flatMap(item => {
    const ref = modelRef(item)
    if (!ref) return []
    const key = JSON.stringify([ref.providerId, ref.model])
    if (seen.has(key)) return []
    seen.add(key)
    return [ref]
  })
}

export function loadSharedConfig() {
  const config = loadLlmConfig() ?? emptyLlmConfig()
  if (migrateSharedLlmConfig(config).changed) saveLlmConfig(config)
  return config
}

export function parseLocalSettings(value: unknown): LlmLocalSettings {
  const raw = record(value)
  const task = record(record(raw.tasks).translate)
  const ref = modelRef(task.ref)
  return {
    tasks: { translate: {
      ...(ref ? { ref } : {}),
      reasoningEffort: efforts.includes(task.reasoningEffort as ReasoningEffort) ? task.reasoningEffort as ReasoningEffort : 'none',
    } },
    roomProvide: Object.fromEntries(Object.entries(record(raw.roomProvide)).map(([id, item]) => {
      const room = record(item)
      return [id, { enabled: room.enabled === true, shared: uniqueRefs(room.shared) }]
    })),
    recentModels: uniqueRefs(raw.recentModels).slice(0, 8),
  }
}

export function loadLocalSettings(): LlmLocalSettings {
  try { return parseLocalSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')) }
  catch { return parseLocalSettings(undefined) }
}

export function saveLocalSettings(settings: LlmLocalSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(parseLocalSettings(settings))) }
  catch { return }
  listeners.forEach(cb => cb())
}

export function subscribeLocalSettings(cb: () => void) {
  listeners.add(cb)
  const onStorage = (event: StorageEvent) => { if (event.key === SETTINGS_KEY || event.key === null) cb() }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage) }
}

export const localSettingsAdapter: LlmSettingsLocalAdapter = {
  get: loadLocalSettings, set: saveLocalSettings, subscribe: subscribeLocalSettings,
}

export function aiConfigured() {
  return !!resolveModel(loadSharedConfig(), loadLocalSettings().tasks.translate.ref)
}

export function subscribeAiSettings(cb: () => void) {
  const stopLocal = subscribeLocalSettings(cb)
  const stopShared = subscribeLlmConfig(cb)
  return () => { stopLocal(); stopShared() }
}
