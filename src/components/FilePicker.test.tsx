import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FilePicker } from './FilePicker'

const file = new File(['abc'], 'thumbnail.png', { type: 'image/png' })
const missingDragHandlers = ['ondragover', 'ondragleave', 'ondrop'].filter(name => !(name in HTMLElement.prototype))
let host: HTMLDivElement

beforeEach(() => {
  // Preact uses the browser's event handler properties to resolve the event name.
  for (const name of missingDragHandlers) Object.defineProperty(HTMLElement.prototype, name, { value: null, configurable: true })
  host = document.body.appendChild(document.createElement('div'))
})

afterEach(() => {
  act(() => render(null, host))
  host.remove()
  for (const name of missingDragHandlers) Reflect.deleteProperty(HTMLElement.prototype, name)
})

function setup(disabled = false) {
  const onPick = vi.fn()
  act(() => render(<FilePicker label="Thumbnail" choose="Choose image" hint="Or drop an image here"
    accept="image/png" fileName="previous.png" disabled={disabled} onPick={onPick} />, host))
  const input = host.querySelector('input')!
  const dropzone = host.querySelector('.file-dropzone')!
  const transfer = new DataTransfer()
  transfer.items.add(file)
  // A browser exposes a "Files" entry for file drags.
  Object.defineProperty(transfer, 'types', { value: ['Files'] })
  return { input, dropzone, onPick, transfer }
}

function dragEvent(type: string, dataTransfer: DataTransfer) {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer })
}

it('keeps an accessible file input, reports the filename and allows the same file to be chosen again', () => {
  const { input, transfer, onPick } = setup()
  const name = input.getAttribute('aria-labelledby')!.split(' ').map(id => document.getElementById(id)?.textContent)
  expect(name).toEqual(['Thumbnail', 'Choose image'])
  expect(input.accept).toBe('image/png')
  expect(host.querySelector('[role="status"]')?.textContent).toBe('previous.png')
  for (let attempt = 0; attempt < 2; attempt++) {
    input.files = transfer.files
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(input.value).toBe('')
  }
  expect(onPick.mock.calls).toEqual([[file], [file]])
})

it('highlights file drags and uses the same callback for a drop', () => {
  const { dropzone, onPick, transfer } = setup()
  const drag = dragEvent('dragover', transfer)
  act(() => { dropzone.dispatchEvent(drag) })
  expect(drag.defaultPrevented).toBe(true)
  expect(dropzone.getAttribute('data-dragging')).toBe('true')
  act(() => { dropzone.dispatchEvent(dragEvent('drop', transfer)) })
  expect(dropzone.getAttribute('data-dragging')).toBe('false')
  expect(onPick).toHaveBeenCalledExactlyOnceWith(file)
})

it('ignores dropped files while disabled', () => {
  const { input, dropzone, onPick, transfer } = setup(true)
  expect(input.disabled).toBe(true)
  act(() => { dropzone.dispatchEvent(dragEvent('drop', transfer)) })
  expect(onPick).not.toHaveBeenCalled()
})

it('passes all selected or dropped files in order in multiple mode', () => {
  const onPickMany = vi.fn()
  const other = new File(['def'], 'other.png', { type: 'image/png' })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  transfer.items.add(other)
  act(() => render(<FilePicker choose="Choose images" hint="Or drop images here" accept="image/png"
    multiple onPickMany={onPickMany} />, host))
  const input = host.querySelector('input')!
  expect(input.multiple).toBe(true)
  input.files = transfer.files
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(input.value).toBe('')
  act(() => { host.querySelector('.file-dropzone')!.dispatchEvent(dragEvent('drop', transfer)) })
  expect(onPickMany.mock.calls).toEqual([[[file, other]], [[file, other]]])
})
