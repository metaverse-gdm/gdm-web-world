import { render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LanguageContext } from '../i18n'
import { LIMITS } from '../lib/wires'
import { TagInput } from './TagInput'

let host: HTMLDivElement
beforeEach(() => { host = document.body.appendChild(document.createElement('div')) })
afterEach(() => { act(() => render(null, host)); host.remove() })

function setup(initial: string[] = []) {
  const submit = vi.fn((event: SubmitEvent) => event.preventDefault())
  function Harness() {
    const [tags, setTags] = useState(initial)
    const [pending, setPending] = useState('')
    return <LanguageContext.Provider value="en">
      <form onSubmit={submit}>
        <TagInput tags={tags} pending={pending} onChange={setTags} onPendingChange={setPending} />
        <button type="submit">Publish</button>
      </form>
    </LanguageContext.Provider>
  }
  act(() => render(<Harness />, host))
  const input = host.querySelector('input')!
  const chips = () => [...host.querySelectorAll('.tag-chip[data-leaving="false"] > span')].map(chip => chip.textContent)
  function type(value: string) {
    act(() => {
      input.value = value
      input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
  }
  function key(key: string, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
    act(() => { input.dispatchEvent(event) })
    return event
  }
  function paste(text: string) {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', text)
    const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), { clipboardData })
    act(() => { input.dispatchEvent(event) })
    return event
  }
  return { submit, input, chips, type, key, paste }
}

it('commits with Enter and delimiters without submitting, and commits on Tab and blur', () => {
  const { input, submit, chips, type, key } = setup()
  type('  Game ')
  expect(key('Enter').defaultPrevented).toBe(true)
  expect(input.value).toBe('')
  expect(key('Enter').defaultPrevented).toBe(true)
  expect(submit).not.toHaveBeenCalled()
  type('Tool')
  expect(key(',').defaultPrevented).toBe(true)
  type('創作')
  expect(key('、').defaultPrevented).toBe(true)
  type('Demo')
  expect(key('Tab').defaultPrevented).toBe(false)
  act(() => { input.focus() })
  type('Music')
  act(() => { input.blur() })
  expect(chips()).toEqual(['Game', 'Tool', '創作', 'Demo', 'Music'])
})

it('leaves Enter to the IME until composition is complete', () => {
  const { input, chips, type, key } = setup()
  type('ゲーム')
  expect(key('Enter', { isComposing: true }).defaultPrevented).toBe(false)
  expect(key('Enter', { keyCode: 229 }).defaultPrevented).toBe(false)
  expect(input.value).toBe('ゲーム')
  expect(chips()).toEqual([])
  key('Enter')
  expect(chips()).toEqual(['ゲーム'])
})

it('splits pasted lists and trims and deduplicates case-sensitively', () => {
  const { input, chips, paste } = setup(['a'])
  expect(paste(' a, b、c, A ').defaultPrevented).toBe(true)
  expect(chips()).toEqual(['a', 'b', 'c', 'A'])
  expect(input.value).toBe('')
})

it('selects the last chip with Backspace and removes it on the next press', () => {
  const { input, chips, key } = setup(['Game', 'Tool'])
  act(() => { (host.querySelector('.tag-input') as HTMLElement).click() })
  expect(document.activeElement).toBe(input)
  expect(key('Backspace').defaultPrevented).toBe(true)
  expect(host.querySelector('[data-selected="true"]')?.textContent).toBe('Tool×')
  key('Backspace')
  expect(chips()).toEqual(['Game'])
  const remove = host.querySelector<HTMLButtonElement>('[aria-label="Remove tag “Game”"]')!
  act(() => remove.click())
  expect(chips()).toEqual([])
})

it('bounds pasted tags and leaves keyboard removal available at the limit', () => {
  const { input, chips, key, paste } = setup()
  const longTag = 'あ'.repeat(LIMITS.tag + 1)
  paste([longTag, ...Array.from({ length: LIMITS.tags }, (_, index) => `Tag ${index}`)].join(','))
  expect(chips()).toHaveLength(LIMITS.tags)
  expect(chips()[0]).toHaveLength(LIMITS.tag)
  expect(input.maxLength).toBe(LIMITS.tag)
  expect(input.readOnly).toBe(true)
  expect(host.querySelector('.tag-count')?.textContent).toBe(`${LIMITS.tags}/${LIMITS.tags}`)
  key('Backspace')
  key('Backspace')
  expect(input.readOnly).toBe(false)
})
