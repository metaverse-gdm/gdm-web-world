import { useContext, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren, JSX } from 'preact'
import { personHref, tagHref } from '../hooks/useHashRoute'
import { useMessages } from '../i18n'
import { isMistlSite, MISTL_RELEASES_URL } from '../lib/mistlSite'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { ToastContext } from './Toast'

export function DateText({ at, dateOnly = false }: { at: number; dateOnly?: boolean }) {
  const iso = new Date(at).toISOString()
  const day = iso.slice(0, 10)
  return <time dateTime={dateOnly ? day : iso}>{day.replaceAll('-', '.')}</time>
}

function PersonDid({ did, delegated, short = false }: { did: string; delegated: boolean; short?: boolean }) {
  return <span class="person-did"><code>{short
    ? <><span class="did-prefix">{did.slice(0, 15)}</span><span>…{did.slice(-6)}</span></>
    : did}</code>
    {delegated && <span class="mistl-badge">mistl</span>}
  </span>
}

export function CopyDid({ did, delegated = false, compact = false }: { did: string; delegated?: boolean; compact?: boolean }) {
  const t = useMessages()
  const showToast = useContext(ToastContext)
  async function copy() {
    try {
      await navigator.clipboard.writeText(did)
      showToast({ message: t.copied, kind: 'status' })
    } catch {
      showToast({ message: t.copyFailed, kind: 'alert' })
    }
  }
  return <button type="button" class={`identity${compact ? ' identity--compact' : ''}`} data-tooltip={compact ? did : t.copyDid}
    aria-label={`${t.copyDid} ${did}`} onClick={() => { void copy() }}>
    <PersonDid did={did} delegated={delegated} short={compact} /><Icon name="copy" />
  </button>
}

export function PersonName({ did, name, avatarCid, delegated = false }: { did: string; name?: string; avatarCid?: string; delegated?: boolean }) {
  const t = useMessages()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return
    const button = trigger.current
    const panel = popup.current
    function place() {
      const rect = button.getBoundingClientRect()
      const { clientWidth, clientHeight } = document.documentElement
      const left = Math.max(12, Math.min(rect.left, clientWidth - panel.offsetWidth - 12))
      panel.style.left = `${left - rect.left}px`
      panel.dataset.placement = clientHeight - rect.bottom < panel.offsetHeight + 12 && rect.top > clientHeight - rect.bottom
        ? 'above' : 'below'
    }
    function close(restoreFocus: boolean) {
      setOpen(false)
      if (restoreFocus) button.focus({ preventScroll: true })
    }
    function dismissOutside(event: MouseEvent) {
      if (!(event.target instanceof Node) || button.contains(event.target) || panel.contains(event.target)) return
      close(document.activeElement === document.body || panel.contains(document.activeElement))
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      close(true)
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('click', dismissOutside, true)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('click', dismissOutside, true)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [open, did])

  return <span class="person-name" onFocusOut={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <button ref={trigger} type="button" class="person-name-trigger" aria-expanded={open} aria-controls={id}
      aria-label={t.viewDid(name ?? `${did.slice(0, 15)}…${did.slice(-6)}`)}
      onClick={() => {
        trigger.current?.focus({ preventScroll: true })
        setOpen(!open)
      }}>
      <Avatar cid={avatarCid} />{name ? <bdi class="person-name-label">{name}</bdi> : <PersonDid did={did} short delegated={false} />}
    </button>
    <span ref={popup} id={id} class="person-name-popup" aria-hidden={!open} inert={!open} data-open={open}>
      <CopyDid did={did} delegated={delegated} />
      <a class="person-page-link" href={personHref(did)} onClick={() => setOpen(false)}>
        <Icon name="user" />{t.personPage}
      </a>
    </span>
  </span>
}

/** A person's name that opens their page, for places where browsing their work is the likely intent. */
export function AuthorLink({ did, name, avatarCid, link = true }: { did: string; name?: string; avatarCid?: string; link?: boolean }) {
  const t = useMessages()
  const Element = link ? 'a' : 'span'
  return <span class="person-name">
    <Element class="person-name-trigger author-link" href={link ? personHref(did) : undefined}
      aria-label={link ? t.viewPerson(name ?? `${did.slice(0, 15)}…${did.slice(-6)}`) : undefined}>
      <Avatar cid={avatarCid} />{name ? <bdi class="person-name-label">{name}</bdi> : <PersonDid did={did} short delegated={false} />}
    </Element>
  </span>
}

export function Tags({ tags, link = true }: { tags: string[]; link?: boolean }) {
  const t = useMessages()
  return tags.length > 0 && <ul class="work-tags" aria-label={t.tags}>
    {tags.map(tag => <li key={tag}>{link
      ? <a href={tagHref(tag)} onClick={event => event.stopPropagation()}>{tag}</a>
      : <span>{tag}</span>}</li>)}
  </ul>
}

export function ExternalLink({ href, primary = false, children, onOpen }: {
  href: string; primary?: boolean; children: ComponentChildren; onOpen?(): void
}) {
  const t = useMessages()
  const track = onOpen && ((event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
    if (!event.defaultPrevented && (event.type === 'auxclick' ? event.button === 1 : event.button === 0)) onOpen()
  })
  return <a class={`button${primary ? ' primary' : ''}`} href={href} target="_blank" rel="noopener noreferrer"
    onClick={track} onAuxClick={track}>
    {children}<Icon name="external" /><span class="sr-only">{t.opensInNewTab}</span>
  </a>
}

/** Shown under a work whose URL is a mistl-hosted site (opens only where mistl runs). */
export function MistlNote({ url }: { url?: string }) {
  const t = useMessages()
  if (!isMistlSite(url)) return null
  return <p class="muted mistl-note">{t.mistlRequired}{' '}
    <a href={MISTL_RELEASES_URL} target="_blank" rel="noopener noreferrer">{t.getMistl}</a></p>
}

export function BackLink({ href = '#/', label }: { href?: string; label?: string }) {
  const t = useMessages()
  return <a class="back-link" href={href}><Icon name="back" />{label ?? t.back}</a>
}

export function EmptyState({ message, children }: { message: string; children?: ComponentChildren }) {
  return <div class="empty-state"><p>{message}</p>{children}</div>
}

export function ErrorText({ message }: { message: string }) {
  return message ? <p class="error" role="alert">{message}</p> : null
}

export function ConfirmDialog({ message, confirm, opener, onClose }: {
  message: string; confirm: string; opener: HTMLButtonElement; onClose(accepted: boolean): void
}) {
  const t = useMessages()
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close() }
  }, [])

  return <dialog ref={dialog} class="confirm-dialog" aria-labelledby="confirm-message"
    onClose={event => {
      opener.focus({ preventScroll: true })
      onClose(event.currentTarget.returnValue === 'confirm')
    }}>
    <form method="dialog" class="form-stack">
      <p id="confirm-message">{message}</p>
      <div class="actions">
        <button value="cancel" autoFocus>{t.cancel}</button>
        <button class="danger" value="confirm">{confirm}</button>
      </div>
    </form>
  </dialog>
}
