import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { createRuntime } from './lib/runtime'
import type { Runtime } from './lib/runtime'
import type { NetworkView } from './lib/network'
import type { ProjectRecord } from './lib/wires'
import { personId } from './lib/wires'
import { isCatalogRoute, useHashRoute } from './hooks/useHashRoute'
import { BackLink, CopyDid, EmptyState, ErrorText, PersonName } from './components/common'
import { CatalogPage } from './components/Catalog'
import { ProjectDialog } from './components/ProjectDialog'
import { ApprovalPrompt, ProjectForm } from './components/ProjectForm'
import { AdminPage } from './components/Admin'
import { SettingsPage } from './components/Settings'
import { Icon } from './components/Icon'
import { ToastProvider } from './components/Toast'
import { documentLanguages, getInitialLanguage, LanguageContext, languageNames, languages, persistLanguage, useMessages } from './i18n'
import type { Language } from './i18n'
import { getTheme, setTheme, subscribeTheme } from './theme'

function Header({ runtime, page, lang, setLang }: {
  runtime?: Runtime; page: string; lang: Language; setLang(language: Language): void
}) {
  const t = useMessages()
  const [theme, updateTheme] = useState(getTheme)
  useLayoutEffect(() => subscribeTheme(updateTheme), [])
  const themeLabel = theme === 'dark' ? t.light : t.dark
  const network: NetworkView = runtime?.getNetwork() ?? { status: 'joining', peers: 0 }
  const statusLabel = `${t[network.status]} · ${t.peers(network.peers)}`
  const self = runtime?.getSelf()
  const role = self && runtime?.getCatalog().roles.get(self.id)
  const name = self && runtime?.displayNameFor(self.id)

  return <header class="site-header">
    <div class="site-shell header-inner">
      <a class="site-brand" href="#/" aria-current={page === 'catalog' ? 'page' : undefined}>
        <img src={`${import.meta.env.BASE_URL}brand-icon-32.png`} width="32" height="32" alt="" />GDM World
      </a>
      <div class="header-controls">
        <div class="language-switcher" role="group" aria-label={t.language}>
          {languages.map(language => <button type="button" key={language} lang={documentLanguages[language]}
            aria-pressed={lang === language} onClick={() => setLang(language)}>{languageNames[language]}</button>)}
        </div>
        <button class="icon-button theme-toggle" type="button" aria-label={themeLabel} data-tooltip={themeLabel}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
      </div>
      <div class="app-controls">
        <span class="network" role="status" data-status={network.status} data-tooltip={statusLabel}>
          <span class="status-dot" aria-hidden="true" /><span aria-hidden="true">{network.peers}</span><span class="sr-only">{statusLabel}</span>
        </span>
        {self && (name
          ? <PersonName did={self.id} name={name} delegated={!!self.delegation} />
          : <CopyDid did={self.id} delegated={!!self.delegation} compact />)}
        <nav class="app-nav" aria-label={t.navigation}>
          {role && <a class="icon-button" href="#/new" aria-current={page === 'new' ? 'page' : undefined}
            aria-label={t.newProject} data-tooltip={t.newProject}><Icon name="plus" /></a>}
          {role === 'admin' && <a class="icon-button" href="#/admin" aria-current={page === 'admin' ? 'page' : undefined}
            aria-label={t.admin} data-tooltip={t.admin}><Icon name="shield" /></a>}
          <a class="icon-button" href="#/settings" aria-current={page === 'settings' ? 'page' : undefined}
            aria-label={t.settings} data-tooltip={t.settings}><Icon name="settings" /></a>
        </nav>
      </div>
    </div>
  </header>
}

