import { useContext, useId, useMemo, useState } from 'preact/hooks'
import { groupHref } from '../hooks/useHashRoute'
import { useAction } from '../hooks/useAction'
import { documentLanguages, LanguageContext, useMessages } from '../i18n'
import type { Catalog, GroupView } from '../lib/catalogStore'
import { projectGroup } from '../lib/catalogStore'
import type { Runtime } from '../lib/runtime'
import { compareStrings } from '../lib/wireSign'
import { LIMITS } from '../lib/wires'
import { CatalogPage } from './Catalog'
import { AuthorLink, BackLink, ConfirmDialog, EmptyState, ErrorText } from './common'
import { Icon } from './Icon'
import { MarkdownView } from './MarkdownView'

export function GroupLink({ group, link = true }: { group: GroupView; link?: boolean }) {
  const t = useMessages()
  const Element = link ? 'a' : 'span'
  return <Element class="group-link" href={link ? groupHref(group.record.groupId) : undefined}
    aria-label={link ? t.groups.view(group.record.name) : undefined}>
    <Icon name="users" /><bdi>{group.record.name}</bdi>
  </Element>
}

function groupProjects(catalog: Catalog, groupId: string) {
  return new Map([...catalog.projects].filter(([, project]) => projectGroup(catalog, project)?.record.groupId === groupId))
}

/** Join, decline or leave controls for the viewer's own place in a group. */
function MembershipActions({ runtime, group }: { runtime: Runtime; group: GroupView }) {
  const t = useMessages()
  const action = useAction()
  const [opener, setOpener] = useState<HTMLButtonElement>()
  const self = runtime.getSelf().id
  const id = group.record.groupId
  const invited = group.invited.includes(self)
  const declined = group.declined.includes(self)
  const member = group.owner !== self && group.members.includes(self)
  if (!invited && !declined && !member) return null
  const set = (joined: boolean) => void action.run(() => runtime.setGroupMembership(id, joined))
  return <div class="membership-actions">
    {invited && <p>{t.groups.invitation}</p>}
    <div class="actions">
      {(invited || declined) && <button type="button" class="primary" disabled={action.busy} onClick={() => set(true)}>{t.groups.join}</button>}
      {invited && <button type="button" disabled={action.busy} onClick={() => set(false)}>{t.groups.decline}</button>}
      {member && <button type="button" disabled={action.busy} onClick={event => setOpener(event.currentTarget)}>{t.groups.leave}</button>}
    </div>
    <ErrorText message={action.error} />
    {opener && <ConfirmDialog message={t.groups.confirmLeave} confirm={t.groups.leave} opener={opener} onClose={accepted => {
      setOpener(undefined)
      if (accepted) set(false)
    }} />}
  </div>
}

function sortGroups(groups: Iterable<GroupView>) {
  return [...groups].sort((a, b) => b.record.updatedAt - a.record.updatedAt || compareStrings(a.record.groupId, b.record.groupId))
}

export function GroupsPage({ runtime }: { runtime: Runtime }) {
  const t = useMessages()
  const headingId = useId()
  const catalog = runtime.getCatalog()
  const self = runtime.getSelf().id
  const groups = useMemo(() => sortGroups(catalog.groups.values()), [catalog.groups])
  const invitations = groups.filter(group => group.invited.includes(self))
  return <section class="screen-stack groups-page" aria-labelledby={headingId}>
    <h1 id={headingId} class="sr-only">{t.groups.title}</h1>
    <div class="row-between">
      <BackLink />
      {catalog.roles.get(self) && <a class="button primary" href="#/g/new"><Icon name="plus" />{t.groups.create}</a>}
    </div>
    {invitations.length > 0 && <section class="panel invitations" aria-label={t.groups.invitations}>
      <h2>{t.groups.invitations}</h2>
      <ul class="invitation-list">
        {invitations.map(group => <li key={group.record.groupId}>
          <GroupLink group={group} /><MembershipActions runtime={runtime} group={group} />
        </li>)}
      </ul>
    </section>}
    {groups.length
      ? <ul class="group-grid" aria-label={t.groups.title}>
          {groups.map(group => <li key={group.record.groupId}><GroupCard runtime={runtime} group={group} /></li>)}
        </ul>
      : <EmptyState message={t.groups.empty} />}
  </section>
}

