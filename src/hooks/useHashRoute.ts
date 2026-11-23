import { useLayoutEffect, useState } from 'preact/hooks'
import { validId } from '../lib/wires'

export function readRoute(hash: string) {
  if (!hash || hash === '#/' || hash === '#') return { page: 'catalog' } as const
  if (hash === '#/new') return { page: 'new' } as const
  if (hash === '#/admin') return { page: 'admin' } as const
  if (hash === '#/settings') return { page: 'settings' } as const
  const match = /^#\/(p|edit)\/([^/]+)$/.exec(hash)
  if (match && validId(match[2])) return { page: match[1] === 'p' ? 'detail' : 'edit', id: match[2] } as const
  return { page: 'missing' } as const
}

export function isCatalogRoute({ page }: ReturnType<typeof readRoute>) {
  return page === 'catalog' || page === 'detail'
}

export function openProjectFromCatalog(projectId: string) {
  const hash = `#/p/${projectId}`
  history.pushState({ catalogProject: hash }, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function closeProjectRoute(projectId: string) {
  const hash = `#/p/${projectId}`
  if (location.hash !== hash) return
  if (history.state?.catalogProject === hash) history.back()
  else {
    history.replaceState(history.state, '', '#/')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => readRoute(location.hash))
  useLayoutEffect(() => {
    let previous = readRoute(location.hash)
    function changed() {
      const next = readRoute(location.hash)
      if (!isCatalogRoute(previous) || !isCatalogRoute(next)) window.scrollTo(0, 0)
      previous = next
      setRoute(next)
    }
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  return route
}
