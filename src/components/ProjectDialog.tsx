import { useId, useLayoutEffect, useRef } from 'preact/hooks'
import { closeProjectRoute, readRoute } from '../hooks/useHashRoute'
import { useMessages } from '../i18n'
import type { Runtime } from '../lib/runtime'
import type { ProjectRecord } from '../lib/wires'
import { Icon } from './Icon'
import { ProjectDetail } from './ProjectDetail'

export function ProjectDialog({ projectId, project, active, runtime, failed, onExit }: {
  projectId: string; project?: ProjectRecord; active: boolean; runtime?: Runtime; failed: boolean; onExit(): void
}) {
  const t = useMessages()
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const backdropPressed = useRef(false)
  const navigationPending = useRef(false)
  useLayoutEffect(() => {
    const element = dialog.current!
    const opener = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (opener instanceof HTMLAnchorElement && opener.matches('.card-title') && opener.isConnected
        && readRoute(location.hash).page === 'catalog') opener.focus({ preventScroll: true })
    }
  }, [])

  const shownId = project?.projectId
  useLayoutEffect(() => {
    if (active && shownId) runtime?.trackProject(shownId, 'detail')
  }, [active, shownId, runtime])

  useLayoutEffect(() => {
    if (active) return
    navigationPending.current = false
    const animations = dialog.current?.getAnimations?.() ?? []
    let canceled = false
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (!canceled) onExit()
    })
    return () => { canceled = true }
  }, [active, onExit])

  function dismiss() {
    if (!active || navigationPending.current) return
    navigationPending.current = true
    closeProjectRoute(projectId)
  }

  return <dialog ref={dialog} class="project-dialog" aria-labelledby={titleId} data-leaving={!active}
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
      <div class="project-dialog-controls">
        <button type="button" class="icon-button" aria-label={t.close} autoFocus onClick={dismiss}><Icon name="close" /></button>
      </div>
      {runtime && project
        ? <ProjectDetail project={project} runtime={runtime} variant="modal" titleId={titleId} onDeleted={dismiss} />
        : <p id={titleId} class="project-dialog-message" role={failed ? 'alert' : 'status'}>
            {failed ? t.startupError : runtime ? t.missingProject : t.loading}
          </p>}
    </div>
  </dialog>
}
