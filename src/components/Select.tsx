import { createPortal } from 'preact/compat'
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { TargetedKeyboardEvent } from 'preact'
import { Icon } from './Icon'

type Option<Value extends string> = { value: Value; label: string }
type SelectProps<Value extends string> = {
  value: Value
  options: readonly Option<Value>[]
  onChange(value: Value): void
  disabled?: boolean
} & ({ label: string; ariaLabel?: never } | { label?: never; ariaLabel: string })

const VIEWPORT_MARGIN = 8
const POPUP_GAP = 6
const MAX_POPUP_HEIGHT = 298
const TYPEAHEAD_TIMEOUT = 650

function positionPopup(trigger: HTMLElement, popup: HTMLElement) {
  const rect = trigger.getBoundingClientRect()
  const viewport = window.visualViewport
  const left = viewport?.offsetLeft ?? 0
  const top = viewport?.offsetTop ?? 0
  const width = viewport?.width ?? document.documentElement.clientWidth
  const height = viewport?.height ?? document.documentElement.clientHeight
  const popupWidth = Math.min(rect.width, Math.max(0, width - 2 * VIEWPORT_MARGIN))
  const popupLeft = Math.max(left + VIEWPORT_MARGIN, Math.min(rect.left, left + width - popupWidth - VIEWPORT_MARGIN))
  popup.style.left = `${popupLeft}px`
  popup.style.width = `${popupWidth}px`

  const below = top + height - VIEWPORT_MARGIN - rect.bottom - POPUP_GAP
  const above = rect.top - POPUP_GAP - top - VIEWPORT_MARGIN
  const desired = Math.min(MAX_POPUP_HEIGHT, popup.scrollHeight + 2)
  const flip = below < desired && above > below
  popup.dataset.placement = flip ? 'above' : 'below'
  popup.style.top = `${flip ? rect.top - POPUP_GAP : rect.bottom + POPUP_GAP}px`
  popup.style.maxHeight = `${Math.max(0, Math.min(MAX_POPUP_HEIGHT, flip ? above : below))}px`
  return rect.bottom > top && rect.top < top + height
}

