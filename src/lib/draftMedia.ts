import { languages } from '../i18n'
import type { Language } from '../i18n'
import { mergeTags } from '../components/TagInput'
import type { Draft } from './localPreferences'
import { mediaKey } from './media'
import { LIMITS, validMediaItem } from './wires'
import type { MediaItem, ProjectFields, ProjectText } from './wires'

/** Convert the former separate cover into the first gallery entry. */
export function foldLegacyCover(draft: Draft): Draft {
  const { thumbnailCid, thumbnailUrl, media, ...rest } = draft
  const url = thumbnailUrl?.trim()
  const cover: MediaItem | undefined = thumbnailCid ? { cid: thumbnailCid, thumb: thumbnailCid }
    : url ? { url } : undefined
  let items = media ?? []
  if (cover) {
    const key = mediaKey(cover)
    const existing = items.find(item => mediaKey(item) === key)
    const first = existing && 'cid' in existing && existing.thumb ? existing : cover
    items = [first, ...items.filter(item => mediaKey(item) !== key)]
  }
  return { ...rest, ...(items.length ? { media: items.slice(0, LIMITS.media) } : {}) }
}

/** Build the same fields for an unsaved preview and for publishing.
 * The caller still validates required text and any supplied URLs before saving.
 */
export function draftToFields(draft: Draft, primary: Language, pendingTag = ''): ProjectFields {
  const value = foldLegacyCover(draft)
  const filled = [primary, ...languages.filter(language => language !== primary)].flatMap(language => {
    const source = language === primary ? value : value.translations?.[language]
    if (!source) return []
    const text: ProjectText = { title: source.title.trim(), summary: source.summary.trim(), description: source.description }
    return text.title || text.summary || text.description.trim() ? [{ language, text }] : []
  })
  const [main = { language: primary, text: { title: '', summary: '', description: '' } }, ...others] = filled
  const media = value.media?.filter(item => validMediaItem(item))
  const url = value.url.trim()
  return {
    ...main.text, lang: main.language,
    translations: others.length ? Object.fromEntries(others.map(({ language, text }) => [language, text])) : undefined,
    ...(url ? { url } : {}), repoUrl: value.repoUrl.trim() || undefined,
    tags: mergeTags(mergeTags([], value.tags), pendingTag),
    ...(media?.length ? { media } : {}),
    ...(value.groupId ? { groupId: value.groupId } : {}),
  }
}
