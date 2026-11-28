import { expect, it } from 'vitest'
import { draftToFields, foldLegacyCover } from './draftMedia'
import { emptyDraft } from './localPreferences'
import { LIMITS } from './wires'

const cid = 'a'.repeat(32)
const thumb = 'b'.repeat(32)
const cover = 'https://example.com/cover.png'
const other = 'https://example.com/other.png'

it('moves a legacy uploaded thumbnail to the front without duplicates or mutation', () => {
  const draft = { ...emptyDraft(), thumbnailCid: cid, media: [{ url: other }, { cid }, { cid }] }
  const folded = foldLegacyCover(draft)
  expect(folded.media).toEqual([{ cid, thumb: cid }, { url: other }])
  expect(folded).not.toHaveProperty('thumbnailCid')
  expect(folded).not.toHaveProperty('thumbnailUrl')
  expect(draft.media).toEqual([{ url: other }, { cid }, { cid }])
  expect(draft.thumbnailCid).toBe(cid)
  expect(foldLegacyCover(folded)).toEqual(folded)
})

it('preserves an existing small thumbnail when promoting the matching CID', () => {
  expect(foldLegacyCover({ ...emptyDraft(), thumbnailCid: cid, media: [{ url: other }, { cid, thumb }] }).media)
    .toEqual([{ cid, thumb }, { url: other }])
})

it('folds a trimmed legacy URL, dedupes it and preserves the remaining order', () => {
  const draft = { ...emptyDraft(), thumbnailUrl: ` ${cover} `, media: [{ url: other }, { url: cover }, { cid, thumb }] }
  expect(foldLegacyCover(draft)).toEqual({ ...emptyDraft(), media: [{ url: cover }, { url: other }, { cid, thumb }] })
})

it('caps the gallery at the media limit and prioritizes the legacy cover', () => {
  const media = Array.from({ length: LIMITS.media }, (_, i) => ({ url: `https://example.com/${i}.png` }))
  expect(foldLegacyCover({ ...emptyDraft(), thumbnailCid: cid, thumbnailUrl: cover, media }).media)
    .toEqual([{ cid, thumb: cid }, ...media.slice(0, LIMITS.media - 1)])
  expect(foldLegacyCover({ ...emptyDraft(), media })).toEqual({ ...emptyDraft(), media })
  expect(foldLegacyCover({ ...emptyDraft(), thumbnailUrl: '  ' })).toEqual(emptyDraft())
})

it('builds fields with trimmed titles, summaries and URLs, translations, tags, group and valid media', () => {
  const groupId = '190b17ef-7ad2-43e4-b374-351e89cc5c44'
  const draft = {
    ...emptyDraft(), title: ' Title ', summary: ' Summary ', description: '  Markdown  ',
    translations: {
      ja: { title: ' Japanese ', summary: ' Summary ', description: 'Description' },
      zh: { title: ' ', summary: '', description: ' ' },
    },
    tags: ' First, Second, First ', url: ' https://example.com ', repoUrl: ' https://example.com/repo ',
    thumbnailUrl: cover, media: [{ url: 'http://example.com/invalid.png' }, { cid, thumb }], groupId,
  }
  expect(draftToFields(draft, 'en', 'Second, Third')).toEqual({
    title: 'Title', summary: 'Summary', description: '  Markdown  ', lang: 'en',
    translations: { ja: { title: 'Japanese', summary: 'Summary', description: 'Description' } },
    tags: ['First', 'Second', 'Third'], url: 'https://example.com', repoUrl: 'https://example.com/repo',
    media: [{ url: cover }, { cid, thumb }], groupId,
  })
  expect(draftToFields(draft, 'en')).not.toHaveProperty('thumbnailUrl')
})

it('promotes the first nonempty language and retains incomplete text for validation or preview', () => {
  const fields = draftToFields({
    ...emptyDraft(), translations: { ja: { title: ' Japanese ', summary: '', description: '' } },
    media: [{ url: 'http://example.com/invalid.png' }], thumbnailUrl: 'not a URL',
  }, 'en')
  expect(fields).toMatchObject({ lang: 'ja', title: 'Japanese', summary: '', translations: undefined })
  expect(fields).not.toHaveProperty('thumbnailCid')
  expect(fields).not.toHaveProperty('thumbnailUrl')
  expect(fields).not.toHaveProperty('media')
  expect(fields).not.toHaveProperty('groupId')
  expect(draftToFields(emptyDraft(), 'en')).toMatchObject({ lang: 'en', title: '', summary: '', tags: [] })
})
