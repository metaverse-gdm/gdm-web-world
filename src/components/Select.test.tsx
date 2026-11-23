import { render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Select } from './Select'

const options = [
  { value: 'apple', label: 'Apple' },
  { value: 'apricot', label: 'Apricot' },
  { value: 'blueberry', label: 'Blueberry' },
  { value: 'broccoli', label: 'Broccoli' },
]
let host: HTMLDivElement

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800)
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 10, y: 30, width: 180, height: 44 }),
  )
})

afterEach(() => {
  act(() => render(null, host))
  host.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function setup(disabled = false) {
  const onChange = vi.fn<(value: string) => void>()
  function Example() {
    const [value, setValue] = useState('apple')
    return <>
      <Select label="Produce" value={value} options={options} disabled={disabled}
        onChange={next => { setValue(next); onChange(next) }} />
      <button type="button">Next field</button>
    </>
  }
  act(() => render(<Example />, host))
  const combobox = host.querySelector<HTMLButtonElement>('[role="combobox"]')!
  const listbox = document.getElementById(combobox.getAttribute('aria-controls')!)!
  const active = () => document.getElementById(combobox.getAttribute('aria-activedescendant') ?? '')?.textContent
  const press = (key: string) => act(() => {
    combobox.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
  combobox.focus()
  return { combobox, listbox, press, active, onChange }
}

it('labels the combobox and listbox and separates keyboard focus from selection', () => {
  const { combobox, listbox, press, active, onChange } = setup()
  const label = document.getElementById(combobox.getAttribute('aria-labelledby')!) as HTMLLabelElement
  expect(label.control).toBe(combobox)
  expect(label.textContent).toBe('Produce')
  expect(combobox.getAttribute('aria-haspopup')).toBe('listbox')
  expect(combobox.getAttribute('aria-expanded')).toBe('false')
  expect(combobox.hasAttribute('aria-activedescendant')).toBe(false)
  expect(listbox.getAttribute('role')).toBe('listbox')
  expect(listbox.getAttribute('aria-hidden')).toBe('true')

  press('Enter')
  expect(combobox.getAttribute('aria-expanded')).toBe('true')
  expect(listbox.getAttribute('aria-labelledby')).toBe(label.id)
  expect(listbox.getAttribute('aria-hidden')).toBe('false')
  expect(active()).toBe('Apple')
  press('ArrowDown')
  expect(active()).toBe('Apricot')
  expect(listbox.querySelector('[aria-selected="true"]')?.textContent).toBe('Apple')
  expect(onChange).not.toHaveBeenCalled()
  press('End')
  expect(active()).toBe('Broccoli')
  press('Home')
  expect(active()).toBe('Apple')
  press('ArrowDown')
  press(' ')

  expect(onChange).toHaveBeenCalledExactlyOnceWith('apricot')
  expect(combobox.textContent).toBe('Apricot')
  expect(combobox.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(combobox)
})

it('matches prefixes, cycles repeated letters and cancels with Escape', () => {
  vi.useFakeTimers()
  const { combobox, press, active, onChange } = setup()
  press('B')
  expect(active()).toBe('Blueberry')
  press('b')
  expect(active()).toBe('Broccoli')
  vi.advanceTimersByTime(700)
  press('b')
  press('r')
  expect(active()).toBe('Broccoli')
  press('Escape')

  expect(combobox.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(combobox)
  expect(onChange).not.toHaveBeenCalled()
  press('ArrowUp')
  expect(active()).toBe('Apple')
  press('Tab')
  expect(combobox.getAttribute('aria-expanded')).toBe('false')
})

it('commits a pointer selection and dismisses on outside interaction', () => {
  const { combobox, listbox, onChange } = setup()
  act(() => combobox.click())
  act(() => (listbox.children[2] as HTMLElement).click())
  expect(onChange).toHaveBeenCalledExactlyOnceWith('blueberry')
  act(() => combobox.click())
  act(() => { host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
  expect(combobox.getAttribute('aria-expanded')).toBe('false')
})

it('keeps a disabled combobox closed', () => {
  const { combobox, onChange } = setup(true)
  expect(combobox.disabled).toBe(true)
  act(() => combobox.click())
  expect(combobox.getAttribute('aria-expanded')).toBe('false')
  expect(onChange).not.toHaveBeenCalled()
})
