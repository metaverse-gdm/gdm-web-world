import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LanguageContext, messages } from '../i18n'
import type { ProjectFields } from '../lib/wires'
import { ProjectCardView } from './ProjectCard'
import { ProjectDetailBody } from './ProjectDetail'
import { ProjectPreviewDialog } from './ProjectPreview'

const t = messages.en
const imageUrl = 'https://example.com/train.png'
const fields: ProjectFields = {
  title: 'Train timetable', summary: 'A railway simulation', description: 'Drive a **train**.',
  lang: 'en', url: '', tags: ['simulation'],
  media: [{ url: imageUrl }],
}
const updatedAt = Date.UTC(2026, 10, 28)
const authorDid = 'did:key:preview-author'
const authorName = 'Team Sakura'
let host: HTMLDivElement
let opener: HTMLButtonElement
const dialog = () => host.querySelector<HTMLDialogElement>('.project-preview')!
const tab = (name: string) => [...dialog().querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === name)!
const closeButton = () => dialog().querySelector<HTMLButtonElement>(`button[aria-label="${t.close}"]`)!

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  opener = document.body.appendChild(document.createElement('button'))
  opener.focus()
})

afterEach(() => {
  act(() => render(null, host))
  host.remove()
  opener.remove()
})

function setup(draft = fields) {
  const onClose = vi.fn()
  act(() => render(<LanguageContext.Provider value="en">
    <ProjectPreviewDialog fields={draft} updatedAt={updatedAt} authorDid={authorDid} authorName={authorName} onClose={onClose} />
  </LanguageContext.Provider>, host))
  return onClose
}

it('opens the detail preview with the real detail layout, metadata, tags, gallery and Markdown', () => {
  setup()
  expect(dialog().open).toBe(true)
  expect(document.getElementById(dialog().getAttribute('aria-labelledby')!)?.textContent).toBe(t.previewTitle)
  expect(dialog().textContent).toContain(t.previewNotice)
  expect(tab(t.previewDetail).getAttribute('aria-selected')).toBe('true')
  expect(dialog().querySelector('.detail-heading h1')?.textContent).toBe(fields.title)
  expect(dialog().querySelector('.lead')?.textContent).toBe(fields.summary)
  expect(dialog().querySelector('.work-tags li')?.textContent).toBe(fields.tags[0])
  expect(dialog().querySelector('.project-meta time')?.textContent).toBe('2026.11.28')
  expect(dialog().querySelector('.project-meta .author-link')?.textContent).toBe(authorName)
  expect(dialog().querySelector('.project-meta a')).toBeNull()
  expect(dialog().querySelector('.media-gallery-stage img')?.getAttribute('src')).toBe(imageUrl)
  expect(dialog().querySelector('.description strong')?.textContent).toBe('train')
  expect(dialog().querySelector('.detail-panel .actions a')).toBeNull()
  expect(dialog().querySelector('.work-card')).toBeNull()
})

it('uses the localized untitled fallback for either view', () => {
  setup({ ...fields, title: '  ' })
  expect(dialog().querySelector('.detail-heading h1')?.textContent).toBe(t.previewUntitled)
  act(() => tab(t.previewCard).click())
  expect(dialog().querySelector('.work-card h2')?.textContent).toBe(t.previewUntitled)
})

it('switches between the real catalog card and the detail view without linking the draft to a route', () => {
  setup()
  act(() => tab(t.previewCard).click())
  expect(tab(t.previewCard).getAttribute('aria-selected')).toBe('true')
  expect(tab(t.previewDetail).getAttribute('aria-selected')).toBe('false')
  expect(dialog().querySelector('.detail-panel')).toBeNull()
  const card = dialog().querySelector('.work-card')!
  expect(card.querySelector('h2')?.textContent).toBe(fields.title)
  expect(card.querySelector('h2 a')).toBeNull()
  expect(card.querySelector('.work-description')?.textContent).toBe(fields.summary)
  expect(card.querySelector('.work-tags li')?.textContent).toBe(fields.tags[0])
  expect(card.querySelector('.thumbnail')).not.toBeNull()
  expect(card.querySelector('.work-meta a')).toBeNull()
  act(() => tab(t.previewDetail).click())
  expect(dialog().querySelector('.detail-heading h1')?.textContent).toBe(fields.title)
  expect(dialog().querySelector('.work-card')).toBeNull()
})

it('switches and focuses tabs using the keyboard', () => {
  setup()
  const detailTab = tab(t.previewDetail)
  const cardTab = tab(t.previewCard)
  detailTab.focus()
  act(() => { detailTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })) })
  expect(cardTab.getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(cardTab)
  act(() => { cardTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })) })
  expect(detailTab.getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(detailTab)
})

it('uses the interface language translation in the same way as the published views', () => {
  setup({ ...fields, lang: 'ja', title: '電車', translations: { en: { title: 'Translated title', summary: 'Translated summary', description: '' } } })
  expect(dialog().querySelector('.detail-heading h1')?.textContent).toBe('Translated title')
  expect(dialog().querySelector('.lead')?.textContent).toBe('Translated summary')
  act(() => tab(t.previewCard).click())
  expect(dialog().querySelector('.work-card h2')?.textContent).toBe('Translated title')
})

it('keeps valid external links but never tracks previews, even if a callback is supplied', () => {
  const onOpen = vi.fn()
  const draft = { ...fields, url: 'https://example.com/play', repoUrl: 'https://example.com/repo' }
  const data = { fields: draft, updatedAt, authorDid, authorName, preview: true }
  act(() => render(<><ProjectDetailBody {...data} onOpenProject={onOpen} />
    <ProjectCardView {...data} projectId="draft" onOpen={onOpen} /></>, host))
  const links = [...host.querySelectorAll<HTMLAnchorElement>('a.button')]
  expect(links.map(link => link.getAttribute('href'))).toEqual([draft.url, draft.repoUrl, draft.url, draft.repoUrl])
  expect(links.every(link => link.target === '_blank')).toBe(true)
  expect(host.querySelector('.card-title')).toBeNull()
  // Let link handlers run first, without actually navigating to the test URLs.
  host.addEventListener('click', event => event.preventDefault())
  act(() => {
    for (const link of links) link.click()
  })
  expect(onOpen).not.toHaveBeenCalled()
})

it('closes with the close button and restores focus to the opener', () => {
  const onClose = setup()
  expect(document.activeElement).toBe(closeButton())
  act(() => closeButton().click())
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(dialog().open).toBe(false)
  expect(document.activeElement).toBe(opener)
})

it('closes on the native Escape cancel event and restores focus', () => {
  const onClose = setup()
  const cancel = new Event('cancel', { cancelable: true })
  act(() => { dialog().dispatchEvent(cancel) })
  expect(cancel.defaultPrevented).toBe(true)
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(dialog().open).toBe(false)
  expect(document.activeElement).toBe(opener)
})

it('closes on a backdrop press, but not a click or drag originating in the panel', () => {
  const onClose = setup()
  const panel = dialog().querySelector<HTMLElement>('.project-dialog-panel')!
  const press = (target: HTMLElement) => target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  act(() => {
    press(panel)
    panel.click()
    press(panel)
    dialog().click()
  })
  expect(dialog().open).toBe(true)
  expect(onClose).not.toHaveBeenCalled()
  act(() => {
    press(dialog())
    dialog().click()
  })
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(dialog().open).toBe(false)
})
