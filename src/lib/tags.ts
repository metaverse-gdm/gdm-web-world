import { compareStrings } from './wireSign'
import type { ProjectRecord } from './wires'

// Replace unmatched UTF-16 surrogates so even malformed legacy tags can be linked.
export const tagText = (tag: string) => tag.replace(/[\uD800-\uDFFF]/gu, '\uFFFD')
const normalizeTag = (tag: string) => tagText(tag).trim().toLowerCase()
const normalizedTags = (tags: readonly string[]) => new Set(tags.map(normalizeTag))
const recentFirst = (a: ProjectRecord, b: ProjectRecord) =>
  b.updatedAt - a.updatedAt || compareStrings(a.projectId, b.projectId)

/** Rank non-matching projects by the frequency of their distinct tags among exact matches. */
export function projectsForTag(projects: Iterable<ProjectRecord>, tag: string, limit = 12) {
  const target = normalizeTag(tag)
  const matches: ProjectRecord[] = []
  const candidates: { project: ProjectRecord; tags: Set<string> }[] = []
  const frequency = new Map<string, number>()
  for (const project of projects) {
    const tags = normalizedTags(project.tags)
    if (!tags.has(target)) {
      candidates.push({ project, tags })
      continue
    }
    matches.push(project)
    for (const value of tags) if (value !== target) frequency.set(value, (frequency.get(value) ?? 0) + 1)
  }
  const similar = candidates.map(({ project, tags }) => ({
    project, score: [...tags].reduce((score, value) => score + (frequency.get(value) ?? 0), 0),
  })).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || recentFirst(a.project, b.project))
    .slice(0, limit).map(({ project }) => project)
  return { matches: matches.sort(recentFirst), similar }
}
