import { useContext } from 'preact/hooks'
import { LlmSettings } from '@tik-choco/mistai/preact'
import type { LlmSettingsLocale } from '@tik-choco/mistai/preact'
import { LanguageContext, useMessages } from '../i18n'
import type { Language } from '../i18n'
import { localSettingsAdapter } from '../lib/ai/settings'
// Register the singleton-backed room scope before mistai discovers models.
import '../lib/ai/network'
import '@tik-choco/mistai/ui.css'

const locales: Record<Language, LlmSettingsLocale> = { ja: 'ja', en: 'en', zh: 'zh-CN' }

export function AiSettings() {
  const t = useMessages()
  const lang = useContext(LanguageContext)
  return <div class="screen-stack ai-settings">
    <p class="muted">{t.aiSettingsHint}</p>
    <LlmSettings title={t.aiSettings} locale={locales[lang]} localSettings={localSettingsAdapter}
      tasks={[{ id: 'translate', label: t.aiTask, tip: t.aiTaskTip, reasoning: true }]} />
  </div>
}
