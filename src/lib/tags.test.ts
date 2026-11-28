import { expect, it } from 'vitest'
import { projectsForTag } from './tags'
import type { ProjectRecord } from './wires'

const game = (projectId: string, tags: string[], updatedAt = 10) => ({ projectId, tags, updatedAt }) as ProjectRecord

it('matches only whole tags regardless of case and ranks distinct co-occurring tags', () => {
  const exact = game('a', ['RPG', 'Story', 'Puzzle', 'STORY'])
  const alsoExact = game('b', ['rpg', 'STORY', 'Adventure'], 20)
  const best = game('c', ['story', 'puzzle']) // 2 + 1
  const second = game('d', ['STORY', 'story'], 30) // 2, not 4
  const third = game('e', ['Adventure']) // 1
  const unrelated = game('f', ['JRPG'])
  const result = projectsForTag([third, exact, unrelated, second, alsoExact, best], 'rPg')
  expect(result.matches).toEqual([alsoExact, exact])
  expect(result.similar).toEqual([best, second, third])
})

it('breaks ties by most recent update then project ID and caps related results', () => {
  const exact = game('a', ['target', 'shared'])
  const candidates = Array.from({ length: 15 }, (_, i) => game(String(i).padStart(2, '0'), ['shared'], 1))
  const recent = game('recent', ['shared'], 2)
  expect(projectsForTag([...candidates.reverse(), exact, recent], 'target').similar)
    .toEqual([recent, ...candidates.slice().reverse().slice(0, 11)])
  expect(projectsForTag([exact, recent], 'target', 0).similar).toEqual([])
})

it('returns no related games without exact matches or co-occurrences', () => {
  const exact = game('a', ['シミュレーション'])
  const other = game('b', ['Action'])
  expect(projectsForTag([exact, other], 'missing')).toEqual({ matches: [], similar: [] })
  expect(projectsForTag([exact, other], 'シミュレーション')).toEqual({ matches: [exact], similar: [] })
})
