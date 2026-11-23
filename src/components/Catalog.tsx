import { useContext, useMemo, useRef, useState } from 'preact/hooks'
import { documentLanguages, LanguageContext, useMessages } from '../i18n'
import { compareStrings } from '../lib/wireSign'
import type { ProjectRecord, StatsMetric } from '../lib/wires'
import { EmptyState } from './common'
import { Icon } from './Icon'
import { ProjectGrid } from './ProjectGrid'
import { Select } from './Select'

export function CatalogPage({ projects, displayNameFor, trackProject, impressionsActive }: {
  projects: ReadonlyMap<string, ProjectRecord>; displayNameFor(did: string): string | undefined
  trackProject(id: string, metric: StatsMetric): void; impressionsActive: boolean
}) {
  const t = useMessages()
  const locale = documentLanguages[useContext(LanguageContext)]
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<'createdAt' | 'updatedAt'>('updatedAt')
  const entries = useMemo(() => [...projects.values()], [projects])
  const tags = useMemo(() => [...new Set(entries.flatMap(project => project.tags))].sort((a, b) => a.localeCompare(b, locale)), [entries, locale])
  const tagOptions = useMemo(() => [{ value: '', label: t.allTags }, ...tags.map(value => ({ value, label: value }))], [tags, t.allTags])
  const activeTag = tags.includes(tag) ? tag : ''
  const text = query.trim().toLocaleLowerCase(locale)
  const shown = useMemo(() => entries.filter(project => (!activeTag || project.tags.includes(activeTag))
    && (!text || [project.title, project.summary, ...project.tags,
      ...Object.values(project.translations ?? {}).flatMap(({ title, summary }) => [title, summary]),
    ].some(field => field.toLocaleLowerCase(locale).includes(text))))
    .sort((a, b) => b[sort] - a[sort] || compareStrings(a.projectId, b.projectId)), [entries, activeTag, text, sort, locale])
  const order = useMemo(() => shown.map(project => project.projectId).join(','), [shown])

  return <>
    <div class="filters" role="search">
      <div class="search-field">
        <Icon name="search" />
        <input ref={search} type="search" aria-label={t.search} placeholder={t.search} value={query}
          onInput={e => setQuery(e.currentTarget.value)} />
        {query && <button type="button" class="search-clear" aria-label={t.clearSearch} data-tooltip={t.clearSearch}
          onClick={() => { setQuery(''); search.current?.focus({ preventScroll: true }) }}><Icon name="close" /></button>}
      </div>
      <Select ariaLabel={t.tags} value={activeTag} options={tagOptions} onChange={setTag} />
      <Select<'createdAt' | 'updatedAt'> ariaLabel={t.sort} value={sort} onChange={setSort} options={[
        { value: 'updatedAt', label: t.updatedFirst }, { value: 'createdAt', label: t.createdFirst },
      ]} />
    </div>
    <span class="sr-only" role="status">{t.results(shown.length)}</span>
    <ProjectGrid projects={shown} order={order} label={t.catalog} displayNameFor={displayNameFor}
      trackProject={trackProject} impressionsActive={impressionsActive} />
    {shown.length === 0 && (entries.length === 0
      ? <EmptyState message={t.noProjects} />
      : <EmptyState message={t.noMatches}>
          <button type="button" onClick={() => { setTag(''); setQuery('') }}>{t.clearFilters}</button>
        </EmptyState>)}
  </>
}
