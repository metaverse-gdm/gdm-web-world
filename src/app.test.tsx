import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './app'
import { createDidIdentity } from './crypto/didIdentity'
import { createLocalPreferences } from './lib/localPreferences'
import { createRuntime } from './lib/runtime'
import type { Runtime } from './lib/runtime'
import { createStatsStore } from './lib/statsStore'
import type { ProjectRecord, Role } from './lib/wires'
import { reducedMotionQuery } from './styles/motion'
import { PROJECT_ID, upsert } from './test/fixtures'

vi.mock('./lib/runtime', () => ({ createRuntime: vi.fn() }))

const detailHash = `#/p/${PROJECT_ID}`
let host: HTMLDivElement
let project: ProjectRecord
let projects: ReadonlyMap<string, ProjectRecord>
const dialog = () => host.querySelector<HTMLDialogElement>('.project-dialog')!
const card = () => host.querySelector<HTMLAnchorElement>('.card-title')!
const filters = () => host.querySelector<HTMLElement>('.filters')!

beforeEach(async () => {
  const matchMedia = window.matchMedia.bind(window)
  vi.spyOn(window, 'matchMedia').mockImplementation(query => {
    const media = matchMedia(query)
    if (query === reducedMotionQuery) vi.spyOn(media, 'matches', 'get').mockReturnValue(true)
    return media
  })
  localStorage.setItem('gdm-world:language', 'en')
  history.replaceState(null, '', '#/')
  host = document.body.appendChild(document.createElement('div'))
  project = await upsert(await createDidIdentity(), { title: 'Train timetable', thumbnailUrl: 'https://example.com/train.png' })
  projects = new Map([[PROJECT_ID, project]])
})

afterEach(() => {
  act(() => render(null, host))
  host.remove()
  localStorage.clear()
  vi.restoreAllMocks()
})

async function setup(viewer: 'author' | 'admin' | 'member' | 'public' = 'public') {
  let refresh: () => void
  const deleteProject = vi.fn(async () => {
    projects = new Map()
    refresh()
  })
  const id = viewer === 'author' ? project.fromId : (await createDidIdentity()).did
  const roles = new Map<string, Role>(viewer === 'public' ? [] : [[id, viewer === 'admin' ? 'admin' : 'member']])
  const trackProject = vi.fn()
  const getProjectStats = vi.fn(() => createStatsStore().summary(PROJECT_ID, project.fromId))
  vi.mocked(createRuntime).mockResolvedValue({
    getSelf: () => ({ id }),
    getCatalog: () => ({ projects, roles }),
    getNetwork: () => ({ status: 'joined', peers: 0 }),
    displayNameFor: () => undefined,
    subscribe(listener: () => void) {
      refresh = listener
      return () => {}
    },
    dispose: () => {},
    preferences: createLocalPreferences(),
    deleteProject,
    trackProject,
    getProjectStats,
  } as unknown as Runtime)
  await act(async () => render(<App />, host))
  return {
    deleteProject,
    trackProject,
    getProjectStats,
    setProjects(next: ReadonlyMap<string, ProjectRecord>) {
      projects = next
      act(() => refresh())
    },
  }
}

function press(target: HTMLElement) {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
}

it('opens the dialog over the existing catalog and returns to the card on backdrop dismissal', async () => {
  await setup()
  const scrollTo = vi.spyOn(window, 'scrollTo')
  window.scrollTo(0, 320)
  scrollTo.mockClear()
  const focusMain = vi.spyOn(host.querySelector('main')!, 'focus')
  const back = vi.spyOn(history, 'back')
  const search = filters().querySelector('input')!
  act(() => {
    search.value = 'train'
    search.dispatchEvent(new InputEvent('input', { bubbles: true }))
  })
  const opener = card()
  act(() => opener.click())

  expect(location.hash).toBe(detailHash)
  expect(dialog().open).toBe(true)
  expect(dialog().querySelector('h1')!.id).toBe(dialog().getAttribute('aria-labelledby'))
  expect(dialog().querySelector('h1')!.textContent).toBe(project.title)
  expect(dialog().querySelector('.back-link')).toBeNull()
  expect(card()).toBe(opener)
  expect(filters().querySelector('input')).toBe(search)
  expect(search.value).toBe('train')

  dialog().querySelector<HTMLButtonElement>('[aria-label="Close"]')!.focus()
  await act(async () => {
    press(dialog())
    dialog().click()
  })
  await vi.waitFor(() => expect(dialog()).toBeNull())
  expect(back).toHaveBeenCalledTimes(1)
  expect(location.hash).toBe('#/')
  expect(card()).toBe(opener)
  expect(document.activeElement).toBe(opener)
  expect(search.value).toBe('train')
  expect(window.scrollY).toBe(320)
  expect(scrollTo).not.toHaveBeenCalled()
  expect(focusMain).not.toHaveBeenCalled()
})

