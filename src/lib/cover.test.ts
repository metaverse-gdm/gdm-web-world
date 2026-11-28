import { expect, it } from 'vitest'
import { coverFor, galleryItemsFor } from './cover'

const url = 'https://example.com/game'
const cid = 'bafyGalleryImage'
const thumb = 'bafyGalleryThumbnail'
const image = 'https://example.com/gallery.png'
const cover = 'https://example.com/cover.png'
const youtube = 'https://youtu.be/dQw4w9WgXcQ'

it('prefers an explicit cover over gallery media', () => {
  expect(coverFor({ url, thumbnailCid: cid, thumbnailUrl: cover, media: [{ url: image }] })).toEqual({ cid, projectUrl: url })
  expect(coverFor({ url, thumbnailUrl: cover, media: [{ cid }] })).toEqual({ url: cover, projectUrl: url })
})

it('uses the first gallery image or known video poster for a card cover', () => {
  expect(coverFor({ url, media: [{ cid, thumb }, { url: image }] })).toEqual({ cid: thumb, projectUrl: url })
  expect(coverFor({ url, media: [{ cid }, { url: image }] })).toEqual({ cid, mediaImage: true, projectUrl: url })
  expect(coverFor({ url, media: [{ url: image }] })).toEqual({ url: image, projectUrl: url })
  expect(coverFor({ url, media: [{ url: youtube }] })).toEqual({
    url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg', projectUrl: url,
  })
})

it('keeps automatic project previews when the first item has no known cover', () => {
  for (const video of ['https://example.com/demo.mp4', 'https://vimeo.com/12345', 'https://nico.ms/sm1234', 'https://www.bilibili.com/video/av123/']) {
    expect(coverFor({ url, media: [{ url: video }, { url: image }] })).toEqual({ projectUrl: url })
  }
  expect(coverFor({ url })).toEqual({ projectUrl: url })
  expect(coverFor({ url, media: [] })).toEqual({ projectUrl: url })
})

it('prepends a separate cover and avoids duplicating an existing gallery item', () => {
  const media = [{ url: youtube }, { url: image }]
  expect(galleryItemsFor({ url, thumbnailCid: cid, media })).toEqual([{ cid }, ...media])
  expect(galleryItemsFor({ url, thumbnailUrl: cover, media })).toEqual([{ url: cover }, ...media])
  expect(galleryItemsFor({ url, thumbnailUrl: image, media })).toEqual([{ url: image }, { url: youtube }])
  expect(galleryItemsFor({ url, thumbnailCid: cid, media: [{ url: youtube }, { cid, thumb }] })).toEqual([{ cid, thumb }, { url: youtube }])
  expect(galleryItemsFor({ url, media })).toEqual(media)
})
