import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useMessages } from '../i18n'
import type { GroupView } from '../lib/catalogStore'
import type { ProjectFields } from '../lib/wires'
import { Icon } from './Icon'
import { ProjectCardView } from './ProjectCard'
import { ProjectDetailBody } from './ProjectDetail'
import '../styles/project-preview.css'

const views = ['detail', 'card'] as const

export function ProjectPreviewDialog({ fields, updatedAt, authorDid, authorName, authorAvatarCid, group, onClose }: {
  fields: ProjectFields; updatedAt?: number; authorDid: string; authorName?: string; authorAvatarCid?: string; group?: GroupView; onClose(): void
}) {
  const t = useMessages()
  const id = useId()
  const titleId = `${id}-title`
  const noticeId = `${id}-notice`
  const tabId = (view: typeof views[number]) => `${id}-tab-${view}`
  const panelId = (view: typeof views[number]) => `${id}-panel-${view}`
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement>()
  const backdropPressed = useRef(false)
  const [tab, setTab] = useState<typeof views[number]>('detail')
  const [openedAt] = useState(Date.now)
  const data = { fields, updatedAt: updatedAt ?? openedAt, authorDid, authorName, authorAvatarCid, group, preview: true }

  useLayoutEffect(() => {
    const element = dialog.current!
    const active = document.activeElement
    if (active instanceof HTMLElement) opener.current = active
    element.showModal()
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      if (element.open) element.close()
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
    }
  }, [])

  function dismiss() {
    if (!dialog.current?.open) return
    dialog.current.close()
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
    opener.current = undefined
    onClose()
  }

  return <dialog ref={dialog} class="project-dialog project-preview" aria-labelledby={titleId} aria-describedby={noticeId}
    onPointerDownCapture={event => { backdropPressed.current = event.target === event.currentTarget }}
    onPointerCancel={() => { backdropPressed.current = false }}
    onClick={event => {
      const pressed = backdropPressed.current
      backdropPressed.current = false
      if (pressed && event.target === event.currentTarget) dismiss()
    }}
    onCancel={event => {
      if (event.target !== event.currentTarget) return
      event.preventDefault()
      dismiss()
    }}>
    <div class="project-dialog-panel">
      <header class="row-between project-preview-header">
        <h2 id={titleId}>{t.previewTitle}</h2>
        <button ref={closeButton} type="button" class="icon-button" aria-label={t.close} autoFocus onClick={dismiss}>
          <Icon name="close" />
        </button>
      </header>
      <div class="project-preview-controls">
        <p id={noticeId} class="project-preview-notice">{t.previewNotice}</p>
        <div role="tablist" class="project-preview-tabs" aria-label={t.preview}>
          {views.map((view, index) => <button key={view} type="button" role="tab" id={tabId(view)}
            aria-selected={tab === view} aria-controls={panelId(view)} tabIndex={tab === view ? 0 : -1}
            onClick={() => setTab(view)} onKeyDown={event => {
              const next = event.key === 'ArrowLeft' ? (index + views.length - 1) % views.length
                : event.key === 'ArrowRight' ? (index + 1) % views.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : undefined
              if (next === undefined) return
              event.preventDefault()
              setTab(views[next])
              document.getElementById(tabId(views[next]))?.focus()
            }}>{view === 'detail' ? t.previewDetail : t.previewCard}</button>)}
        </div>
      </div>
      <section role="tabpanel" id={panelId('detail')} aria-labelledby={tabId('detail')} hidden={tab !== 'detail'} tabIndex={0}>
        {tab === 'detail' && <article class="detail"><ProjectDetailBody {...data} /></article>}
      </section>
      <section role="tabpanel" id={panelId('card')} aria-labelledby={tabId('card')} hidden={tab !== 'card'} tabIndex={0}
        class="project-preview-card-panel">
        {tab === 'card' && <div class="project-preview-card"><ProjectCardView {...data} /></div>}
      </section>
    </div>
  </dialog>
}
