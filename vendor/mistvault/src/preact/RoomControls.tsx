import { useLayoutEffect, useState } from 'preact/hooks'
import { vaultMessage } from '../i18n.js'
import { validVaultRoom } from '../settings.js'
import type { VaultMode } from '../settings.js'

interface RoomControlsProps {
  locale?: string
  mode: VaultMode
  room: string
  controller: { configure(mode: VaultMode, room: string): boolean }
  disableUnchanged?: boolean
  onInvalid(): void
}
export function RoomControls(props: RoomControlsProps) {
  const [mode, setMode] = useState(props.mode), [room, setRoom] = useState(props.room)
  useLayoutEffect(() => { setMode(props.mode); setRoom(props.room) }, [props.mode, props.room, props.controller])
  const t = (key: Parameters<typeof vaultMessage>[1]) => vaultMessage(props.locale, key)
  return <>
    <label>{t('mode')}<select value={mode} onChange={e => setMode(e.currentTarget.value as VaultMode)}>
      <option value="auto">{t('auto')}</option><option value="custom">{t('custom')}</option><option value="off">{t('off')}</option></select></label>
    {mode === 'custom' && <label>{t('room')}<input value={room} maxLength={96}
      aria-invalid={!validVaultRoom(room)} onInput={e => setRoom(e.currentTarget.value)} /></label>}
    <button type="button" disabled={mode === 'custom' && !validVaultRoom(room) ||
      props.disableUnchanged && mode === props.mode && (mode !== 'custom' || room === props.room)}
      onClick={() => { if (!props.controller.configure(mode, room)) props.onInvalid() }}>{t('apply')}</button>
  </>
}