function AppShell({ route, runtime, failed, lang, setLang }: {
  route: ReturnType<typeof useHashRoute>; runtime?: Runtime; failed: boolean; lang: Language; setLang(language: Language): void
}) {
  const t = useMessages()
  const catalogRoute = isCatalogRoute(route)
  const routeKey = catalogRoute ? 'catalog' : `${route.page}:${route.id ?? ''}`
  const detailId = route.page === 'detail' ? route.id : undefined
  const [modalId, setModalId] = useState(detailId)
  // Keep the dialog mounted when Back reveals the catalog, until its exit animation finishes.
  const nextModalId = catalogRoute ? detailId ?? modalId : undefined
  if (modalId !== nextModalId) setModalId(nextModalId)
  const removeModal = useCallback(() => setModalId(undefined), [])
  const previousRoute = useRef(routeKey)
  const main = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (previousRoute.current === routeKey) return
    previousRoute.current = routeKey
    main.current?.focus({ preventScroll: true })
  }, [routeKey])
  let content: ComponentChildren
  let canRequest = false
  let project: ProjectRecord | undefined
  if (failed) content = <ErrorText message={t.startupError} />
  else if (!runtime) content = <p class="loading" role="status">{t.loading}</p>
  else {
    const catalog = runtime.getCatalog()
    const self = runtime.getSelf()
    const role = catalog.roles.get(self.id)
    const projectId = nextModalId ?? route.id
    if (projectId) project = catalog.projects.get(projectId)
    canRequest = !role
    const denied = <EmptyState message={t.denied}><BackLink /></EmptyState>
    switch (route.page) {
      case 'catalog':
      case 'detail': content = <CatalogPage projects={catalog.projects} displayNameFor={runtime.displayNameFor}
        trackProject={runtime.trackProject} impressionsActive={!nextModalId} />; break
      case 'new': content = role ? <ProjectForm runtime={runtime} /> : <ApprovalPrompt runtime={runtime} />; break
      case 'edit': content = role && project && personId(project) === self.id
        ? <ProjectForm runtime={runtime} project={project} /> : denied; break
      case 'admin': content = role === 'admin' ? <AdminPage runtime={runtime} /> : denied; break
      case 'settings': content = <SettingsPage runtime={runtime} />; break
      default: content = denied
    }
  }
  return <ToastProvider>
    <a class="skip-link" href="#main-content" onClick={event => {
      event.preventDefault()
      main.current?.focus({ preventScroll: true })
      main.current?.scrollIntoView({ block: 'start' })
    }}>{t.skip}</a>
    <Header runtime={runtime} page={route.page} lang={lang} setLang={setLang} />
    <main id="main-content" tabIndex={-1} class="site-shell" ref={main}>
      <div class="route-view" key={routeKey}>{content}</div>
    </main>
    {nextModalId && <ProjectDialog key={nextModalId} projectId={nextModalId} active={!!detailId}
      project={project} runtime={runtime} failed={failed} onExit={removeModal} />}
    <footer class="site-shell site-footer">
      <span>© GDM World</span>
      <ul class="footer-links">
        {canRequest && route.page !== 'new' && <li><a href="#/new">{t.requestAccess}</a></li>}
        <li><a href="https://github.com/tik-choco" target="_blank" rel="noopener noreferrer">GitHub<span class="sr-only">{t.opensInNewTab}</span></a></li>
      </ul>
    </footer>
  </ToastProvider>
}

export function App() {
  const route = useHashRoute()
  const [lang, setLang] = useState(getInitialLanguage)
  const [runtime, setRuntime] = useState<Runtime>()
  const [failed, setFailed] = useState(false)
  const [, refresh] = useState(0)
  useLayoutEffect(() => { persistLanguage(lang) }, [lang])
  useEffect(() => {
    const ready = requestAnimationFrame(() => { document.documentElement.dataset.ready = '' })
    return () => cancelAnimationFrame(ready)
  }, [])
  useEffect(() => {
    let active = true
    let stop: (() => void) | undefined
    void createRuntime().then(next => {
      if (!active) { next.dispose(); return }
      const unsubscribe = next.subscribe(() => refresh(value => value + 1))
      stop = () => { unsubscribe(); next.dispose() }
      setRuntime(next)
    }).catch(reason => {
      console.error('app startup', reason)
      if (active) setFailed(true)
    })
    return () => { active = false; stop?.() }
  }, [])

  return <LanguageContext.Provider value={lang}>
    <AppShell route={route} runtime={runtime} failed={failed} lang={lang} setLang={setLang} />
  </LanguageContext.Provider>
}
