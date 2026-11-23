export type Theme = 'light' | 'dark'

function readSavedTheme(): Theme | null {
  try {
    const saved = window.localStorage.getItem('tc-theme')
    return saved === 'light' || saved === 'dark' ? saved : null
  } catch {
    return null
  }
}

let chosenTheme = readSavedTheme()
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<(theme: Theme) => void>()

export function getTheme(): Theme {
  return chosenTheme ?? (systemTheme.matches ? 'dark' : 'light')
}

export function setTheme(theme: Theme): void {
  chosenTheme = theme
  document.documentElement.dataset.theme = theme
  try {
    window.localStorage.setItem('tc-theme', theme)
  } catch {
    // The manual choice still applies for this session.
  }
  listeners.forEach(listener => listener(theme))
}

function onSystemChange(): void {
  if (chosenTheme === null) listeners.forEach(listener => listener(getTheme()))
}

export function subscribeTheme(listener: (theme: Theme) => void): () => void {
  if (listeners.size === 0) systemTheme.addEventListener('change', onSystemChange)
  listeners.add(listener)
  listener(getTheme())
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) systemTheme.removeEventListener('change', onSystemChange)
  }
}
