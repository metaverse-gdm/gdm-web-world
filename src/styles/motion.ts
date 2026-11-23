type Position = { left: number; top: number }
type Positions = Map<string, Position>

export const MAX_FLIP_ITEMS = 100
export const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

export function measureCards(grid: HTMLElement): Positions {
  const origin = grid.getBoundingClientRect()
  const positions: Positions = new Map()
  for (const card of grid.children) {
    const id = (card as HTMLElement).dataset.project
    if (!id) continue
    const { left, top } = card.getBoundingClientRect()
    positions.set(id, { left: left - origin.left, top: top - origin.top })
  }
  return positions
}

export function animateCards(grid: HTMLElement, before: Positions, firstLoad: boolean, reducedMotion: boolean): Animation[] {
  if (reducedMotion || grid.children.length > MAX_FLIP_ITEMS) return []
  const after = measureCards(grid)
  const style = getComputedStyle(grid)
  const duration = Number.parseFloat(style.getPropertyValue('--duration-page')) || 280
  const easing = style.getPropertyValue('--ease-out').trim() || 'ease-out'
  const animations: Animation[] = []
  for (const [index, element] of Array.from(grid.children).entries()) {
    const id = (element as HTMLElement).dataset.project
    if (!id || typeof element.animate !== 'function') continue
    const first = before.get(id)
    const last = after.get(id)
    if (!last) continue
    if (!first) {
      animations.push(element.animate(
        [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration, easing, delay: firstLoad ? Math.min(index * 24, 144) : 0, fill: 'backwards' },
      ))
      continue
    }
    const x = first.left - last.left
    const y = first.top - last.top
    if (Math.abs(x) >= 0.5 || Math.abs(y) >= 0.5) {
      animations.push(element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], { duration, easing }))
    }
  }
  return animations
}
