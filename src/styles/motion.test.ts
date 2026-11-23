import { expect, it, vi } from 'vitest'
import { animateCards, MAX_FLIP_ITEMS } from './motion'

function gridWithCard() {
  const grid = document.createElement('ul')
  const card = grid.appendChild(document.createElement('li'))
  card.dataset.project = 'project-a'
  const animate = vi.fn()
  Object.defineProperty(card, 'animate', { value: animate })
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(new DOMRect(50, 20))
  return { grid, card, animate }
}

it('skips both measurements and animations with reduced motion', () => {
  const { grid, card, animate } = gridWithCard()
  expect(animateCards(grid, new Map(), true, true)).toEqual([])
  expect(card.getBoundingClientRect).not.toHaveBeenCalled()
  expect(animate).not.toHaveBeenCalled()
})

it('inverts a moved card and skips grids with more than 100 items', () => {
  const { grid, animate } = gridWithCard()
  const before = new Map([['project-a', { left: 10, top: 35 }]])
  animateCards(grid, before, false, false)
  expect(animate).toHaveBeenCalledWith(
    [{ transform: 'translate(-40px, 15px)' }, { transform: 'none' }],
    expect.objectContaining({ duration: 280 }),
  )
  animate.mockClear()
  for (let i = 0; i < MAX_FLIP_ITEMS; i++) grid.appendChild(document.createElement('li'))
  expect(animateCards(grid, before, false, false)).toEqual([])
  expect(animate).not.toHaveBeenCalled()
})
