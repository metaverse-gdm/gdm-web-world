import { describeMedia, mediaKey } from './media'
import type { MediaItem, ProjectFields } from './wires'

type CoverFields = Pick<ProjectFields, 'thumbnailCid' | 'thumbnailUrl' | 'media' | 'url'>

function explicitCover(project: CoverFields): MediaItem | undefined {
  if (project.thumbnailCid) return { cid: project.thumbnailCid }
  if (project.thumbnailUrl) return { url: project.thumbnailUrl }
}

/** Prefer an old record's explicit cover, then the first gallery item's still image. */
export function coverFor(project: CoverFields): { cid?: string; url?: string; mediaImage?: boolean; projectUrl: string } {
  const cover = explicitCover(project)
  const projectUrl = project.url
  if (cover) return { ...cover, projectUrl }
  const first = project.media?.[0]
  if (first) {
    if ('cid' in first) return first.thumb
      ? { cid: first.thumb, projectUrl }
      : { cid: first.cid, mediaImage: true, projectUrl }
    const view = describeMedia(first)
    if (view.kind === 'image') return { url: view.url, projectUrl }
    if (view.kind === 'embed' && view.embed.poster) return { url: view.embed.poster, projectUrl }
  }
  return { projectUrl }
}

/** A separate legacy cover is the first slide, without duplicating a gallery entry. */
export function galleryItemsFor(project: CoverFields): MediaItem[] {
  const items = project.media ?? []
  const cover = explicitCover(project)
  if (!cover) return items
  const key = mediaKey(cover)
  return [items.find(item => mediaKey(item) === key) ?? cover, ...items.filter(item => mediaKey(item) !== key)]
}
