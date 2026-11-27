import { useId, useMemo, useState } from 'preact/hooks'
import { useAction } from '../hooks/useAction'
import { useMessages } from '../i18n'
import type { Runtime } from '../lib/runtime'
import { LIMITS, personId } from '../lib/wires'
import { CatalogPage } from './Catalog'
import { BackLink, CopyDid, ErrorText } from './common'
import { GroupLink } from './Groups'
import { Icon } from './Icon'
import { MarkdownView } from './MarkdownView'

function ProfileEditor({ runtime, name, bio, onDone }: { runtime: Runtime; name?: string; bio?: string; onDone(): void }) {
  const t = useMessages()
  const action = useAction()
  const hint = useId()
  return <form class="form-stack profile-editor" onSubmit={event => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void action.run(async () => {
      await runtime.saveProfile({ displayName: String(data.get('displayName') ?? ''), bio: String(data.get('bio') ?? '') })
      onDone()
    })
  }}>
    <label>{t.displayName}
      <input name="displayName" required maxLength={LIMITS.displayName} defaultValue={name ?? ''} disabled={action.busy} autoFocus />
    </label>
    <label>{t.bio}
      <textarea name="bio" rows={6} maxLength={LIMITS.bio} defaultValue={bio ?? ''} disabled={action.busy} aria-describedby={hint} />
      <span id={hint} class="muted">{t.bioHint}</span>
    </label>
    <ErrorText message={action.error} />
    <div class="actions">
      <button type="button" disabled={action.busy} onClick={onDone}>{t.cancel}</button>
      <button class="primary" disabled={action.busy}>{t.saveProfile}</button>
    </div>
  </form>
}

export function PersonPage({ did, runtime, impressionsActive }: { did: string; runtime: Runtime; impressionsActive: boolean }) {
  const t = useMessages()
  const headingId = useId()
  const [editing, setEditing] = useState(false)
  const catalog = runtime.getCatalog()
  const self = runtime.getSelf()
  const projects = useMemo(() => new Map([...catalog.projects].filter(([, project]) => personId(project) === did)), [catalog.projects, did])
  const name = runtime.displayNameFor(did)
  const bio = runtime.bioFor(did)
  const own = self.id === did
  const canEdit = own && !!catalog.roles.get(did)
  const groups = [...catalog.groups.values()].filter(group => group.members.includes(did))
  const invitations = own ? [...catalog.groups.values()].filter(group => group.invited.includes(did)) : []
  const delegated = own ? !!self.delegation : [...projects.values()].some(project => project.fromId !== did)

  return <>
    <section class="person-profile" aria-labelledby={headingId}>
      <BackLink label={t.allProjects} />
      <div class="panel profile-panel">
        <div class="row-between detail-heading">
          <h1 id={headingId} data-unnamed={!name || undefined}>{name ?? t.unnamedPerson}</h1>
          {canEdit && !editing && <button type="button" class="icon-button" aria-label={t.editProfile} data-tooltip={t.editProfile}
            onClick={() => setEditing(true)}><Icon name="edit" /></button>}
        </div>
        <CopyDid did={did} delegated={delegated} />
        {editing
          ? <ProfileEditor runtime={runtime} name={name} bio={bio} onDone={() => setEditing(false)} />
          : bio
            ? <div class="description profile-bio"><MarkdownView text={bio} /></div>
            : own && <p class="muted">{canEdit ? t.bioEmpty : t.profileNeedsMember}</p>}
        {(groups.length > 0 || invitations.length > 0) && <div class="person-groups">
          {groups.length > 0 && <><h2 class="profile-subheading">{t.groups.mine}</h2>
            <ul class="group-chips">{groups.map(group => <li key={group.record.groupId}><GroupLink group={group} /></li>)}</ul></>}
          {invitations.length > 0 && <><h2 class="profile-subheading">{t.groups.invitations}</h2>
            <ul class="group-chips">{invitations.map(group => <li key={group.record.groupId}><GroupLink group={group} /></li>)}</ul></>}
        </div>}
      </div>
      <h2 class="person-projects-heading">{t.personProjects}<span class="muted">{projects.size}</span></h2>
    </section>
    <CatalogPage projects={projects} displayNameFor={runtime.displayNameFor} groupFor={runtime.groupFor} trackProject={runtime.trackProject}
      impressionsActive={impressionsActive} label={t.personProjects} emptyMessage={t.noPersonProjects} />
  </>
}