function GroupCard({ runtime, group }: { runtime: Runtime; group: GroupView }) {
  const t = useMessages()
  const titleId = useId()
  const projects = groupProjects(runtime.getCatalog(), group.record.groupId).size
  return <article class="group-card" aria-labelledby={titleId}>
    <h2 id={titleId}><a class="card-title" href={groupHref(group.record.groupId)}>{group.record.name}</a></h2>
    <p class="work-meta">
      <span>{t.groups.count(group.members.length, projects)}</span><span aria-hidden="true"> · </span>
      <span class="sr-only">{t.groups.owner} </span>
      <AuthorLink did={group.owner} name={runtime.displayNameFor(group.owner)} />
    </p>
    {group.record.bio && <div class="group-card-bio"><MarkdownView text={group.record.bio} /></div>}
  </article>
}

function MemberList({ runtime, group }: { runtime: Runtime; group: GroupView }) {
  const t = useMessages()
  const self = runtime.getSelf().id
  const owner = group.owner === self
  // Pending answers are shown only to the owner and to the person concerned.
  const pending = [
    ...group.invited.filter(did => owner || did === self).map(did => [did, t.groups.invited] as const),
    ...group.declined.filter(did => owner || did === self).map(did => [did, t.groups.declined] as const),
  ]
  return <ul class="member-list" aria-label={t.groups.members}>
    {group.members.map(did => <li key={did}>
      <AuthorLink did={did} name={runtime.displayNameFor(did)} />
      {did === group.owner && <span class="member-badge">{t.groups.owner}</span>}
    </li>)}
    {pending.map(([did, label]) => <li key={did} data-pending>
      <AuthorLink did={did} name={runtime.displayNameFor(did)} /><span class="member-badge member-badge--muted">{label}</span>
    </li>)}
  </ul>
}

export function GroupPage({ groupId, runtime, impressionsActive }: { groupId: string; runtime: Runtime; impressionsActive: boolean }) {
  const t = useMessages()
  const headingId = useId()
  const action = useAction()
  const [opener, setOpener] = useState<HTMLButtonElement>()
  const catalog = runtime.getCatalog()
  const group = catalog.groups.get(groupId)
  const projects = useMemo(() => groupProjects(catalog, groupId), [catalog, groupId])
  if (!group) return <EmptyState message={t.missingGroup}><BackLink href="#/groups" label={t.groups.all} /></EmptyState>
  const self = runtime.getSelf().id
  const owner = group.owner === self && !!catalog.roles.get(self)
  const remove = owner || catalog.roles.get(self) === 'admin'
  return <>
    <section class="person-profile" aria-labelledby={headingId}>
      <BackLink href="#/groups" label={t.groups.all} />
      <div class="panel profile-panel">
        <div class="row-between detail-heading">
          <h1 id={headingId}><Icon name="users" /><bdi>{group.record.name}</bdi></h1>
          {(owner || remove) && <div class="actions">
            {owner && <a class="icon-button" href={`${groupHref(groupId)}/edit`} aria-label={t.groups.edit} data-tooltip={t.groups.edit}><Icon name="edit" /></a>}
            {remove && <button type="button" class="icon-button danger" aria-label={t.groups.remove} data-tooltip={t.groups.remove}
              disabled={action.busy} onClick={event => setOpener(event.currentTarget)}><Icon name="trash" /></button>}
          </div>}
        </div>
        {group.record.bio && <div class="description profile-bio"><MarkdownView text={group.record.bio} /></div>}
        <h2 class="profile-subheading">{t.groups.members}<span class="muted">{group.members.length}</span></h2>
        <MemberList runtime={runtime} group={group} />
        <MembershipActions runtime={runtime} group={group} />
        <ErrorText message={action.error} />
      </div>
      <h2 class="person-projects-heading">{t.groups.projects}<span class="muted">{projects.size}</span></h2>
      {group.members.includes(self) && <p class="muted">{t.groups.projectsHint}</p>}
    </section>
    <CatalogPage projects={projects} displayNameFor={runtime.displayNameFor} groupFor={runtime.groupFor} trackProject={runtime.trackProject}
      impressionsActive={impressionsActive} label={t.groups.projects} emptyMessage={t.groups.noProjects} />
    {opener && <ConfirmDialog message={t.groups.confirmRemove} confirm={t.groups.remove} opener={opener} onClose={accepted => {
      setOpener(undefined)
      if (accepted) void action.run(async () => {
        await runtime.deleteGroup(groupId)
        location.hash = '#/groups'
      })
    }} />}
  </>
}

