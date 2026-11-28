import { useId, useState } from 'preact/hooks'
import { Icon } from './Icon'

type Props = {
  label?: string; choose: string; hint: string; accept: string; fileName?: string; disabled?: boolean; multiple?: boolean
} & ({ onPick(file: File): void; onPickMany?(files: File[]): void }
  | { onPick?(file: File): void; onPickMany(files: File[]): void })

export function FilePicker({ label, choose, hint, accept, fileName, disabled, multiple, onPick, onPickMany }: Props) {
  const id = useId()
  const [dragging, setDragging] = useState(false)

  function pick(files: File[]) {
    if (disabled || !files.length) return
    if (multiple && onPickMany) onPickMany(files)
    else if (onPick) onPick(files[0])
    else onPickMany?.(files.slice(0, 1))
  }

  return <label class="file-picker">
    {label && <span id={`${id}-label`}>{label}</span>}
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
        pick(Array.from(event.dataTransfer?.files ?? []))
      }}>
      <input class="sr-only" type="file" accept={accept} disabled={disabled} multiple={multiple}
        aria-labelledby={label ? `${id}-label ${id}-choose` : `${id}-choose`}
        aria-describedby={`${id}-hint ${id}-file`}
        onChange={event => {
          const input = event.currentTarget
          const files = Array.from(input.files ?? [])
          input.value = ''
          pick(files)
        }} />
      <span class="button file-choose" id={`${id}-choose`}><Icon name="upload" />{choose}</span>
      <span class="muted" id={`${id}-hint`}>{hint}</span>
    </span>
    <span class="file-name" id={`${id}-file`} role="status">{fileName}</span>
  </label>
}