it('ignores panel clicks and drags from the panel onto the backdrop', async () => {
  history.replaceState(null, '', detailHash)
  await setup()
  const panel = dialog().querySelector<HTMLElement>('.project-dialog-panel')!
  await act(async () => {
    press(panel)
    panel.click()
    press(panel)
    dialog().click()
  })
  expect(dialog().open).toBe(true)
  expect(location.hash).toBe(detailHash)
})

it('handles Escape on a deep link and keeps the dialog open until its exit animation finishes', async () => {
  history.replaceState(null, '', detailHash)
  await setup()
  const modal = dialog()
  let finish!: () => void
  const finished = new Promise<void>(resolve => { finish = resolve })
  Object.defineProperty(modal, 'getAnimations', { value: () => [{ finished }] })
  const historyLength = history.length
  const back = vi.spyOn(history, 'back')
  const cancel = new Event('cancel', { cancelable: true })
  act(() => { modal.dispatchEvent(cancel) })

  expect(cancel.defaultPrevented).toBe(true)
  expect(location.hash).toBe('#/')
  expect(history.length).toBe(historyLength)
  expect(back).not.toHaveBeenCalled()
  expect(modal.open).toBe(true)
  expect(modal.dataset.leaving).toBe('true')

  await act(async () => finish())
  await vi.waitFor(() => expect(dialog()).toBeNull())
  expect(modal.open).toBe(false)
})

it('updates a missing deep-linked project when it arrives and closes with the icon', async () => {
  history.replaceState(null, '', detailHash)
  projects = new Map()
  const { setProjects, trackProject } = await setup()
  const modal = dialog()
  expect(document.getElementById(modal.getAttribute('aria-labelledby')!)?.textContent).toBe('Project not found.')
  expect(filters()).toBeTruthy()
  expect(trackProject).not.toHaveBeenCalled()

  setProjects(new Map([[PROJECT_ID, project]]))
  expect(dialog()).toBe(modal)
  expect(modal.querySelector('h1')?.textContent).toBe(project.title)
  expect(card().textContent).toBe(project.title)
  expect(trackProject).toHaveBeenCalledExactlyOnceWith(PROJECT_ID, 'detail')

  await act(async () => modal.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click())
  await vi.waitFor(() => expect(dialog()).toBeNull())
  expect(location.hash).toBe('#/')
})

it('closes to the catalog after a successful delete', async () => {
  const { deleteProject } = await setup('author')
  act(() => card().click())
  act(() => dialog().querySelector<HTMLButtonElement>('[aria-label="Delete"]')!.click())
  const confirm = dialog().querySelector<HTMLDialogElement>('.confirm-dialog')!
  expect(confirm.open).toBe(true)
  await act(async () => confirm.close('confirm'))
  await vi.waitFor(() => expect(dialog()).toBeNull())
  expect(deleteProject).toHaveBeenCalledExactlyOnceWith(PROJECT_ID)
  expect(location.hash).toBe('#/')
  expect(card()).toBeNull()
})

it('navigates to the full-page edit form from the dialog', async () => {
  await setup('author')
  act(() => card().click())
  const scrollTo = vi.spyOn(window, 'scrollTo')
  act(() => dialog().querySelector<HTMLAnchorElement>('[aria-label="Edit"]')!.click())
  await vi.waitFor(() => expect(host.querySelector('main form')).toBeTruthy())
  expect(location.hash).toBe(`#/edit/${PROJECT_ID}`)
  expect(dialog()).toBeNull()
  expect(filters()).toBeNull()
  expect(document.activeElement).toBe(host.querySelector('main'))
  expect(scrollTo).toHaveBeenCalledWith(0, 0)
})

it.each(['author', 'admin', 'member', 'public'] as const)('gates dialog stats for %s viewers', async viewer => {
  history.replaceState(null, '', detailHash)
  const { getProjectStats } = await setup(viewer)
  const stats = dialog().querySelector('[aria-label="Project engagement"]')
  if (viewer === 'author' || viewer === 'admin') {
    expect(getProjectStats).toHaveBeenCalledWith(PROJECT_ID)
    expect(stats?.querySelector('[aria-label="Last 7 days"]')?.textContent).toBe('7d')
    expect(stats?.querySelector('[aria-label="Last 30 days"]')?.textContent).toBe('30d')
    expect(stats?.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(stats?.querySelectorAll('svg rect')).toHaveLength(30)
  } else {
    expect(getProjectStats).not.toHaveBeenCalled()
    expect(stats).toBeNull()
  }
})

it('tracks primary-link activation from both the catalog and dialog', async () => {
  const { trackProject } = await setup()
  const cardLink = host.querySelector<HTMLAnchorElement>('.work-actions a')!
  act(() => cardLink.click())
  act(() => card().click())
  const detailLink = dialog().querySelector<HTMLAnchorElement>('a.primary')!
  act(() => { detailLink.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 })) })
  expect(trackProject.mock.calls).toEqual([[PROJECT_ID, 'click'], [PROJECT_ID, 'detail'], [PROJECT_ID, 'click']])
})
