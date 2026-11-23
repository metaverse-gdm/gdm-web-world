import { useContext, useEffect, useId, useLayoutEffect, useState } from 'preact/hooks'
import { documentLanguages, LanguageContext, languageNames, languages, useMessages } from '../i18n'
import type { Language } from '../i18n'
import type { Runtime } from '../lib/runtime'
import { emptyDraft } from '../lib/localPreferences'
import type { Draft } from '../lib/localPreferences'
import { saveThumbnail } from '../lib/thumbnails'
import { isHttpsUrl, isHttpUrl, LIMITS } from '../lib/wires'
import type { ProjectRecord, ProjectText } from '../lib/wires'
import { useAction } from '../hooks/useAction'
import { BackLink, CopyDid, ErrorText } from './common'
import { FilePicker } from './FilePicker'
import { showAdvancedSettings } from './Settings'
import { mergeTags, TagInput } from './TagInput'
import { Thumbnail } from './Thumbnail'
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
  const { title, summary, description, lang, translations, url, repoUrl, tags, thumbnailCid, thumbnailUrl } = project
  return { title, summary, description, lang, translations, url, repoUrl: repoUrl ?? '', tags: tags.join(', '), thumbnailCid, thumbnailUrl }
}

const emptyText: ProjectText = { title: '', summary: '', description: '' }
const textFor = (draft: Draft, primary: Language, language: Language): ProjectText =>
  language === primary ? draft : draft.translations?.[language] ?? emptyText
const hasText = ({ title, summary, description }: ProjectText) => !!(title.trim() || summary.trim() || description.trim())
type TextIssue = { language: Language; field: 'title' | 'summary' }

