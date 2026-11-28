import { expect, it } from 'vitest'
import { isCatalogRoute, readRoute, tagHref } from './useHashRoute'
import { LIMITS } from '../lib/wires'

it.each(['RPG', '日本語', '中文 游戏', 'A/B & C#100%', '🎮'])('round-trips tag %s through a catalog route', tag => {
  const route = readRoute(tagHref(tag))
  expect(route).toEqual({ page: 'tag', id: tag })
  expect(isCatalogRoute(route)).toBe(true)
})

it.each(['#/tag/', '#/tag', '#/tag/a/b', '#/tag/%ZZ', '#/tag/%E0%A4', '#/tag/%20', '#/tag/%20abc', `#/tag/${'a'.repeat(LIMITS.tag + 1)}`])('rejects malformed tag route %s', hash => {
  expect(readRoute(hash)).toEqual({ page: 'missing' })
})
