import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './app'
import { createDidIdentity } from './crypto/didIdentity'
import { createLocalPreferences } from './lib/localPreferences'
import { createRuntime } from './lib/runtime'
import type { Runtime } from './lib/runtime'
import { createStatsStore } from './lib/statsStore'
import * as thumbnails from './lib/thumbnails'
import { tagHref } from './hooks/useHashRoute'
import { projectGroup } from './lib/catalogStore'
import type { GroupView } from './lib/catalogStore'
import type { GroupRecord, ProjectRecord, Role } from './lib/wires'
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

async function setup(viewer: 'author' | 'admin' | 'member' | 'public' = 'public',
  groupsFor: (self: string) => Map<string, GroupView> = () => new Map(), avatarCid?: string) {
  let refresh: () => void
  const deleteProject = vi.fn(async () => {
    projects = new Map()
    refresh()
  })
  const id = viewer === 'author' ? project.fromId : (await createDidIdentity()).did
  const roles = new Map<string, Role>(viewer === 'public' ? [] : [[id, viewer === 'admin' ? 'admin' : 'member']])
  const trackProject = vi.fn()
  const getProjectStats = vi.fn(() => createStatsStore().summary(PROJECT_ID, project.fromId))
  const saveProfile = vi.fn(async () => {})
  const saveGroup = vi.fn(async () => GROUP_ID)
  const setGroupMembership = vi.fn(async () => {})
  const groups = groupsFor(id)
  vi.mocked(createRuntime).mockResolvedValue({
    getSelf: () => ({ id }),
    getCatalog: () => ({ projects, roles, groups }),
    groupFor: (record: ProjectRecord) => projectGroup({ groups }, record),
    setGroupMembership,
    getNetwork: () => ({ status: 'joined', peers: 0 }),
    displayNameFor: (did: string) => did === project.fromId ? 'Team Sakura' : undefined,
    bioFor: (did: string) => did === project.fromId ? 'We make **games**.' : undefined,
    avatarFor: (did: string) => did === project.fromId ? avatarCid : undefined,
    saveProfile,
    saveGroup,
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
    saveProfile,
    saveGroup,
    setGroupMembership,
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

it('opens the author page from a card and keeps it behind a project opened there', async () => {
  await setup()
  const author = host.querySelector<HTMLAnchorElement>('.work-meta .author-link')!
  expect(author.textContent).toBe('Team Sakura')
  expect(author.getAttribute('href')).toBe(`#/u/${project.fromId}`)
  await act(async () => {
    location.hash = author.getAttribute('href')!
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  const profile = host.querySelector<HTMLElement>('.profile-panel')!
  expect(profile.querySelector('h1')!.textContent).toBe('Team Sakura')
  expect(profile.querySelector('.profile-bio strong')!.textContent).toBe('games')
  expect(profile.querySelector('[aria-label="Edit profile"]')).toBeNull()
  expect(host.querySelectorAll('.work-grid > li')).toHaveLength(1)

  const opener = card()
  act(() => opener.click())
  expect(location.hash).toBe(detailHash)
  expect(dialog().open).toBe(true)
  expect(host.querySelector('.profile-panel')).toBe(profile)
  expect(card()).toBe(opener)
})

it('lets an approved author edit their profile on their own page', async () => {
  history.replaceState(null, '', `#/u/${project.fromId}`)
  const { saveProfile } = await setup('author')
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit profile"]')!.click())
  const form = host.querySelector<HTMLFormElement>('.profile-editor')!
  form.querySelector('textarea')!.value = 'Hello'
  await act(async () => { form.requestSubmit() })
  expect(saveProfile).toHaveBeenCalledWith({ displayName: 'Team Sakura', bio: 'Hello' })
  expect(host.querySelector('.profile-editor')).toBeNull()
})

it('uploads a profile image with the gallery uploader and includes it when saving', async () => {
  history.replaceState(null, '', `#/u/${project.fromId}`)
  const cid = 'A'.repeat(32)
  const upload = vi.spyOn(thumbnails, 'saveMediaImage').mockResolvedValue(cid)
  vi.spyOn(thumbnails, 'loadMediaImage').mockResolvedValue('blob:avatar')
  const { saveProfile } = await setup('author')
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit profile"]')!.click())
  const form = host.querySelector<HTMLFormElement>('.profile-editor')!
  const picker = form.querySelector<HTMLInputElement>('input[type="file"]')!
  const file = new File(['image'], 'avatar.png', { type: 'image/png' })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  picker.files = transfer.files
  await act(async () => { picker.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(upload).toHaveBeenCalledExactlyOnceWith(file)
  await vi.waitFor(() => expect(form.querySelector('.avatar-editor img')?.getAttribute('src')).toBe('blob:avatar'))
  await act(async () => form.requestSubmit())
  expect(saveProfile).toHaveBeenCalledWith({ displayName: 'Team Sakura', bio: 'We make **games**.', avatarCid: cid })
})

it('displays and removes an existing profile image', async () => {
  history.replaceState(null, '', `#/u/${project.fromId}`)
  const cid = 'A'.repeat(32)
  vi.spyOn(thumbnails, 'loadMediaImage').mockResolvedValue('blob:avatar')
  const { saveProfile } = await setup('author', undefined, cid)
  await vi.waitFor(() => expect(host.querySelector('.profile-panel h1 .avatar img')).not.toBeNull())
  expect(host.querySelector('.app-controls .avatar img')).not.toBeNull()
  expect(host.querySelector('.work-meta .avatar img')).not.toBeNull()
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit profile"]')!.click())
  const form = host.querySelector<HTMLFormElement>('.profile-editor')!
  act(() => [...form.querySelectorAll('button')].find(button => button.textContent === 'Remove image')!.click())
  expect(form.querySelector('.avatar-editor .avatar svg')).not.toBeNull()
  await act(async () => form.requestSubmit())
  expect(saveProfile).toHaveBeenCalledWith({ displayName: 'Team Sakura', bio: 'We make **games**.', avatarCid: null })
})

it('opens a tag page from a card, shows exact and related games, and preserves it behind the project dialog', async () => {
  const identity = await createDidIdentity()
  const tag = 'RPG / 日本語'
  const thumbnailUrl = 'https://example.com/cover.png'
  project = await upsert(identity, { title: 'Main game', tags: [tag, 'story'], thumbnailUrl })
  const related = await upsert(identity, { projectId: '190b17ef-7ad2-43e4-b374-351e89cc5c45', title: 'Related game', tags: ['Story'], thumbnailUrl })
  const unrelated = await upsert(identity, { projectId: '190b17ef-7ad2-43e4-b374-351e89cc5c46', title: 'Unrelated game', tags: ['action'], thumbnailUrl })
  projects = new Map([project, related, unrelated].map(item => [item.projectId, item]))
  const { trackProject } = await setup()
  const link = host.querySelector<HTMLAnchorElement>(`.work-tags a[href="${tagHref(tag)}"]`)!
  expect(link.tabIndex).toBe(0)
  const bubbled = vi.fn()
  link.closest('article')!.addEventListener('click', bubbled)
  await act(async () => link.click())
  await vi.waitFor(() => expect(host.querySelector('.tag-page')).not.toBeNull())
  expect(location.hash).toBe(tagHref(tag))
  expect(bubbled).not.toHaveBeenCalled()
  expect(dialog()).toBeNull()
  expect(trackProject).not.toHaveBeenCalled()
  expect(host.querySelector('#tag-heading')?.textContent).toContain(tag)
  expect([...host.querySelectorAll('.tag-section .work-grid .card-title')].map(item => item.textContent)).toEqual(['Main game', 'Related game'])
  expect(host.querySelector('#similar-heading')?.textContent).toBe('Similar games')
  const page = host.querySelector('.tag-page')
  act(() => card().click())
  expect(dialog().open).toBe(true)
  expect(host.querySelector('.tag-page')).toBe(page)
  await act(async () => dialog().querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click())
  await vi.waitFor(() => expect(dialog()).toBeNull())
  expect(location.hash).toBe(tagHref(tag))
  expect(host.querySelector('.tag-page')).toBe(page)
  expect(document.activeElement).toBe(card())
})

it('navigates from a detail tag and closes the project dialog, hiding the empty similar section', async () => {
  history.replaceState(null, '', detailHash)
  await setup()
  const tag = project.tags[0]
  const link = dialog().querySelector<HTMLAnchorElement>('.work-tags a')!
  expect(link.getAttribute('href')).toBe(tagHref(tag))
  await act(async () => link.click())
  await vi.waitFor(() => expect(host.querySelector('.tag-page')).not.toBeNull())
  expect(location.hash).toBe(tagHref(tag))
  expect(dialog()).toBeNull()
  expect(host.querySelector('#similar-heading')).toBeNull()
  expect(host.querySelector('.tag-page .back-link')?.getAttribute('href')).toBe('#/')
})

it("shows only the chosen person's projects and an empty state for others", async () => {
  const other = (await createDidIdentity()).did
  history.replaceState(null, '', `#/u/${other}`)
  await setup()
  expect(host.querySelector('.profile-panel h1')!.textContent).toBe('No name set')
  expect(host.querySelector('.work-grid > li')).toBeNull()
  expect(host.querySelector('.empty-state')!.textContent).toBe('No public projects yet.')
})

const GROUP_ID = '7c1e3d0a-5b2f-4c8d-9e6a-1f2b3c4d5e6f'
function circle(invited: string[] = [], avatarCid?: string): Map<string, GroupView> {
  const record = { groupId: GROUP_ID, name: 'Sakura Circle', bio: 'A **game** circle.', members: invited, updatedAt: 30, avatarCid } as unknown as GroupRecord
  return new Map([[GROUP_ID, { record, owner: project.fromId, members: [project.fromId], invited, declined: [] }]])
}

it('lets a group owner clear a group avatar in the existing group editor', async () => {
  history.replaceState(null, '', `#/g/${GROUP_ID}/edit`)
  vi.spyOn(thumbnails, 'loadMediaImage').mockResolvedValue('blob:group-avatar')
  const { saveGroup } = await setup('author', () => circle([], 'A'.repeat(32)))
  const form = host.querySelector<HTMLFormElement>('.group-form')!
  await vi.waitFor(() => expect(form.querySelector('.avatar-editor img')?.getAttribute('src')).toBe('blob:group-avatar'))
  act(() => [...form.querySelectorAll('button')].find(button => button.textContent === 'Remove image')!.click())
  await act(async () => form.requestSubmit())
  expect(saveGroup).toHaveBeenCalledWith({ name: 'Sakura Circle', bio: 'A **game** circle.', members: [] }, GROUP_ID)
})

it('keeps the groups page heading accessible without displaying a redundant title', async () => {
  history.replaceState(null, '', '#/groups')
  await setup('member', () => circle())
  const page = host.querySelector('.groups-page')!
  const heading = page.querySelector('h1.sr-only')!
  expect(heading.textContent).toBe('Groups')
  expect(page.getAttribute('aria-labelledby')).toBe(heading.id)
  expect(page.querySelector('.row-between .back-link')).not.toBeNull()
  expect(page.querySelector('.row-between a[href="#/g/new"]')).not.toBeNull()
  expect(page.querySelector('.group-card h2')!.textContent).toBe('Sakura Circle')
})

it('links a grouped project to its group page and lets an invitee join from there', async () => {
  project = await upsert(await createDidIdentity(), { title: 'Train timetable', groupId: GROUP_ID })
  projects = new Map([[PROJECT_ID, project]])
  const { setGroupMembership } = await setup('member', self => circle([self]))
  const nav = host.querySelector<HTMLAnchorElement>('.nav-groups')!
  expect(nav.querySelector('.nav-dot')).not.toBeNull()
  const link = host.querySelector<HTMLAnchorElement>('.work-meta .group-link')!
  expect(link.textContent).toBe('Sakura Circle')
  await act(async () => {
    location.hash = link.getAttribute('href')!
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  const panel = host.querySelector<HTMLElement>('.profile-panel')!
  expect(panel.querySelector('h1')!.textContent).toBe('Sakura Circle')
  expect(panel.querySelector('.profile-bio strong')!.textContent).toBe('game')
  expect([...panel.querySelectorAll('.member-list > li')].map(item => item.textContent)).toEqual(['Team SakuraOwner', expect.stringContaining('Invited')])
  expect(host.querySelectorAll('.work-grid > li')).toHaveLength(1)
  const join = [...panel.querySelectorAll('button')].find(button => button.textContent === 'Join')!
  await act(async () => join.click())
  expect(setGroupMembership).toHaveBeenCalledWith(GROUP_ID, true)
})

it('hides pending invitations from other viewers and shows a missing group', async () => {
  history.replaceState(null, '', `#/g/${GROUP_ID}`)
  await setup('public', () => circle([project.fromId.replace(/.$/, 'x')]))
  expect(host.querySelectorAll('.member-list > li')).toHaveLength(1)
  expect(host.querySelector('.membership-actions')).toBeNull()
  expect(host.querySelector('.nav-dot')).toBeNull()
  await act(async () => {
    location.hash = '#/g/00000000-0000-4000-8000-000000000000'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  expect(host.querySelector('.empty-state')!.textContent).toContain('Group not found.')
})
