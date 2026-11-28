import { describe, expect, it } from 'vitest'
import { describeMedia, parseVideoEmbed } from './media'

const youtubeId = 'dQw4w9WgXcQ'

describe('parseVideoEmbed', () => {
  it.each([
    `https://www.youtube.com/watch?v=${youtubeId}`,
    `https://youtu.be/${youtubeId}`,
    `https://www.youtube.com/shorts/${youtubeId}`,
  ])('parses YouTube links (%s)', url => {
    const embed = parseVideoEmbed(url)!
    expect(embed).toMatchObject({
      provider: 'youtube', id: youtubeId,
      watchUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
      poster: `https://i.ytimg.com/vi/${youtubeId}/mqdefault.jpg`,
    })
    const player = new URL(embed.embedUrl)
    expect(player.origin).toBe('https://www.youtube-nocookie.com')
    expect(player.pathname).toBe(`/embed/${youtubeId}`)
    expect(player.searchParams.get('autoplay')).toBe('1')
  })

  it('preserves a YouTube timestamp expressed in minutes and seconds', () => {
    const embed = parseVideoEmbed(`https://youtu.be/${youtubeId}?t=1m30s`)!
    expect(new URL(embed.embedUrl).searchParams.get('start')).toBe('90')
    expect(embed.watchUrl).toBe(`https://www.youtube.com/watch?v=${youtubeId}&t=90s`)
  })

  it.each([
    ['BV1xx411c7mD', 'bvid', 'BV1xx411c7mD'],
    ['av123456', 'aid', '123456'],
  ])('parses bilibili video ID %s', (id, parameter, value) => {
    const embed = parseVideoEmbed(`https://www.bilibili.com/video/${id}/`)!
    expect(embed).toMatchObject({ provider: 'bilibili', id, watchUrl: `https://www.bilibili.com/video/${id}/` })
    const player = new URL(embed.embedUrl)
    expect(player.origin).toBe('https://player.bilibili.com')
    expect(player.pathname).toBe('/player.html')
    expect(player.searchParams.get(parameter)).toBe(value)
    expect(player.searchParams.get('page')).toBe('1')
  })

  it('preserves the bilibili part number', () => {
    const embed = parseVideoEmbed('https://www.bilibili.com/video/BV1xx411c7mD/?p=2')!
    expect(new URL(embed.embedUrl).searchParams.get('page')).toBe('2')
    expect(new URL(embed.watchUrl).searchParams.get('p')).toBe('2')
  })

  it('parses Vimeo links', () => {
    const embed = parseVideoEmbed('https://vimeo.com/123456789')!
    expect(embed).toMatchObject({ provider: 'vimeo', id: '123456789', watchUrl: 'https://vimeo.com/123456789' })
    expect(new URL(embed.embedUrl).origin).toBe('https://player.vimeo.com')
    expect(new URL(embed.embedUrl).pathname).toBe('/video/123456789')
  })

  it.each(['https://www.nicovideo.jp/watch/sm12345678', 'https://nico.ms/sm12345678'])('parses niconico links (%s)', url => {
    expect(parseVideoEmbed(url)).toEqual({
      provider: 'niconico', id: 'sm12345678',
      embedUrl: 'https://embed.nicovideo.jp/watch/sm12345678?autoplay=1',
      watchUrl: 'https://www.nicovideo.jp/watch/sm12345678',
    })
  })

  it('does not embed non-video URLs or HTTP video links', () => {
    expect(parseVideoEmbed('https://example.com/image.png')).toBeUndefined()
    expect(parseVideoEmbed(`http://www.youtube.com/watch?v=${youtubeId}`)).toBeUndefined()
  })
})

describe('describeMedia', () => {
  it('identifies an uploaded image and an ordinary HTTPS image URL', () => {
    expect(describeMedia({ cid: 'a'.repeat(32) })).toEqual({ kind: 'image', cid: 'a'.repeat(32) })
    const url = 'https://example.com/image.png'
    expect(describeMedia({ url })).toEqual({ kind: 'image', url })
  })

  it('identifies a direct MP4 file even with query parameters', () => {
    const url = 'https://example.com/video.mp4?version=2'
    expect(describeMedia({ url })).toEqual({ kind: 'video', url })
  })

  it('identifies a video provider embed', () => {
    const url = `https://youtu.be/${youtubeId}`
    expect(describeMedia({ url })).toMatchObject({ kind: 'embed', url, embed: { provider: 'youtube', id: youtubeId } })
  })
})
