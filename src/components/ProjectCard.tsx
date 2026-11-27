import { useContext } from 'preact/hooks'
import { documentLanguages, LanguageContext, useMessages } from '../i18n'
import { openProjectFromCatalog } from '../hooks/useHashRoute'
import { localizedProject } from '../lib/localizedProject'
import { personId } from '../lib/wires'
import type { GroupView } from '../lib/catalogStore'
import type { ProjectRecord } from '../lib/wires'
import { AuthorLink, DateText, ExternalLink, Tags } from './common'
import { GroupLink } from './Groups'
import { Thumbnail } from './Thumbnail'

export function ProjectCard({ project, displayNameFor, group, onOpen }: {
  project: ProjectRecord; displayNameFor(did: string): string | undefined; group?: GroupView; onOpen(): void
}) {
  const t = useMessages()
  const { title, summary, lang } = localizedProject(project, useContext(LanguageContext))
  const locale = lang && documentLanguages[lang]
  const author = personId(project)
  const titleId = `project-title-${project.projectId}`
  return <article class="work-card work-card--games" aria-labelledby={titleId}>
    <div class="work-visual"><Thumbnail cid={project.thumbnailCid} url={project.thumbnailUrl} projectUrl={project.url} title={title} decorative /></div>
    <div class="work-content">
      <h2 id={titleId} lang={locale}><a class="card-title" href={`#/p/${project.projectId}`} onClick={event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        event.currentTarget.focus({ preventScroll: true })
        openProjectFromCatalog(project.projectId)
      }}>{title}</a></h2>
      <p class="work-meta">
        <DateText at={project.updatedAt} dateOnly /><span aria-hidden="true"> · </span>
        <span class="sr-only">{t.author} </span>
        <AuthorLink did={author} name={displayNameFor(author)} />
        {group && <><span aria-hidden="true"> · </span><span class="sr-only">{t.group} </span><GroupLink group={group} /></>}
      </p>
      <Tags tags={project.tags} />
      <p class="work-description" lang={locale}>{summary}</p>
      {(project.url || project.repoUrl) && <div class="work-actions">
        {project.url && <ExternalLink href={project.url} primary onOpen={onOpen}>{t.open}</ExternalLink>}
        {project.repoUrl && <ExternalLink href={project.repoUrl} primary={!project.url}>{t.repository}</ExternalLink>}
      </div>}
    </div>
  </article>
}