export function ProjectForm({ runtime, project }: { runtime: Runtime; project?: ProjectRecord }) {
  const t = useMessages()
  const uiLanguage = useContext(LanguageContext)
  const ids = useId()
  const slot = project?.projectId ?? 'new'
  const baseline = project ? fromProject(project) : emptyDraft()
  const load = () => runtime.preferences.get().drafts[slot]?.value ?? baseline
  const draft = load()
  const [defaultLanguage] = useState(uiLanguage)
  const primary = draft.lang ?? [defaultLanguage, ...languages].find(language => !draft.translations?.[language]) ?? defaultLanguage
  const [tab, setTab] = useState(primary)
  const [issue, setIssue] = useState<TextIssue>()
  const [pendingTag, setPendingTag] = useState('')
  const form = useAction()
  const upload = useAction()
  const [picked, setPicked] = useState<{ cid: string; name: string }>()
  const [invalidImageUrl, setInvalidImageUrl] = useState(false)
  const [failedImageUrl, setFailedImageUrl] = useState<string>()
  const [autoPreview, setAutoPreview] = useState<string>()
  const update = (fields: Partial<Draft>) => runtime.preferences.setDraft(slot, { ...load(), ...fields })
  const sourceUrl = draft.thumbnailUrl?.trim()
  const imageUrl = isHttpsUrl(sourceUrl) ? sourceUrl : undefined
  const projectUrl = draft.url.trim()
  const autoUrl = !draft.thumbnailCid && !sourceUrl && isHttpUrl(projectUrl) ? projectUrl : undefined
  const tabId = (language: Language) => `${ids}-tab-${language}`
  const panelId = (language: Language) => `${ids}-panel-${language}`
  const imageInputId = ids + '-image'

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

  const currentText = textFor(draft, primary, tab)
  const textIssueId = ids + '-text-error'
  const imageErrorId = ids + '-image-error'
  const badImage = invalidImageUrl && !!sourceUrl && !imageUrl
  const failedImage = !!imageUrl && failedImageUrl === imageUrl
  const automatic = autoUrl && autoPreview === autoUrl ? autoPreview : undefined

  return <section class="content-width">
    <BackLink href={project ? `#/p/${project.projectId}` : '#/'} />
    <ValidatedForm class="panel form-stack" aria-label={project ? t.edit : t.newProject} aria-busy={form.busy || upload.busy} onSubmit={event => {
      event.preventDefault()
      const value = load()
      const filled = [primary, ...languages.filter(language => language !== primary)].flatMap(language => {
        const { title, summary, description } = textFor(value, primary, language)
        const text = { title: title.trim(), summary: summary.trim(), description }
        return hasText(text) ? [{ language, text }] : []
      })
      const [main, ...others] = filled
      const incomplete = filled.find(({ text }) => !text.title || !text.summary)
      if (!main || incomplete) {
        const language = incomplete?.language ?? primary
        setTab(language)
        setIssue({ language, field: incomplete?.text.title ? 'summary' : 'title' })
        return
      }
      const thumbnailUrl = value.thumbnailUrl?.trim() || undefined
      if (thumbnailUrl && !isHttpsUrl(thumbnailUrl)) {
        setInvalidImageUrl(true)
        document.getElementById(imageInputId)?.focus()
        return
      }
      setIssue(undefined)
      void form.run(async () => {
        const id = await runtime.saveProject({
          ...main.text, lang: main.language,
          translations: others.length ? Object.fromEntries(others.map(({ language, text }) => [language, text])) : undefined,
          url: value.url.trim(), repoUrl: value.repoUrl.trim() || undefined,
          tags: mergeTags(mergeTags([], value.tags), pendingTag), thumbnailCid: value.thumbnailCid, thumbnailUrl,
        }, project?.projectId)
        runtime.preferences.setDraft(slot, null)
        location.hash = `#/p/${id}`
      })
    }}>
      <fieldset disabled={form.busy || upload.busy} class="form-stack">
        <div class="post-languages">
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
          {languages.map(language => <div key={language} role="tabpanel" id={panelId(language)}
            aria-labelledby={tabId(language)} hidden={language !== tab}>
            {language === tab && <div class="form-stack post-language-fields">
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
            value={draft.url} onInput={e => update({ url: e.currentTarget.value })} /></label>
          <label>{t.repoUrl}<input type="url" maxLength={LIMITS.url} placeholder="https://"
            value={draft.repoUrl} onInput={e => update({ repoUrl: e.currentTarget.value })} /></label>
        </div>
        <TagInput tags={mergeTags([], draft.tags)} pending={pendingTag} onPendingChange={setPendingTag}
          onChange={tags => update({ tags: tags.join(', ') })} />
        <div class="form-columns">
          <FilePicker label={t.thumbnail} choose={t.chooseImage} hint={t.dropImage}
            accept="image/jpeg,image/png,image/webp" disabled={form.busy || upload.busy}
            fileName={picked && picked.cid === draft.thumbnailCid ? picked.name : undefined}
            onPick={file => {
              void upload.run(async () => {
                const cid = await saveThumbnail(file)
                update({ thumbnailCid: cid, thumbnailUrl: undefined })
                setPicked({ cid, name: file.name })
              })
            }} />
          <div class="image-url-field">
            <label>{t.thumbnailUrl}<input id={imageInputId} inputMode="url" maxLength={LIMITS.url} placeholder="https://"
              value={draft.thumbnailUrl ?? ''} aria-invalid={badImage || undefined}
              aria-describedby={badImage || failedImage ? imageErrorId : undefined} onInput={e => {
                const next = e.currentTarget.value
                update(next.trim() ? { thumbnailUrl: next, thumbnailCid: undefined } : { thumbnailUrl: undefined })
                setInvalidImageUrl(false)
                setFailedImageUrl(undefined)
              }} /></label>
            {badImage && <span id={imageErrorId} class="error" role="alert">{t.invalidThumbnailUrl}</span>}
            {failedImage && <span id={imageErrorId} class="muted" role="status">{t.thumbnailLoadFailed}</span>}
          </div>
        </div>
        {(draft.thumbnailCid || imageUrl || automatic) && <div class="draft-image">
          <Thumbnail cid={draft.thumbnailCid} url={imageUrl} projectUrl={automatic} title={currentText.title || draft.title}
            onError={imageUrl ? () => setFailedImageUrl(imageUrl) : undefined} />
          {(draft.thumbnailCid || imageUrl) && <button type="button" onClick={() => {
            update({ thumbnailCid: undefined, thumbnailUrl: undefined })
            setFailedImageUrl(undefined)
          }}>{t.removeImage}</button>}
        </div>}
      </fieldset>
      {upload.busy && <p role="status">{t.savingImage}</p>}
      <ErrorText message={form.error || upload.error} />
      <div class="actions"><button type="submit" class="primary" disabled={form.busy || upload.busy}>{project ? t.saveChanges : t.publish}</button></div>
    </ValidatedForm>
  </section>
}
