import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useMessages } from '../i18n'
import { useAction } from '../hooks/useAction'
import { describeMedia, mediaKey, providerNames } from '../lib/media'
import { loadMediaImage, loadThumbnail, saveMediaImage, saveThumbnail } from '../lib/thumbnails'
import { isHttpUrl, isHttpsUrl, LIMITS } from '../lib/wires'
import type { MediaItem } from '../lib/wires'
import { ErrorText } from './common'
import { FilePicker } from './FilePicker'
import { Icon } from './Icon'
import { Thumbnail } from './Thumbnail'
import '../styles/media-editor.css'

type Props = {
  items: MediaItem[]; title: string; disabled?: boolean; autoPreviewUrl?: string
  onChange(items: MediaItem[]): void
  onBusyChange?(busy: boolean): void
}

const imageTypes = 'image/jpeg,image/png,image/webp'
type UrlError = 'invalidMediaUrl' | 'duplicateMedia'
type TileAction = 'earlier' | 'later' | 'remove'

function PreviewImage({ src, alt }: { src?: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  return src && !failed
    ? <img src={src} alt={alt} referrerpolicy="no-referrer" loading="lazy" decoding="async" onError={() => setFailed(true)} />
    : alt ? <span role="img" aria-label={alt} /> : null
}

function MediaPreview({ item, title, index }: { item: MediaItem; title: string; index: number }) {
  const t = useMessages()
  const view = describeMedia(item)
  const cid = view.kind === 'image' ? view.cid : undefined
  const thumb = 'cid' in item ? item.thumb : undefined
  const previewCid = thumb ?? cid
  const [blob, setBlob] = useState<{ cid: string; url: string }>()

  useEffect(() => {
    if (!previewCid) return
    let active = true
    let url: string | undefined
    void (thumb ? loadThumbnail(previewCid) : loadMediaImage(previewCid)).then(next => {
      if (!active) { URL.revokeObjectURL(next); return }
      url = next
      setBlob({ cid: previewCid, url })
    }).catch(() => { /* Leave a neutral preview if the image is unavailable. */ })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [previewCid, thumb])

  const source = view.kind === 'embed' ? view.embed.poster : view.kind === 'image'
    ? previewCid ? (blob?.cid === previewCid ? blob?.url : undefined) : isHttpsUrl(view.url) ? view.url : undefined
    : undefined
  const video = view.kind !== 'image'
  return <div class="media-editor-preview" role={video ? 'img' : undefined}
    aria-label={video ? t.mediaVideoLabel(title, index) : undefined}>
    <PreviewImage key={source} src={source} alt={video ? '' : t.mediaImageAlt(title, index)} />
    {video && <div class="media-editor-video-badge" aria-hidden="true">
      <span class="media-editor-play" />
      <span>{view.kind === 'embed' ? providerNames[view.embed.provider] : t.videoFile}</span>
    </div>}
    <span class="media-editor-index" aria-hidden="true">{index}</span>
  </div>
}

export function MediaEditor({ items, title, disabled, autoPreviewUrl, onChange, onBusyChange }: Props) {
  const t = useMessages()
  const id = useId()
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<UrlError>()
  const [duplicateImage, setDuplicateImage] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const upload = useAction()
  const uploading = useRef(false)
  const mounted = useRef(true)
  const latestItems = useRef(items)
  latestItems.current = items
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const nextFocus = useRef<{ index: number; action: TileAction }>()
  const full = items.length >= LIMITS.media
  const locked = disabled || upload.busy

  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useLayoutEffect(() => {
    const target = nextFocus.current
    if (!target) return
    nextFocus.current = undefined
    const tile = list.current?.children[target.index]
    const button = tile?.querySelector<HTMLButtonElement>(`[data-action="${target.action}"]:not(:disabled)`)
      ?? tile?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    if (button) button.focus()
    else input.current?.focus()
  }, [items])

  function change(next: MediaItem[]) {
    latestItems.current = next
    onChange(next)
  }

  function addUrl() {
    if (locked || uploading.current || latestItems.current.length >= LIMITS.media) return
    const value = url.trim()
    if (!isHttpsUrl(value)) { setUrlError('invalidMediaUrl'); input.current?.focus(); return }
    const item = { url: value }
    if (latestItems.current.some(existing => mediaKey(existing) === mediaKey(item))) {
      setUrlError('duplicateMedia')
      input.current?.focus()
      return
    }
    change([...latestItems.current, item])
    setUrl('')
    setUrlError(undefined)
    input.current?.focus()
  }

  function saveImages(files: File[]) {
    if (locked || uploading.current || !files.length || latestItems.current.length >= LIMITS.media) return
    uploading.current = true
    setDuplicateImage(false)
    setProgress({ done: 0, total: Math.min(files.length, LIMITS.media - latestItems.current.length) })
    onBusyChange?.(true)
    void upload.run(async () => {
      try {
        // A duplicate does not occupy a gallery slot, so keep going until the
        // individual files are processed or the actual gallery is full.
        for (let done = 0; done < files.length && latestItems.current.length < LIMITS.media; done++) {
          const total = Math.min(files.length, done + LIMITS.media - latestItems.current.length)
          setProgress({ done, total })
          const cid = await saveMediaImage(files[done])
          if (!mounted.current) return
          const thumb = await saveThumbnail(files[done]).catch(() => undefined)
          if (!mounted.current) return
          const item = thumb ? { cid, thumb } : { cid }
          const current = latestItems.current
          if (current.some(existing => mediaKey(existing) === mediaKey(item))) setDuplicateImage(true)
          else if (current.length < LIMITS.media) change([...current, item])
          setProgress({ done: done + 1, total })
        }
      } finally {
        uploading.current = false
        if (mounted.current) onBusyChange?.(false)
      }
    })
  }

  function move(index: number, offset: -1 | 1) {
    if (locked || uploading.current) return
    const next = [...latestItems.current]
    const destination = index + offset
    if (destination < 0 || destination >= next.length) return
    ;[next[index], next[destination]] = [next[destination], next[index]]
    nextFocus.current = { index: destination, action: offset === -1 ? 'earlier' : 'later' }
    change(next)
  }

  function setCover(index: number) {
    if (locked || uploading.current || index <= 0) return
    const next = [...latestItems.current]
    const [item] = next.splice(index, 1)
    if (!item) return
    next.unshift(item)
    nextFocus.current = { index: 0, action: 'later' }
    change(next)
  }

  function remove(index: number) {
    if (locked || uploading.current) return
    const next = latestItems.current.filter((_, i) => i !== index)
    nextFocus.current = { index: Math.min(index, next.length - 1), action: 'remove' }
    setDuplicateImage(false)
    change(next)
  }

  return <section class="media-editor" aria-labelledby={`${id}-heading`} onPaste={event => {
    if (locked || uploading.current || full) return
    const images = Array.from(event.clipboardData?.files ?? []).filter(file => imageTypes.split(',').includes(file.type))
    if (!images.length) return
    event.preventDefault()
    saveImages(images)
  }}>
    <div class="media-editor-heading">
      <div class="row-between">
        <h2 id={`${id}-heading`}>{t.media}</h2>
        <span class="muted media-editor-count">{items.length}/{LIMITS.media}</span>
      </div>
      <p class="muted">{t.mediaHint}</p>
    </div>
    <div class="media-editor-url">
      <label>{t.mediaUrl}<input ref={input} type="text" inputMode="url" placeholder="https://" maxLength={LIMITS.url}
        value={url} disabled={locked || full} aria-invalid={urlError ? true : undefined}
        aria-describedby={urlError ? `${id}-url-error` : undefined}
        onInput={event => { setUrl(event.currentTarget.value); setUrlError(undefined) }}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.isComposing) return
          event.preventDefault()
          addUrl()
        }} /></label>
      <button type="button" disabled={locked || full} onClick={addUrl}><Icon name="plus" />{t.addMedia}</button>
      {urlError && <p id={`${id}-url-error`} class="error" role="alert">{t[urlError]}</p>}
    </div>
    <FilePicker choose={t.chooseImages} hint={t.dropImages} accept={imageTypes} multiple disabled={locked || full} onPickMany={saveImages} />
    {upload.busy && <p class="muted" role="status">{t.savingImages(progress.done, progress.total)}</p>}
    <ErrorText message={upload.error} />
    <ErrorText message={duplicateImage ? t.duplicateMedia : ''} />
    {full && <p class="muted" role="status">{t.mediaFull(LIMITS.media)}</p>}
    {items.length === 0 && <div class="media-editor-empty">
      <p class="muted">{t.autoCover}</p>
      {isHttpUrl(autoPreviewUrl) && <div class="media-editor-auto-cover">
        <span class="media-editor-cover-badge">{t.cover}</span>
        <Thumbnail projectUrl={autoPreviewUrl} title={title} />
      </div>}
    </div>}
    {items.length > 0 && <ol ref={list} class="media-editor-grid">
      {items.map((item, index) => <li key={mediaKey(item)} class="media-editor-tile" data-cover={index === 0}>
        <MediaPreview item={item} title={title} index={index + 1} />
        <div class="media-editor-controls">
          <button type="button" class="icon-button" data-action="earlier" aria-label={t.moveEarlier} title={t.moveEarlier}
            disabled={locked || index === 0} onClick={() => move(index, -1)}><Icon name="editorLeft" /></button>
          <button type="button" class="icon-button" data-action="later" aria-label={t.moveLater} title={t.moveLater}
            disabled={locked || index === items.length - 1} onClick={() => move(index, 1)}><Icon name="editorRight" /></button>
          <button type="button" class="icon-button danger" data-action="remove" aria-label={t.removeMedia(index + 1)} title={t.removeMedia(index + 1)}
            disabled={locked} onClick={() => remove(index)}><Icon name="trash" /></button>
          {index === 0 ? <span class="media-editor-cover-badge">{t.cover}</span>
            : <button type="button" class="media-editor-set-cover" data-action="cover" disabled={locked} onClick={() => setCover(index)}>{t.setCover}</button>}
        </div>
      </li>)}
    </ol>}
  </section>
}
