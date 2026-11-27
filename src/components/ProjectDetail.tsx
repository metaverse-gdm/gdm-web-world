import { useContext, useState } from 'preact/hooks'
import { localizedProject } from '../lib/localizedProject'
import type { Runtime } from '../lib/runtime'
import type { ProjectRecord } from '../lib/wires'
import { personId } from '../lib/wires'
import { useAction } from '../hooks/useAction'
import { documentLanguages, LanguageContext, useMessages } from '../i18n'
import { AuthorLink, BackLink, ConfirmDialog, DateText, ErrorText, ExternalLink, Tags } from './common'
import { GroupLink } from './Groups'
import { Icon } from './Icon'
import { MarkdownView } from './MarkdownView'
import { ProjectStats } from './ProjectStats'
import { Thumbnail } from './Thumbnail'

type Props = { project: ProjectRecord; runtime: Runtime } & (
  { variant?: 'page' } | { variant: 'modal'; titleId: string; onDeleted(): void }
)

export function ProjectDetail(props: Props) {
  const { project, runtime, variant } = props
  const t = useMessages()
  const { title, summary, description, lang } = localizedProject(project, useContext(LanguageContext))
  const locale = lang && documentLanguages[lang]
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
    <div class="panel detail-panel">
      <div class="row-between detail-heading">
        <h1 id={variant === 'modal' ? props.titleId : undefined} lang={locale}>{title}</h1>
        {(edit || remove) && <div class="actions">
          {edit && <a class="icon-button" href={`#/edit/${project.projectId}`} aria-label={t.edit} data-tooltip={t.edit}><Icon name="edit" /></a>}
          {remove && <button type="button" class="icon-button danger" aria-label={t.remove} data-tooltip={t.remove}
            disabled={action.busy} onClick={event => setOpener(event.currentTarget)}><Icon name="trash" /></button>}
        </div>}
      </div>
      <p class="lead" lang={locale}>{summary}</p>
      <Tags tags={project.tags} />
      <dl class="project-meta">
        <div><dt>{t.author}</dt><dd><AuthorLink did={author} name={runtime.displayNameFor(author)} /></dd></div>
        {group && <div><dt>{t.group}</dt><dd><GroupLink group={group} /></dd></div>}
        <div><dt>{t.updated}</dt><dd><DateText at={project.updatedAt} dateOnly /></dd></div>
      </dl>
      <Thumbnail cid={project.thumbnailCid} url={project.thumbnailUrl} projectUrl={project.url} title={title} />
      <div class="actions">
        <ExternalLink href={project.url} primary onOpen={() => runtime.trackProject(project.projectId, 'click')}>{t.open}</ExternalLink>
        {project.repoUrl && <ExternalLink href={project.repoUrl}>{t.repository}</ExternalLink>}
      </div>
      <ErrorText message={action.error} />
      {stats && <ProjectStats stats={stats} />}
      {description && <div class="description" lang={locale}><MarkdownView text={description} tables /></div>}
    </div>
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
