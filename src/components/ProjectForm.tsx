import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { documentLanguages, LanguageContext, languageNames, languages, useMessages } from '../i18n'
import type { Language } from '../i18n'
import type { Runtime } from '../lib/runtime'
import { emptyDraft } from '../lib/localPreferences'
import type { Draft } from '../lib/localPreferences'
import { draftToFields, foldLegacyCover } from '../lib/draftMedia'
import { isHttpUrl, LIMITS } from '../lib/wires'
import type { ProjectRecord, ProjectText } from '../lib/wires'
import { useAction } from '../hooks/useAction'
import { aiConfigured, subscribeAiSettings } from '../lib/ai/settings'
import { BackLink, CopyDid, ErrorText } from './common'
import { MediaEditor } from './MediaEditor'
import { ProjectPreviewDialog } from './ProjectPreview'
import { showAdvancedSettings, showAiSettings } from './Settings'
import { Select } from './Select'
import { mergeTags, TagInput } from './TagInput'
import { ToastContext } from './Toast'
import { ValidatedForm } from './ValidatedForm'

export function ApprovalPrompt({ runtime }: { runtime: Runtime }) {
  const t = useMessages()
  const action = useAction()
  const showToast = useContext(ToastContext)
  const self = runtime.getSelf()
  return <section class="content-width">
    <BackLink />
    <div class="panel">
      <p>{t.requestNotice}</p>
      <CopyDid did={self.id} delegated={!!self.delegation} />
      {!self.delegation && <p class="muted"><a href="#/settings" onClick={showAdvancedSettings}>{t.shareApproval}</a></p>}
      <ValidatedForm class="form-stack section-divider" onSubmit={event => {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        void action.run(async () => {
          const requested = await runtime.requestApproval(String(data.get('name') ?? '').trim(), String(data.get('message') ?? '').trim())
          form.reset()
          if (requested) showToast({ message: t.requestSaved, kind: 'status' })
        })
      }}>
        <label>{t.displayName}<input name="name" required maxLength={LIMITS.displayName} defaultValue={runtime.preferences.get().displayName?.value ?? ''} /></label>
        <label>{t.message}<textarea name="message" rows={4} maxLength={LIMITS.request}
          aria-describedby="public-message" /></label>
        <p class="muted" id="public-message">{t.publicRequest}</p>
        <ErrorText message={action.error} />
        <div><button type="submit" class="primary" disabled={action.busy}>{t.requestAccess}</button></div>
      </ValidatedForm>
    </div>
  </section>
}

function fromProject(project: ProjectRecord): Draft {
  const { title, summary, description, lang, translations, url, repoUrl, tags, thumbnailCid, thumbnailUrl, media, groupId } = project
  return foldLegacyCover({ title, summary, description, lang, translations, url, repoUrl: repoUrl ?? '', tags: tags.join(', '), thumbnailCid, thumbnailUrl, media, groupId })
}

const emptyText: ProjectText = { title: '', summary: '', description: '' }
const textFor = (draft: Draft, primary: Language, language: Language): ProjectText =>
  language === primary ? draft : draft.translations?.[language] ?? emptyText
const hasText = ({ title, summary, description }: ProjectText) => !!(title.trim() || summary.trim() || description.trim())
const sameText = (a: ProjectText, b: ProjectText) => a.title === b.title && a.summary === b.summary && a.description === b.description
type TextIssue = { language: Language; field: 'title' | 'summary' }

