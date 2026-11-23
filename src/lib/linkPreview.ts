import { isObject } from './wires'

const imageSelectors = ['og:image:secure_url', 'og:image', 'twitter:image'].map(name =>
  `meta[property="${name}" i], meta[name="${name}" i]`)
imageSelectors.push('link[rel~="image_src" i]', 'link[rel~="apple-touch-icon" i]')

function imageUrl(raw: string | null, base?: string, httpsOnly = false): string | undefined {
  if (!raw?.trim() || raw.length > 2048) return
  try {
    const url = new URL(raw, base)
    if ((url.protocol === 'https:' || !httpsOnly && url.protocol === 'http:')
      && !url.username && !url.password && url.href.length <= 2048) return url.href
  } catch { /* Skip malformed metadata. */ }
}

export function parseThumbnailHtml(html: string, pageUrl: string, httpsOnly = false): string | undefined {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const secure = httpsOnly || new URL(pageUrl).protocol === 'https:'
  let insecure: string | undefined
  for (const selector of imageSelectors) {
    for (const element of doc.querySelectorAll(selector)) {
      const image = imageUrl(element.getAttribute('content') ?? element.getAttribute('href'), pageUrl, secure)
      if (image?.startsWith('https:')) return image
      insecure ??= image
    }
  }
  return insecure
}

export const screenshotUrl = (url: string) => `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=720`

const cacheKey = 'gdm-world:thumbnail-previews:v1'
const cacheSize = 300
const day = 24 * 60 * 60 * 1000
type CacheEntry = { image: string | null; at: number }
let cache: Map<string, CacheEntry> | undefined
const inFlight = new Map<string, Promise<string | null>>()
const queue: (() => void)[] = []
let running = 0

const fresh = (entry: CacheEntry, now: number) => now >= entry.at && now - entry.at < (entry.image ? 7 : 1) * day

function loadCache() {
  if (cache) return cache
  cache = new Map<string, CacheEntry>()
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(cacheKey) ?? 'null')
    if (!Array.isArray(saved)) return cache
    for (const pair of saved.slice(-cacheSize)) {
      if (!Array.isArray(pair)) continue
      const [url, entry] = pair
      if (typeof url !== 'string' || !isObject(entry) || typeof entry.at !== 'number') continue
      const image = typeof entry.image === 'string' ? imageUrl(entry.image, undefined, location.protocol === 'https:') : entry.image
      if (image !== null && typeof image !== 'string') continue
      if (fresh({ image, at: entry.at }, Date.now())) cache.set(url, { image, at: entry.at })
    }
  } catch { /* The in-memory cache still works without storage. */ }
  return cache
}

function remember(url: string, image: string | null) {
  const entries = loadCache()
  entries.delete(url)
  entries.set(url, { image, at: Date.now() })
  const oldest = entries.keys().next().value
  if (entries.size > cacheSize && oldest !== undefined) entries.delete(oldest)
  try { localStorage.setItem(cacheKey, JSON.stringify([...entries])) } catch {}
}

async function fetchImage(url: string): Promise<string | null> {
  if (running < 3) running++
  else await new Promise<void>(resolve => queue.push(resolve))
  try {
    const response = await fetch(url, {
      credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8000),
    })
    if (response.ok) return parseThumbnailHtml(await response.text(), response.url || url, location.protocol === 'https:') ?? null
  } catch { /* Sites without CORS support fall back to the screenshot. */ }
  finally {
    const next = queue.shift()
    if (next) next()
    else running--
  }
  return null
}

export function resolvePreviewImage(url: string): Promise<string | null> {
  const cached = loadCache().get(url)
  if (cached && fresh(cached, Date.now())) return Promise.resolve(cached.image)
  const pending = inFlight.get(url)
  if (pending) return pending
  const request = fetchImage(url).then(image => {
    remember(url, image)
    inFlight.delete(url)
    return image
  })
  inFlight.set(url, request)
  return request
}

// mshots answers with a 400x300 "Generating Preview" GIF until the capture exists.
// Never show it: preload, and only resolve once a real capture (720px wide) arrives.
const SCREENSHOT_RETRIES = [4000, 8000, 15000, 30000]
const screenshots = new Map<string, Promise<string | null>>()
export const isScreenshotPlaceholder = (width: number) => width <= 400

function preload(src: string) {
  return new Promise<{ width: number } | null>(resolve => {
    const image = new Image()
    image.referrerPolicy = 'no-referrer'
    image.onload = () => resolve({ width: image.naturalWidth })
    image.onerror = () => resolve(null)
    image.src = src
  })
}

export function resolveScreenshot(url: string, wait = (ms: number) => new Promise(r => setTimeout(r, ms))): Promise<string | null> {
  const pending = screenshots.get(url)
  if (pending) return pending
  const request = (async () => {
    for (let attempt = 0; attempt <= SCREENSHOT_RETRIES.length; attempt++) {
      const src = attempt ? `${screenshotUrl(url)}&r=${attempt}` : screenshotUrl(url)
      const size = await preload(src)
      if (!size) return null
      if (!isScreenshotPlaceholder(size.width)) return src
      if (attempt < SCREENSHOT_RETRIES.length) await wait(SCREENSHOT_RETRIES[attempt])
    }
    return null
  })()
  screenshots.set(url, request)
  void request.then(src => { if (!src) screenshots.delete(url) })
  return request
}
