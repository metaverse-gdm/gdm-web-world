import { useContext, useState } from 'preact/hooks'
import { ScopeVaultPanel } from '@tik-choco/mistvault/preact'
import type { VaultLocale } from '@tik-choco/mistvault'
import type { Runtime } from '../lib/runtime'
import { CATALOG_SCOPE_ID } from '../config'
import { useAction } from '../hooks/useAction'
import { LanguageContext, useMessages } from '../i18n'
import type { Language } from '../i18n'
import { LIMITS } from '../lib/wires'
import { BackLink, CopyDid, ErrorText } from './common'
import { Icon } from './Icon'
import { MistlPairing } from './MistlPairing'

let revealAdvanced = false
/** Opens the advanced section on the next settings visit (e.g. from the approval prompt). */
export const showAdvancedSettings = () => { revealAdvanced = true }

const vaultLocales: Record<Language, VaultLocale> = { ja: 'ja', en: 'en', zh: 'zh-CN' }

export function SettingsPage({ runtime }: { runtime: Runtime }) {
  const t = useMessages()
  const lang = useContext(LanguageContext)
  const action = useAction()
  const preferences = runtime.preferences.get()
  const self = runtime.getSelf().id
  const admin = runtime.getCatalog().roles.get(self) === 'admin'
  const [advancedOpen] = useState(() => {
    const open = revealAdvanced || !!runtime.getSelf().expiresSoon
    revealAdvanced = false
    return open
  })
  return <section class="screen-stack content-width" aria-label={t.settings}>
    <BackLink />
    <section class="panel preferences">
      <label>{t.displayName}
        <input key={self} maxLength={LIMITS.displayName} disabled={action.busy} aria-describedby="display-name-hint"
          defaultValue={preferences.displayName?.value ?? runtime.displayNameFor(self) ?? ''}
          onChange={event => {
            const input = event.currentTarget
            const name = input.value.trim()
            input.value = name
            void action.run(() => runtime.saveDisplayName(name))
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.isComposing) event.currentTarget.blur()
          }} />
        <span id="display-name-hint" class="muted">{t.displayNameHint}</span>
      </label>
      <ErrorText message={action.error} />
    </section>
    <details class="advanced-settings" open={advancedOpen}>
      <summary>{t.advancedSettings}<Icon name="chevron" /></summary>
      <div class="advanced-body"><div class="screen-stack">
        <section class="panel">
          <div class="settings-identity"><span>{t.browserDid}</span><CopyDid did={runtime.identity.did} /></div>
        </section>
        <MistlPairing runtime={runtime} />
        <div class="panel vault-section" data-configurable={admin}>
          <ScopeVaultPanel vault={runtime.scopeVault} locale={vaultLocales[lang]} />
          <p class="scope-label">{t.scopeId} <code>{CATALOG_SCOPE_ID}</code></p>
        </div>
      </div></div>
    </details>
  </section>
}
