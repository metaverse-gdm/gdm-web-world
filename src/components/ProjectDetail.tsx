import { useContext, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { localizedProject } from '../lib/localizedProject'
import { galleryItemsFor } from '../lib/cover'
import type { GroupView } from '../lib/catalogStore'
import type { Runtime } from '../lib/runtime'
import type { ProjectFields, ProjectRecord } from '../lib/wires'
import { isHttpUrl, personId } from '../lib/wires'
import { useAction } from '../hooks/useAction'
import { documentLanguages, LanguageContext, useMessages } from '../i18n'
import { AuthorLink, BackLink, ConfirmDialog, DateText, ErrorText, ExternalLink, Tags } from './common'
import { GroupLink } from './Groups'
import { Icon } from './Icon'
import { MarkdownView } from './MarkdownView'
import { MediaGallery } from './MediaGallery'
import { ProjectStats } from './ProjectStats'
import { Thumbnail } from './Thumbnail'

type Props = { project: ProjectRecord; runtime: Runtime } & (
  { variant?: 'page' } | { variant: 'modal'; titleId: string; onDeleted(): void }
)

export function ProjectDetailBody({ fields, updatedAt, authorDid, authorName, group, titleId,
  headingActions, afterActions, onOpenProject, preview = false }: {
  fields: ProjectFields; updatedAt: number; authorDid: string; authorName?: string; group?: GroupView
  titleId?: string; headingActions?: ComponentChildren; afterActions?: ComponentChildren; onOpenProject?(): void; preview?: boolean
}) {
  const t = useMessages()
  const language = useContext(LanguageContext)
  const { title, summary, description, lang } = localizedProject(fields, language)
  const locale = lang && documentLanguages[lang]
  const untitled = preview && !title.trim()
  const displayTitle = untitled ? t.previewUntitled : title
  const url = preview && !isHttpUrl(fields.url) ? '' : fields.url
  const repoUrl = preview && !isHttpUrl(fields.repoUrl) ? undefined : fields.repoUrl
  return <div class="panel detail-panel">
    <div class="row-between detail-heading">
      <h1 id={titleId} lang={untitled ? documentLanguages[language] : locale}>{displayTitle}</h1>
      {headingActions}
    </div>
    <p class="lead" lang={locale}>{summary}</p>
    <Tags tags={fields.tags} />
    <dl class="project-meta">
      <div><dt>{t.author}</dt><dd><AuthorLink did={authorDid} name={authorName} link={!preview} /></dd></div>
      {group && <div><dt>{t.group}</dt><dd><GroupLink group={group} link={!preview} /></dd></div>}
      <div><dt>{t.updated}</dt><dd><DateText at={updatedAt} dateOnly /></dd></div>
    </dl>
    {fields.media?.length
      ? <MediaGallery items={galleryItemsFor(fields)} title={displayTitle} lang={locale} />
      : <Thumbnail cid={fields.thumbnailCid} url={fields.thumbnailUrl} projectUrl={url} title={displayTitle} />}
    {(!preview || url || repoUrl) && <div class="actions">
      {(!preview || url) && <ExternalLink href={url} primary onOpen={preview ? undefined : onOpenProject}>{t.open}</ExternalLink>}
      {repoUrl && <ExternalLink href={repoUrl}>{t.repository}</ExternalLink>}
    </div>}
    {afterActions}
    {description && <div class="description" lang={locale}><MarkdownView text={description} tables /></div>}
  </div>
}

export function ProjectDetail(props: Props) {
  const { project, runtime, variant } = props
  const t = useMessages()
  const action = useAction()
  const [opener, setOpener] = useState<HTMLButtonElement>()
  const self = runtime.getSelf().id
  const author = personId(project)
  const group = runtime.groupFor(project)
  const role = runtime.getCatalog().roles.get(self)
  const edit = role && self === author
  const remove = edit || role === 'admin'
  const stats = variant === 'modal' && (self === author || role === 'admin') ? runtime.getProjectStats(project.projectId) : undefined
  return <article class={variant === 'modal' ? 'detail' : 'detail content-width'}>
    {variant !== 'modal' && <BackLink />}
    <ProjectDetailBody key={project.projectId} fields={project} updatedAt={project.updatedAt} authorDid={author}
      authorName={runtime.displayNameFor(author)} group={group} titleId={variant === 'modal' ? props.titleId : undefined}
      onOpenProject={() => runtime.trackProject(project.projectId, 'click')}
      headingActions={(edit || remove) && <div class="actions">
        {edit && <a class="icon-button" href={`#/edit/${project.projectId}`} aria-label={t.edit} data-tooltip={t.edit}><Icon name="edit" /></a>}
        {remove && <button type="button" class="icon-button danger" aria-label={t.remove} data-tooltip={t.remove}
          disabled={action.busy} onClick={event => setOpener(event.currentTarget)}><Icon name="trash" /></button>}
      </div>}
      afterActions={<><ErrorText message={action.error} />{stats && <ProjectStats stats={stats} />}</>} />
    {opener && <ConfirmDialog message={t.confirmDelete} confirm={t.remove} opener={opener} onClose={accepted => {
      setOpener(undefined)
      if (accepted) void action.run(async () => {
        await runtime.deleteProject(project.projectId)
        if (variant === 'modal') props.onDeleted()
        else location.hash = '#/'
      })
    }} />}
  </article>
}
