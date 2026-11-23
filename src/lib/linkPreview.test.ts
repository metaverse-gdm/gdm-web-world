import { afterEach, expect, it, vi } from 'vitest'
import { parseThumbnailHtml, resolvePreviewImage, resolveScreenshot, screenshotUrl } from './linkPreview'

const page = 'https://example.com/projects/demo/'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('prefers secure Open Graph metadata and resolves it against the page URL', () => {
  expect(parseThumbnailHtml(
    '<meta property="og:image" content="/other.png"><meta property="og:image:secure_url" content="../hero.png">',
    page,
  )).toBe('https://example.com/projects/hero.png')
})

it.each([
  ['<meta name="twitter:image" content="//img.example.com/cover.png">', 'https://img.example.com/cover.png'],
  ['<link rel="image_src" href="/cover.png"><link rel="apple-touch-icon" href="/icon.png">', 'https://example.com/cover.png'],
  ['<link rel="apple-touch-icon" href="icon.png">', page + 'icon.png'],
  ['<meta name="og:image" content="data:image/png,bad"><meta property="og:image" content="/valid.png">', 'https://example.com/valid.png'],
  ['<meta property="og:image" content="http://example.com/cover.png">', undefined],
  ['<meta property="og:image" content="https://user@example.com/cover.png">', undefined],
])('finds the first usable image in %s', (html, expected) => {
  expect(parseThumbnailHtml(html, page)).toBe(expected)
})

it('allows HTTP on HTTP pages and prefers HTTPS where available', () => {
  const http = '<meta property="og:image" content="/cover.png">'
  const insecurePage = 'http://example.com/'
  expect(parseThumbnailHtml(http, insecurePage)).toBe(insecurePage + 'cover.png')
  expect(parseThumbnailHtml(http, insecurePage, true)).toBeUndefined()
  expect(parseThumbnailHtml(http + '<link rel="image_src" href="https://example.com/cover.png">', insecurePage))
    .toBe('https://example.com/cover.png')
})

it('deduplicates in-flight requests and caches hits and misses at different TTLs', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response('<meta property="og:image" content="/cover.png">'))
    .mockRejectedValue(new Error('CORS'))
  vi.stubGlobal('fetch', fetch)
  const miss = 'https://example.net/demo?a=1&b=2'

  const request = resolvePreviewImage(page)
  expect(resolvePreviewImage(page)).toBe(request)
  await expect(request).resolves.toBe('https://example.com/cover.png')
  await expect(resolvePreviewImage(miss)).resolves.toBeNull()
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch).toHaveBeenCalledWith(page, expect.objectContaining({ credentials: 'omit', mode: 'cors' }))
  expect(screenshotUrl(miss)).toBe('https://s.wordpress.com/mshots/v1/https%3A%2F%2Fexample.net%2Fdemo%3Fa%3D1%26b%3D2?w=720')

  now.mockReturnValue(1000 + 24 * 60 * 60 * 1000)
  await expect(resolvePreviewImage(page)).resolves.toBe('https://example.com/cover.png')
  await expect(resolvePreviewImage(miss)).resolves.toBeNull()
  expect(fetch).toHaveBeenCalledTimes(3)
  now.mockReturnValue(1000 + 7 * 24 * 60 * 60 * 1000)
  await expect(resolvePreviewImage(page)).resolves.toBeNull()
  expect(fetch).toHaveBeenCalledTimes(4)
})

it('runs at most three preview fetches at a time', async () => {
  const responses: ((response: Response) => void)[] = []
  const fetch = vi.fn(() => new Promise<Response>(resolve => responses.push(resolve)))
  vi.stubGlobal('fetch', fetch)
  const requests = [0, 1, 2, 3].map(n => resolvePreviewImage(`https://example.org/${n}`))
  expect(fetch).toHaveBeenCalledTimes(3)
  responses[0](new Response('', { status: 404 }))
  await requests[0]
  expect(fetch).toHaveBeenCalledTimes(4)
  for (const resolve of responses.slice(1)) resolve(new Response('', { status: 404 }))
  await expect(Promise.all(requests)).resolves.toEqual([null, null, null, null])
})

it('waits past the mshots placeholder and never resolves to it', async () => {
  const widths = [400, 400, 720]
  const sources: string[] = []
  vi.stubGlobal('Image', class {
    naturalWidth = 0
    onload?: () => void
    set src(value: string) { sources.push(value); this.naturalWidth = widths.shift()!; queueMicrotask(() => this.onload?.()) }
  })
  const page = 'https://placeholder.example/'
  const result = await resolveScreenshot(page, async () => {})
  expect(result).toBe(`${screenshotUrl(page)}&r=2`)
  expect(sources).toHaveLength(3)

  vi.stubGlobal('Image', class {
    naturalWidth = 400
    onload?: () => void
    set src(_: string) { queueMicrotask(() => this.onload?.()) }
  })
  expect(await resolveScreenshot('https://never.example/', async () => {})).toBeNull()
})