export function ProjectForm({ runtime, project }: { runtime: Runtime; project?: ProjectRecord }) {
  const t = useMessages()
  const uiLanguage = useContext(LanguageContext)
  const ids = useId()
  const slot = project?.projectId ?? 'new'
  const baseline = project ? fromProject(project) : emptyDraft()
  const stored = runtime.preferences.get().drafts[slot]?.value
  const load = () => foldLegacyCover(runtime.preferences.get().drafts[slot]?.value ?? baseline)
  const draft = load()
  const [defaultLanguage] = useState(uiLanguage)
  const primary = draft.lang ?? [defaultLanguage, ...languages].find(language => !draft.translations?.[language]) ?? defaultLanguage
  const [tab, setTab] = useState(primary)
  const [issue, setIssue] = useState<TextIssue>()
  const [pendingTag, setPendingTag] = useState('')
  const form = useAction()
  const [mediaBusy, setMediaBusy] = useState(false)
  const translation = useAction()
  const [needsAiSettings, setNeedsAiSettings] = useState(false)
  const mounted = useRef(true)
  const [autoPreview, setAutoPreview] = useState<string>()
  const [previewing, setPreviewing] = useState(false)
  const update = (fields: Partial<Draft>) => runtime.preferences.setDraft(slot, { ...load(), ...fields })
  const projectUrl = draft.url.trim()
  const autoUrl = !draft.media?.length && isHttpUrl(projectUrl) ? projectUrl : undefined
  const tabId = (language: Language) => `${ids}-tab-${language}`
  const panelId = (language: Language) => `${ids}-panel-${language}`
  const canTranslate = !!draft.title.trim()
  const self = runtime.getSelf().id
  const myGroups = [...runtime.getCatalog().groups.values()].filter(group => group.members.includes(self))
  // A group the author has since left is dropped rather than blocking the save.
  const groupId = myGroups.some(group => group.record.groupId === draft.groupId) ? draft.groupId : undefined
  const emptyLanguages = languages.filter(language => language !== primary && !hasText(textFor(draft, primary, language)))

  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => subscribeAiSettings(() => {
    if (aiConfigured()) setNeedsAiSettings(false)
  }), [])

  useEffect(() => {
    if (stored && ('thumbnailCid' in stored || 'thumbnailUrl' in stored)) {
      const latest = runtime.preferences.get().drafts[slot]?.value
      if (latest === stored) runtime.preferences.setDraft(slot, foldLegacyCover(stored))
    }
  }, [runtime, slot, stored])

  useEffect(() => {
    if (!autoUrl) return
    const timer = setTimeout(() => setAutoPreview(autoUrl), 350)
    return () => clearTimeout(timer)
  }, [autoUrl])
  useLayoutEffect(() => {
    if (issue) document.getElementById(`${ids}-panel-${issue.language}-${issue.field}`)?.focus()
  }, [ids, issue])

  function editText(field: keyof ProjectText, value: string) {
    const current = load()
    if (tab === primary) update({ lang: primary, [field]: value })
    else update({
      lang: primary,
      translations: { ...current.translations, [tab]: { ...textFor(current, primary, tab), [field]: value } },
    })
    if (issue?.language === tab && issue.field === field) setIssue(undefined)
  }

  function translateTargets(targets: Language[], bulk: boolean) {
    if (translation.busy || form.busy || mediaBusy) return
    void translation.run(async () => {
      if (!aiConfigured()) {
        setNeedsAiSettings(true)
        return
      }
      setNeedsAiSettings(false)
      const { title, summary, description } = load()
      const source = { title, summary, description }
      if (!source.title.trim()) return
      for (const target of targets) {
        if (!mounted.current) return
        const before = textFor(load(), primary, target)
        if (hasText(before) && (bulk || !window.confirm(t.aiTranslateOverwrite(languageNames[target])))) continue
        const { translateProjectText } = await import('../lib/ai/translate')
        const translated = await translateProjectText(source, primary, target)
        if (!mounted.current) return
        const latest = load()
        if (latest.lang && latest.lang !== primary) throw new Error(t.aiTranslationChanged)
        const current = textFor(latest, primary, target)
        // Bulk never overwrites a nonempty tab, even if it was filled while
        // awaiting the provider. Single-tab confirmation covers only the text
        // that was present when the request was sent.
        if (bulk && hasText(current)) continue
        if (!sameText(before, current)) throw new Error(t.aiTranslationChanged)
        runtime.preferences.setDraft(slot, {
          ...latest, lang: primary, translations: { ...latest.translations, [target]: translated },
        })
        setIssue(previous => previous?.language === target && translated[previous.field].trim() ? undefined : previous)
      }
    })
  }

  const currentText = textFor(draft, primary, tab)
  const textIssueId = ids + '-text-error'
  const automatic = autoUrl && autoPreview === autoUrl ? autoPreview : undefined

  return <section class="content-width">
    <BackLink href={project ? `#/p/${project.projectId}` : '#/'} />
    <ValidatedForm class="panel form-stack" aria-label={project ? t.edit : t.newProject} aria-busy={form.busy || mediaBusy || translation.busy} onSubmit={event => {
      event.preventDefault()
      if (form.busy || mediaBusy || translation.busy) return
      const fields = draftToFields({ ...load(), groupId }, primary, pendingTag)
      const filled = [{ language: fields.lang ?? primary, text: fields },
        ...languages.flatMap(language => {
          const text = fields.translations?.[language]
          return text ? [{ language, text }] : []
        })]
      const incomplete = filled.find(({ text }) => !text.title || !text.summary)
      if (incomplete) {
        const language = incomplete.language
        setTab(language)
        setIssue({ language, field: incomplete.text.title ? 'summary' : 'title' })
        return
      }
      setIssue(undefined)
      void form.run(async () => {
        const id = await runtime.saveProject(fields, project?.projectId)
        runtime.preferences.setDraft(slot, null)
        location.hash = `#/p/${id}`
      })
    }}>
      <fieldset disabled={form.busy || mediaBusy} class="form-stack">
        <div class="post-languages">
          <div class="row-between">
            <div class="post-tabs" role="tablist" aria-label={t.postLanguages}>
              {languages.map((language, index) => <button type="button" role="tab" key={language} id={tabId(language)}
                lang={documentLanguages[language]} aria-controls={panelId(language)} aria-selected={tab === language}
                tabIndex={tab === language ? 0 : -1} data-filled={hasText(textFor(draft, primary, language))}
                onClick={() => setTab(language)} onKeyDown={event => {
                  const next = event.key === 'ArrowLeft' ? (index + languages.length - 1) % languages.length
                    : event.key === 'ArrowRight' ? (index + 1) % languages.length
                      : event.key === 'Home' ? 0 : event.key === 'End' ? languages.length - 1 : undefined
                  if (next === undefined) return
                  event.preventDefault()
                  setTab(languages[next])
                  document.getElementById(tabId(languages[next]))?.focus()
                }}>{languageNames[language]}</button>)}
            </div>
            {canTranslate && <button type="button" disabled={translation.busy || !emptyLanguages.length}
              onClick={() => translateTargets(emptyLanguages, true)}>{t.aiTranslateEmpty}</button>}
          </div>
          {canTranslate && <p class="muted">{t.aiReview}</p>}
          {translation.busy && <p role="status" class="muted">{t.aiTranslating}</p>}
          {needsAiSettings && <p class="muted" role="status">{t.aiNotConfigured} <a href="#/settings" onClick={showAiSettings}>{t.aiOpenSettings}</a></p>}
          <ErrorText message={translation.error} />
          {languages.map(language => <div key={language} role="tabpanel" id={panelId(language)}
            aria-labelledby={tabId(language)} hidden={language !== tab}>
            {language === tab && <div class="form-stack post-language-fields">
              {language !== primary && canTranslate && <div><button type="button" disabled={translation.busy}
                onClick={() => translateTargets([language], false)}>{t.aiTranslateFrom(languageNames[primary])}</button></div>}
              {issue?.language === tab && <p id={textIssueId} class="error" role="alert">{t.missingPostField(languageNames[tab], t[issue.field])}</p>}
              <label>{t.title}<input id={panelId(tab) + '-title'} lang={documentLanguages[tab]} maxLength={LIMITS.title}
                aria-invalid={issue?.language === tab && issue.field === 'title' || undefined}
                aria-describedby={issue?.language === tab && issue.field === 'title' ? textIssueId : undefined}
                value={currentText.title} onInput={e => editText('title', e.currentTarget.value)} /></label>
              <label>{t.summary}<textarea id={panelId(tab) + '-summary'} lang={documentLanguages[tab]} rows={2} maxLength={LIMITS.summary}
                aria-invalid={issue?.language === tab && issue.field === 'summary' || undefined}
                aria-describedby={issue?.language === tab && issue.field === 'summary' ? textIssueId : undefined}
                value={currentText.summary} onInput={e => editText('summary', e.currentTarget.value)} /></label>
              <label>{t.description}<textarea lang={documentLanguages[tab]} rows={7} maxLength={LIMITS.description}
                value={currentText.description} onInput={e => editText('description', e.currentTarget.value)} /></label>
            </div>}
          </div>)}
        </div>
        <div class="form-columns">
          <label>{t.projectUrl}<input type="url" required maxLength={LIMITS.url} placeholder="https://"
            value={draft.url} onInput={e => update({ url: e.currentTarget.value })} />
            <small class="muted field-hint">{t.projectUrlHint}</small></label>
          <label>{t.repoUrl}<input type="url" maxLength={LIMITS.url} placeholder="https://"
            value={draft.repoUrl} onInput={e => update({ repoUrl: e.currentTarget.value })} /></label>
        </div>
        <TagInput tags={mergeTags([], draft.tags)} pending={pendingTag} onPendingChange={setPendingTag}
          onChange={tags => update({ tags: tags.join(', ') })} />
        {myGroups.length > 0 && <Select label={t.group} value={groupId ?? ''} onChange={value => update({ groupId: value || undefined })}
          options={[{ value: '', label: t.noGroup }, ...myGroups.map(group => ({ value: group.record.groupId, label: group.record.name }))]} />}
        <MediaEditor key={slot} items={draft.media ?? []} title={currentText.title || draft.title}
          autoPreviewUrl={automatic} disabled={form.busy || mediaBusy} onBusyChange={setMediaBusy}
          onChange={media => update({ media: media.length ? media : undefined })} />
      </fieldset>
      <ErrorText message={form.error} />
      <div class="actions">
        <button type="submit" class="primary" disabled={form.busy || mediaBusy || translation.busy}>{project ? t.saveChanges : t.publish}</button>
        <button type="button" onClick={() => setPreviewing(true)}>{t.preview}</button>
      </div>
      {previewing && <ProjectPreviewDialog fields={draftToFields({ ...draft, groupId }, primary, pendingTag)}
        authorDid={self} authorName={runtime.displayNameFor(self)}
        group={myGroups.find(group => group.record.groupId === groupId)} onClose={() => setPreviewing(false)} />}
    </ValidatedForm>
  </section>
}
