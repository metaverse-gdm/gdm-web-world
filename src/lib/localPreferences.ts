import { compareStrings, stableStringify } from './wireSign'
import { bounded, hasOnly, isObject, LIMITS, validCid, validDate, validId, validProjectLanguages } from './wires'
import type { ProjectFields, ProjectText } from './wires'

const KEY = 'gdm-world:preferences:v1'
export type Theme = 'light' | 'dark'
export type Draft = ProjectText & Pick<ProjectFields, 'lang' | 'translations' | 'thumbnailCid' | 'thumbnailUrl'> & {
  url: string; repoUrl: string; tags: string
}
type Entry<T> = { at: number; value: T }
type Preferences = {
  v: 1; displayName?: Entry<string>; theme?: Entry<Theme>; drafts: Record<string, Entry<Draft | null>>
}
export const emptyDraft = (): Draft => ({ title: '', summary: '', description: '', url: '', repoUrl: '', tags: '' })
const emptyPreferences = (): Preferences => ({ v: 1, drafts: {} })
const validTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark'
const validSlot = (slot: string) => slot === 'new' || validId(slot)
const validDraft = (value: unknown): value is Draft => isObject(value)
  && hasOnly(value, ['title', 'summary', 'description', 'lang', 'translations', 'url', 'repoUrl', 'tags', 'thumbnailCid', 'thumbnailUrl'])
  && validProjectLanguages(value, true)
  && bounded(value.title, LIMITS.title, true) && bounded(value.summary, LIMITS.summary, true)
  && bounded(value.description, LIMITS.description, true) && bounded(value.url, LIMITS.url, true)
  && bounded(value.repoUrl, LIMITS.url, true) && bounded(value.tags, LIMITS.tags * (LIMITS.tag + 2), true)
  && (value.thumbnailCid === undefined || validCid(value.thumbnailCid))
  && (value.thumbnailUrl === undefined || value.thumbnailCid === undefined && bounded(value.thumbnailUrl, LIMITS.url, true))

function entry<T>(value: unknown, check: (v: unknown) => v is T): value is Entry<T> {
  return isObject(value) && hasOnly(value, ['at', 'value']) && validDate(value.at) && check(value.value)
}
const validName = (value: unknown): value is string => bounded(value, LIMITS.displayName, true)
const draftValue = (value: unknown): value is Draft | null => value === null || validDraft(value)

function parsePreferences(value: unknown): Preferences {
  if (!isObject(value) || !hasOnly(value, ['v', 'displayName', 'theme', 'drafts']) || value.v !== 1 || !isObject(value.drafts)
    || (value.displayName !== undefined && !entry(value.displayName, validName))
    || (value.theme !== undefined && !entry(value.theme, validTheme))) throw new Error('Invalid local preferences')
  const drafts: Preferences['drafts'] = {}
  for (const [slot, draft] of Object.entries(value.drafts)) {
    if (!validSlot(slot) || !entry(draft, draftValue)) throw new Error('Invalid draft')
    drafts[slot] = draft
  }
  return { v: 1, displayName: value.displayName, theme: value.theme, drafts }
}

function newer<T>(a?: Entry<T>, b?: Entry<T>): Entry<T> | undefined {
  if (!a || !b) return a ?? b
  return (a.at - b.at || compareStrings(stableStringify(a.value), stableStringify(b.value))) >= 0 ? a : b
}
function mergePreferences(a: Preferences, b: Preferences): Preferences {
  const drafts: Preferences['drafts'] = {}
  for (const slot of [...new Set([...Object.keys(a.drafts), ...Object.keys(b.drafts)])].sort()) {
    const next = newer(a.drafts[slot], b.drafts[slot])
    if (next) drafts[slot] = next
  }
  return { v: 1, displayName: newer(a.displayName, b.displayName), theme: newer(a.theme, b.theme), drafts }
}

export function createLocalPreferences() {
  let state = emptyPreferences()
  let readable = false
  const listeners = new Set<() => void>()
  function read() {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw !== null) state = mergePreferences(state, parsePreferences(JSON.parse(raw)))
      readable = true
    } catch { /* Keep the live state and leave the unreadable copy untouched. */ }
  }
  function update(next: () => Preferences) {
    const before = stableStringify(state)
    read()
    state = mergePreferences(state, next())
    if (before === stableStringify(state)) return
    if (readable) try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* Best effort. */ }
    for (const callback of listeners) callback()
  }
  read()
  const stamp = (previous?: number) => Math.max(Date.now(), (previous ?? 0) + 1)
  return {
    get: () => state,
    setName(value: string) {
      if (validName(value)) update(() => ({ ...emptyPreferences(), displayName: { at: stamp(state.displayName?.at), value } }))
    },
    setTheme(value: Theme) {
      update(() => ({ ...emptyPreferences(), theme: { at: stamp(state.theme?.at), value } }))
    },
    setDraft(slot: string, value: Draft | null) {
      if (validSlot(slot) && draftValue(value)) {
        update(() => ({ v: 1, drafts: { [slot]: { at: stamp(state.drafts[slot]?.at), value } } }))
      }
    },
    subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } },
  }
}
