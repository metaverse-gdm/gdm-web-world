import { useMemo } from 'preact/hooks'
import { useMessages } from '../i18n'
import type { Runtime } from '../lib/runtime'
import { projectsForTag } from '../lib/tags'
import type { ProjectRecord } from '../lib/wires'
import { BackLink, EmptyState } from './common'
import { ProjectGrid } from './ProjectGrid'

export function TagPage({ tag, runtime, impressionsActive }: { tag: string; runtime: Runtime; impressionsActive: boolean }) {
  const t = useMessages()
  const projects = runtime.getCatalog().projects
  const { matches, similar } = useMemo(() => projectsForTag(projects.values(), tag), [projects, tag])
  const grid = (items: ProjectRecord[], label: string) => <ProjectGrid projects={items} label={label}
    order={items.map(project => project.projectId).join(',')} displayNameFor={runtime.displayNameFor} avatarFor={runtime.avatarFor}
    groupFor={runtime.groupFor} trackProject={runtime.trackProject} impressionsActive={impressionsActive} />
  return <div class="tag-page screen-stack">
    <BackLink label={t.allProjects} />
    <section class="tag-section" aria-labelledby="tag-heading">
      <h1 id="tag-heading">{t.tagProjects(tag)}</h1>
      <p class="muted" role="status">{t.results(matches.length)}</p>
      {matches.length ? grid(matches, t.tagProjects(tag)) : <EmptyState message={t.noTagProjects} />}
    </section>
    {similar.length > 0 && <section class="tag-section" aria-labelledby="similar-heading">
      <h2 id="similar-heading">{t.similarProjects}</h2>
      {grid(similar, t.similarProjects)}
    </section>}
  </div>
}
