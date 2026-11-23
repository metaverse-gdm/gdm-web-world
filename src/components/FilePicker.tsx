import { useId, useState } from 'preact/hooks'
import { Icon } from './Icon'

export function FilePicker({ label, choose, hint, accept, fileName, disabled, onPick }: {
  label: string; choose: string; hint: string; accept: string; fileName?: string; disabled?: boolean
  onPick(file: File): void
}) {
  const id = useId()
  const [dragging, setDragging] = useState(false)

  return <label class="file-picker">
    <span id={`${id}-label`}>{label}</span>
    <span class="file-dropzone" data-dragging={dragging && !disabled}
      onDragOver={event => {
        if (!event.dataTransfer?.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
        setDragging(!disabled)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer?.files[0]
        if (file && !disabled) onPick(file)
      }}>
      <input class="sr-only" type="file" accept={accept} disabled={disabled}
        aria-labelledby={`${id}-label ${id}-choose`}
        aria-describedby={`${id}-hint ${id}-file`}
        onChange={event => {
          const input = event.currentTarget
          const file = input.files?.[0]
          input.value = ''
          if (file && !disabled) onPick(file)
        }} />
      <span class="button file-choose" id={`${id}-choose`}><Icon name="upload" />{choose}</span>
      <span class="muted" id={`${id}-hint`}>{hint}</span>
    </span>
    <span class="file-name" id={`${id}-file`} role="status">{fileName}</span>
  </label>
}
