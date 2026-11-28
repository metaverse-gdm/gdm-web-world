import { useContext, useId } from 'preact/hooks'
import { documentLanguages, LanguageContext, useMessages } from '../i18n'
import { openProjectFromCatalog } from '../hooks/useHashRoute'
import { localizedProject } from '../lib/localizedProject'
import { coverFor } from '../lib/cover'
import { isHttpUrl, personId } from '../lib/wires'
import type { GroupView } from '../lib/catalogStore'
import type { ProjectFields, ProjectRecord } from '../lib/wires'
import { AuthorLink, DateText, ExternalLink, MistlNote, Tags } from './common'
import { isMistlSite } from '../lib/mistlSite'
import { GroupLink } from './Groups'
import { Thumbnail } from './Thumbnail'

export function ProjectCard({ project, displayNameFor, avatarFor, group, onOpen }: {
  project: ProjectRecord; displayNameFor(did: string): string | undefined; avatarFor?(did: string): string | undefined; group?: GroupView; onOpen(): void
}) {
  const author = personId(project)
  return <ProjectCardView fields={project} projectId={project.projectId} updatedAt={project.updatedAt}
    authorDid={author} authorName={displayNameFor(author)} authorAvatarCid={avatarFor?.(author)} group={group} onOpen={onOpen} />
}

export function ProjectCardView({ fields, projectId, updatedAt, authorDid, authorName, authorAvatarCid, group, onOpen, preview = false }: {
  fields: ProjectFields; projectId?: string; updatedAt: number; authorDid: string; authorName?: string; authorAvatarCid?: string; group?: GroupView
  onOpen?(): void; preview?: boolean
}) {
  const t = useMessages()
  const language = useContext(LanguageContext)
  const { title, summary, lang } = localizedProject(fields, language)
  const locale = lang && documentLanguages[lang]
  const untitled = preview && !title.trim()
  const displayTitle = untitled ? t.previewUntitled : title
  const fallbackId = useId()
  const titleId = `project-title-${projectId ?? fallbackId}`
  const url = isHttpUrl(fields.url) ? fields.url : undefined
  const repoUrl = preview && !isHttpUrl(fields.repoUrl) ? undefined : fields.repoUrl
  return <article class="work-card work-card--games" aria-labelledby={titleId}>
    <div class="work-visual"><Thumbnail {...coverFor(fields)} projectUrl={url} title={displayTitle} decorative /></div>
    <div class="work-content">
      <h2 id={titleId} lang={untitled ? documentLanguages[language] : locale}>
        {projectId && !preview ? <a class="card-title" href={`#/p/${projectId}`} onClick={event => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          openProjectFromCatalog(projectId)
        }}>{displayTitle}</a> : displayTitle}
      </h2>
      <p class="work-meta">
        <DateText at={updatedAt} dateOnly /><span aria-hidden="true"> · </span>
        <span class="sr-only">{t.author} </span>
        <AuthorLink did={authorDid} name={authorName} avatarCid={authorAvatarCid} link={!preview} />
        {group && <><span aria-hidden="true"> · </span><span class="sr-only">{t.group} </span><GroupLink group={group} link={!preview} /></>}
      </p>
      <Tags tags={fields.tags} link={!preview} />
      <p class="work-description" lang={locale}>{summary}</p>
      {(url || repoUrl) && <div class="work-actions">
        {url && <ExternalLink href={url} primary onOpen={preview ? undefined : onOpen}>{isMistlSite(url) ? t.playWithMistl : t.open}</ExternalLink>}
        {repoUrl && <ExternalLink href={repoUrl} primary={!url}>{t.repository}</ExternalLink>}
      </div>}
      <MistlNote url={url} />
    </div>
  </article>
}
