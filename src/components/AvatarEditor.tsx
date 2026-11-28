import { useLayoutEffect, useRef } from 'preact/hooks'
import { useAction } from '../hooks/useAction'
import { useMessages } from '../i18n'
import { saveMediaImage } from '../lib/thumbnails'
import { Avatar } from './Avatar'
import { ErrorText } from './common'
import { FilePicker } from './FilePicker'

export function AvatarEditor({ cid, group, disabled, onChange, onBusyChange }: {
  cid?: string; group?: boolean; disabled?: boolean; onChange(cid?: string): void; onBusyChange(busy: boolean): void
}) {
  const t = useMessages()
  const upload = useAction()
  const active = useRef(true)
  const uploading = useRef(false)
  useLayoutEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const locked = disabled || upload.busy
  function pick(file: File) {
    if (locked || uploading.current) return
    uploading.current = true
    onBusyChange(true)
    void upload.run(async () => {
      try {
        const next = await saveMediaImage(file)
        if (active.current) onChange(next)
      } finally {
        uploading.current = false
        if (active.current) onBusyChange(false)
      }
    })
  }
  return <fieldset class="avatar-editor" disabled={locked}>
    <legend>{t.avatar}</legend>
    <div class="avatar-editor-controls">
      <Avatar cid={cid} group={group} large />
      <FilePicker choose={cid ? t.changeAvatar : t.chooseAvatar} hint={t.avatarHint}
        accept="image/jpeg,image/png,image/webp" disabled={locked} onPick={pick} />
      {cid && <button type="button" disabled={locked} onClick={() => onChange(undefined)}>{t.removeAvatar}</button>}
    </div>
    {upload.busy && <p class="muted" role="status">{t.savingImages(0, 1)}</p>}
    <ErrorText message={upload.error} />
  </fieldset>
}
