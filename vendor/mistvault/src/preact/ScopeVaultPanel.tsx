import { useState } from 'preact/hooks'
import { vaultMessage } from '../i18n.js'
import type { ScopeVault } from '../scopeVault.js'
import { RoomControls } from './RoomControls.js'
import { useVaultView } from './useVault.js'

export interface ScopeVaultPanelProps { vault: ScopeVault; locale?: string }

export function ScopeVaultPanel({ vault, locale }: ScopeVaultPanelProps) {
  const view = useVaultView(vault), [notice, setNotice] = useState('')
  const t = (key: Parameters<typeof vaultMessage>[1]) => vaultMessage(locale, key)
  const busy = view.mode === 'off' || view.status === 'saving' || view.status === 'restoring'
  async function copyRoom() {
    try { await navigator.clipboard.writeText(view.room); setNotice(t('copied')) }
    catch { setNotice(t('copyError')) }
  }
  return <section class="mv-panel mv-stack" aria-label={t('title')}>
    <h2>{t('title')}</h2>
    <div class="mv-status-card"><div class="mv-status-text" role="status" data-state={view.status}>
      <strong>{t(`status_${view.status}`)}</strong>{view.error && <span class="mv-error">{view.error}</span>}
    </div><div class="mv-actions">
      <button type="button" disabled={busy} onClick={() => { void vault.saveNow() }}>{t('save')}</button>
      <button type="button" disabled={busy} onClick={() => { void vault.restoreNow() }}>{t('restore')}</button>
    </div></div>
    <div class="mv-stack"><RoomControls locale={locale} mode={view.mode} room={view.config.room}
      controller={vault} disableUnchanged={!!view.config.by} onInvalid={() => setNotice(t('invalidRoom'))} /></div>
    {view.mode !== 'off' && <div class="mv-room"><div class="mv-room-row">
      <label>{t('room')}<input readOnly value={view.room} placeholder={t('roomPending')} onFocus={e => e.currentTarget.select()} /></label>
      <button type="button" disabled={!view.room} onClick={() => { void copyRoom() }}>{t('copy')}</button>
    </div><p class="mv-muted mv-hint">{t('scopeRoomHint')}</p></div>}
    {notice && <p class="mv-notice" role="status">{notice}</p>}
  </section>
}