export function Select<Value extends string>({ value, options, onChange, label, ariaLabel, disabled }: SelectProps<Value>) {
  const id = useId()
  const labelId = `${id}-label`
  const listId = `${id}-list`
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [highlighted, setHighlighted] = useState<Value>()
  const search = useRef({ text: '', time: 0 })
  const selectedIndex = options.findIndex(option => option.value === value)
  const highlightedIndex = options.findIndex(option => option.value === highlighted)
  const activeIndex = highlightedIndex < 0 ? Math.max(0, selectedIndex) : highlightedIndex
  const unavailable = disabled || options.length === 0
  const open = expanded && !unavailable
  const activeId = open ? `${listId}-${activeIndex}` : undefined

  const close = useCallback(() => {
    setExpanded(false)
    search.current.text = ''
  }, [])

  useLayoutEffect(() => {
    if (unavailable && expanded) close()
  }, [unavailable, expanded, close])

  useLayoutEffect(() => {
    if (!open || !trigger.current || !list.current) return
    const button = trigger.current
    const popup = list.current
    function place() {
      if (!positionPopup(button, popup)) close()
    }
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !button.contains(event.target) && !popup.contains(event.target)) close()
    }
    function followScroll(event: Event) {
      if (event.target !== popup) place()
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    observer?.observe(button)
    const viewport = window.visualViewport
    window.addEventListener('resize', place)
    window.addEventListener('scroll', followScroll, true)
    viewport?.addEventListener('resize', place)
    viewport?.addEventListener('scroll', place)
    document.addEventListener('pointerdown', dismissOutside, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', followScroll, true)
      viewport?.removeEventListener('resize', place)
      viewport?.removeEventListener('scroll', place)
      document.removeEventListener('pointerdown', dismissOutside, true)
    }
  }, [open, options, close])

  useLayoutEffect(() => {
    if (!activeId || !list.current) return
    const popup = list.current
    const option = popup.children[activeIndex] as HTMLElement
    const start = option.offsetTop
    const end = start + option.offsetHeight
    if (start < popup.scrollTop) popup.scrollTop = start
    else if (end > popup.scrollTop + popup.clientHeight) popup.scrollTop = end - popup.clientHeight
  }, [activeId, activeIndex, options])

  function select(next: Value) {
    close()
    trigger.current?.focus({ preventScroll: true })
    if (next !== value) onChange(next)
  }

  function highlight(index: number) {
    setHighlighted(options[index]?.value)
    setExpanded(true)
  }

  function onKeyDown(event: TargetedKeyboardEvent<HTMLButtonElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
    const { key } = event
    switch (key) {
      case 'Tab':
        close()
        return
      case 'Escape':
        if (!open) return
        event.stopPropagation()
        close()
        trigger.current?.focus({ preventScroll: true })
        break
      case 'Enter':
      case ' ':
        if (event.repeat) break
        if (open) select(options[activeIndex].value)
        else highlight(Math.max(0, selectedIndex))
        break
      case 'ArrowDown':
        highlight(open ? Math.min(options.length - 1, activeIndex + 1) : Math.max(0, selectedIndex))
        break
      case 'ArrowUp':
        highlight(open ? Math.max(0, activeIndex - 1) : selectedIndex < 0 ? options.length - 1 : selectedIndex)
        break
      case 'Home':
        highlight(0)
        break
      case 'End':
        highlight(options.length - 1)
        break
      default: {
        if ([...key].length !== 1) return
        const locale = document.documentElement.lang || undefined
        const character = key.normalize().toLocaleLowerCase(locale)
        const now = Date.now()
        const previous = now - search.current.time < TYPEAHEAD_TIMEOUT ? search.current.text : ''
        const repeated = previous !== '' && [...previous].every(letter => letter === character)
        const prefix = repeated ? character : previous + character
        search.current = { text: prefix, time: now }
        const start = previous && !repeated ? activeIndex : (open ? activeIndex : selectedIndex) + 1
        for (let offset = 0; offset < options.length; offset++) {
          const index = (start + offset) % options.length
          if (options[index].label.normalize().toLocaleLowerCase(locale).startsWith(prefix)) {
            highlight(index)
            break
          }
        }
      }
    }
    event.preventDefault()
  }

  return <div class="select-field">
    {label && <label id={labelId} for={id}>{label}</label>}
    <button id={id} ref={trigger} class="select-trigger" type="button" role="combobox" aria-haspopup="listbox"
      aria-labelledby={label ? labelId : undefined} aria-label={ariaLabel} aria-expanded={open}
      aria-controls={listId} aria-activedescendant={activeId} disabled={unavailable}
      onBlur={event => {
        if (!list.current?.contains(event.relatedTarget as Node | null)) close()
      }} onKeyDown={onKeyDown} onClick={() => {
        trigger.current?.focus({ preventScroll: true })
        if (open) close()
        else highlight(Math.max(0, selectedIndex))
      }}>
      <span>{options[selectedIndex]?.label}</span><Icon name="chevron" />
    </button>
    {createPortal(<ul id={listId} ref={list} class="select-list" role="listbox"
      aria-labelledby={label ? labelId : undefined} aria-label={ariaLabel} aria-hidden={!open} data-open={open}
      tabIndex={-1} inert={!open} onFocus={() => trigger.current?.focus({ preventScroll: true })}>
      {options.map((option, index) =>
        <li key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value}
          data-active={index === activeIndex} onMouseDown={event => event.preventDefault()} onClick={() => select(option.value)}>
          <span>{option.label}</span>{option.value === value && <Icon name="check" />}
        </li>
      )}
    </ul>, document.body)}
  </div>
}
