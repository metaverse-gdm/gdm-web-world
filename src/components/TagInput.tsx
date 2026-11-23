import { useId, useRef, useState } from 'preact/hooks'
import { useMessages } from '../i18n'
import { LIMITS } from '../lib/wires'

const separators = /[,、]/
export function mergeTags(tags: readonly string[], input: string): string[] {
  const additions = input.split(separators).map(tag =>
    tag.trim().slice(0, LIMITS.tag).replace(/[\uD800-\uDBFF]$/u, '').trimEnd()).filter(Boolean)
  return [...new Set([...tags, ...additions])].slice(0, LIMITS.tags)
}

export function TagInput({ tags, pending, onChange, onPendingChange }: {
  tags: string[]; pending: string; onChange(tags: string[]): void; onPendingChange(text: string): void
}) {
  const t = useMessages()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const [selected, setSelected] = useState<string>()
  const [leaving, setLeaving] = useState<{ tag: string; index: number }[]>([])
  const atLimit = tags.length >= LIMITS.tags

  function commit(text: string) {
    const next = mergeTags(tags, text)
    if (next.length !== tags.length) {
      setLeaving(previous => previous.filter(({ tag }) => !next.includes(tag)))
      onChange(next)
    }
    setSelected(undefined)
    onPendingChange('')
  }
  function remove(tag: string) {
    setLeaving(previous => [...previous, { tag, index: tags.indexOf(tag) }])
    onChange(tags.filter(value => value !== tag))
    setSelected(undefined)
    input.current?.focus()
  }
  function edit(text: string, isComposing = false) {
    if (!isComposing && separators.test(text)) commit(text)
    else {
      setSelected(undefined)
      onPendingChange(text)
    }
  }

  const chips = tags.map(tag => ({ tag, removed: false }))
  for (const { tag, index } of [...leaving].reverse()) chips.splice(index, 0, { tag, removed: true })
  return <div class="tag-editor">
    <label htmlFor={id}>{t.tags}</label>
    <div class="tag-input" onClick={event => { if (!(event.target instanceof HTMLButtonElement)) input.current?.focus() }}>
      {chips.map(({ tag, removed }) => <span class="tag-chip" key={tag} data-selected={selected === tag}
        data-leaving={removed} aria-hidden={removed || undefined} onAnimationEnd={event => {
          if (removed && event.target === event.currentTarget) setLeaving(previous => previous.filter(chip => chip.tag !== tag))
        }}>
        <span>{tag}</span><button type="button" aria-label={t.removeTag(tag)} disabled={removed}
          onClick={() => remove(tag)}>×</button>
      </span>)}
      <input id={id} ref={input} value={pending} maxLength={LIMITS.tag} readOnly={atLimit} aria-describedby={id + '-count'}
        onInput={event => edit(event.currentTarget.value, composing.current || event.isComposing)}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={event => { composing.current = false; edit(event.currentTarget.value) }}
        onBlur={event => commit(event.currentTarget.value)}
        onPaste={event => {
          const text = event.clipboardData?.getData('text/plain')
          if (atLimit || composing.current || !text || !separators.test(text)) return
          event.preventDefault()
          const { value, selectionStart, selectionEnd } = event.currentTarget
          commit(value.slice(0, selectionStart ?? 0) + text + value.slice(selectionEnd ?? value.length))
        }}
        onKeyDown={event => {
          if (composing.current || event.isComposing || event.keyCode === 229) return
          const { value } = event.currentTarget
          if (event.key === 'Enter' || separators.test(event.key) || event.key === 'Tab' && value) {
            if (event.key !== 'Tab') event.preventDefault()
            commit(value)
          } else if (event.key === 'Backspace' && !value && tags.length) {
            event.preventDefault()
            const last = tags[tags.length - 1]
            if (selected === last) { if (!event.repeat) remove(last) }
            else setSelected(last)
          }
        }} />
      <span class="tag-count muted" id={id + '-count'}>{tags.length}/{LIMITS.tags}</span>
    </div>
  </div>
}