export function GroupForm({ runtime, group }: { runtime: Runtime; group?: GroupView }) {
  const t = useMessages()
  const locale = documentLanguages[useContext(LanguageContext)]
  const action = useAction()
  const ids = useId()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => new Set(group?.record.members ?? []))
  const catalog = runtime.getCatalog()
  const self = runtime.getSelf().id
  const people = useMemo(() => [...catalog.roles]
    .filter(([did, role]) => role && did !== self)
    .map(([did]) => ({ did, name: runtime.displayNameFor(did) }))
    .sort((a, b) => (a.name ?? '￿').localeCompare(b.name ?? '￿', locale) || compareStrings(a.did, b.did)),
  [catalog.roles, self, runtime, locale])
  const text = query.trim().toLocaleLowerCase(locale)
  const shown = people.filter(({ did, name }) => !text || did.toLowerCase().includes(text) || name?.toLocaleLowerCase(locale).includes(text))
  // Keep invitees who lost their role in the signed list so they reappear if approved again.
  const members = [...selected]
  const full = members.length >= LIMITS.groupMembers
  const status = (did: string) => group?.members.includes(did) ? undefined
    : group?.invited.includes(did) ? t.groups.invited : group?.declined.includes(did) ? t.groups.declined : undefined
  return <section class="screen-stack content-width" aria-labelledby={`${ids}-title`}>
    <BackLink href={group ? groupHref(group.record.groupId) : '#/groups'} />
    <form class="panel form-stack group-form" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      void action.run(async () => {
        const id = await runtime.saveGroup({
          name: String(data.get('name') ?? ''), bio: String(data.get('bio') ?? ''), members,
        }, group?.record.groupId)
        location.hash = groupHref(id)
      })
    }}>
      <h1 id={`${ids}-title`}>{group ? t.groups.edit : t.groups.create}</h1>
      <fieldset class="form-stack" disabled={action.busy}>
        <label>{t.groups.name}
          <input name="name" required maxLength={LIMITS.groupName} defaultValue={group?.record.name ?? ''} autoFocus />
        </label>
        <label>{t.groups.bio}
          <textarea name="bio" rows={6} maxLength={LIMITS.bio} defaultValue={group?.record.bio ?? ''} aria-describedby={`${ids}-bio`} />
          <span id={`${ids}-bio`} class="muted">{t.groups.bioHint}</span>
        </label>
        <fieldset class="member-picker" aria-describedby={`${ids}-invite`}>
          <legend>{t.groups.invite}<span class="muted">{members.length} / {LIMITS.groupMembers}</span></legend>
          <span id={`${ids}-invite`} class="muted">{t.groups.inviteHint(LIMITS.groupMembers)}</span>
          <div class="search-field">
            <Icon name="search" />
            <input type="search" aria-label={t.groups.searchPeople} placeholder={t.groups.searchPeople} value={query}
              onInput={event => setQuery(event.currentTarget.value)} />
          </div>
          {shown.length
            ? <ul class="member-options">
                {shown.map(({ did, name }) => {
                  const checked = selected.has(did)
                  const note = status(did)
                  return <li key={did}><label class="check-row">
                    <input type="checkbox" checked={checked} disabled={!checked && full} onChange={event => {
                      const next = new Set(selected)
                      if (event.currentTarget.checked) next.add(did)
                      else next.delete(did)
                      setSelected(next)
                    }} />
                    <span class="member-option-name">{name
                      ? <bdi>{name}</bdi>
                      : <code>{did.slice(0, 15)}…{did.slice(-6)}</code>}</span>
                    {note && <span class="member-badge member-badge--muted">{note}</span>}
                  </label></li>
                })}
              </ul>
            : <p class="muted">{t.groups.noPeople}</p>}
        </fieldset>
        <ErrorText message={action.error} />
        <div class="actions">
          <button type="submit" class="primary">{group ? t.saveProfile : t.groups.create}</button>
        </div>
      </fieldset>
    </form>
  </section>
}
