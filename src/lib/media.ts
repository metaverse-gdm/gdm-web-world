import type { MediaItem } from './wires'

export type { MediaItem } from './wires'
export { validMediaItem, validMediaList } from './wires'

export type VideoProvider = 'youtube' | 'bilibili' | 'vimeo' | 'niconico'
export type VideoEmbed = {
  provider: VideoProvider; id: string
  /** Player URL for an iframe. Autoplays, since it is only mounted after the viewer presses play. */
  embedUrl: string
  /** Page to open the video on the provider's site. */
  watchUrl: string
  /** Static poster image, when the provider exposes one without an API call. */
  poster?: string
}
export type MediaView =
  | { kind: 'image'; cid: string; url?: undefined }
  | { kind: 'image'; url: string; cid?: undefined }
  | { kind: 'embed'; url: string; embed: VideoEmbed }
  | { kind: 'video'; url: string }

export const providerNames: Record<VideoProvider, string> = {
  youtube: 'YouTube', bilibili: 'bilibili', vimeo: 'Vimeo', niconico: 'niconico',
}

export const mediaKey = (item: MediaItem) => 'cid' in item ? `cid:${item.cid}` : `url:${item.url}`

function parseUrl(raw: string): URL | undefined {
  try { return new URL(raw) } catch { return undefined }
}

/** Seconds from a `t` / `start` value such as `90`, `90s` or `1h2m3s`. */
function startSeconds(value: string | null): number | undefined {
  if (!value) return
  if (/^\d+s?$/.test(value)) return Number.parseInt(value, 10) || undefined
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!match || !match[0]) return
  const [, h = '0', m = '0', s = '0'] = match
  return Number(h) * 3600 + Number(m) * 60 + Number(s) || undefined
}

const youtubeId = /^[A-Za-z0-9_-]{11}$/

function youtube(url: URL): VideoEmbed | undefined {
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  let id: string | undefined
  if (host === 'youtu.be') id = url.pathname.split('/')[1]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, first, second] = url.pathname.split('/')
    id = first === 'watch' ? url.searchParams.get('v') ?? undefined
      : ['shorts', 'embed', 'live', 'v'].includes(first) ? second : undefined
  }
  if (!id || !youtubeId.test(id)) return
  const start = startSeconds(url.searchParams.get('t') ?? url.searchParams.get('start'))
  const params = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1' })
  if (start) params.set('start', String(start))
  return {
    provider: 'youtube', id,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?${params}`,
    watchUrl: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ''}`,
    poster: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  }
}

function bilibili(url: URL): VideoEmbed | undefined {
  const host = url.hostname.replace(/^(www|m)\./, '')
  if (host === 'player.bilibili.com') {
    const bvid = url.searchParams.get('bvid'), aid = url.searchParams.get('aid')
    const id = bvid && /^BV[0-9A-Za-z]{10}$/.test(bvid) ? bvid : aid && /^\d{1,12}$/.test(aid) ? `av${aid}` : undefined
    return id ? bilibiliEmbed(id, Number(url.searchParams.get('page')) || 1, startSeconds(url.searchParams.get('t'))) : undefined
  }
  if (host !== 'bilibili.com') return
  const match = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av\d{1,12})\/?$/i)
  if (!match) return
  const id = match[1].startsWith('BV') ? match[1] : match[1].toLowerCase()
  return bilibiliEmbed(id, Number(url.searchParams.get('p')) || 1, startSeconds(url.searchParams.get('t')))
}

function bilibiliEmbed(id: string, page: number, start?: number): VideoEmbed {
  const params = new URLSearchParams(id.startsWith('BV') ? { bvid: id } : { aid: id.slice(2) })
  params.set('page', String(Math.max(1, Math.min(page, 999))))
  params.set('autoplay', '1')
  params.set('high_quality', '1')
  params.set('danmaku', '0')
  if (start) params.set('t', String(start))
  const query = new URLSearchParams()
  if (page > 1) query.set('p', String(page))
  if (start) query.set('t', String(start))
  const suffix = query.size ? `?${query}` : ''
  return {
    provider: 'bilibili', id,
    embedUrl: `https://player.bilibili.com/player.html?${params}`,
    watchUrl: `https://www.bilibili.com/video/${id}/${suffix}`,
  }
}

function vimeo(url: URL): VideoEmbed | undefined {
  const host = url.hostname.replace(/^www\./, '')
  const match = host === 'vimeo.com' ? url.pathname.match(/^\/(\d{1,12})(?:\/([0-9a-f]{6,20}))?\/?$/)
    : host === 'player.vimeo.com' ? url.pathname.match(/^\/video\/(\d{1,12})\/?$/) : null
  if (!match) return
  const id = match[1]
  const hash = match[2] ?? url.searchParams.get('h') ?? undefined
  const params = new URLSearchParams({ autoplay: '1' })
  if (hash && /^[0-9a-f]{6,20}$/.test(hash)) params.set('h', hash)
  return {
    provider: 'vimeo', id,
    embedUrl: `https://player.vimeo.com/video/${id}?${params}`,
    watchUrl: `https://vimeo.com/${id}${hash ? `/${hash}` : ''}`,
  }
}

function niconico(url: URL): VideoEmbed | undefined {
  const host = url.hostname.replace(/^(www|sp|embed)\./, '')
  const id = host === 'nico.ms' ? url.pathname.slice(1)
    : host === 'nicovideo.jp' ? url.pathname.match(/^\/watch\/([a-z]{2}\d+)\/?$/)?.[1] : undefined
  if (!id || !/^(sm|so|nm)\d{1,12}$/.test(id)) return
  return {
    provider: 'niconico', id,
    embedUrl: `https://embed.nicovideo.jp/watch/${id}?autoplay=1`,
    watchUrl: `https://www.nicovideo.jp/watch/${id}`,
  }
}

export function parseVideoEmbed(raw: string): VideoEmbed | undefined {
  const url = parseUrl(raw)
  if (!url || url.protocol !== 'https:') return
  return youtube(url) ?? bilibili(url) ?? vimeo(url) ?? niconico(url)
}

const videoFile = /\.(mp4|m4v|webm|ogv|mov)$/i

export function describeMedia(item: MediaItem): MediaView {
  if ('cid' in item) return { kind: 'image', cid: item.cid }
  const embed = parseVideoEmbed(item.url)
  if (embed) return { kind: 'embed', url: item.url, embed }
  const path = parseUrl(item.url)?.pathname ?? ''
  return videoFile.test(path) ? { kind: 'video', url: item.url } : { kind: 'image', url: item.url }
}
