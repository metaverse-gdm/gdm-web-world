import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useMessages } from '../i18n'
import { resolvePreviewImage } from '../lib/linkPreview'
import { describeMedia, mediaKey, providerNames } from '../lib/media'
import type { MediaView, VideoEmbed } from '../lib/media'
import { loadMediaImage, loadThumbnail } from '../lib/thumbnails'
import type { MediaItem } from '../lib/wires'
import { Icon } from './Icon'
import '../styles/media-gallery.css'

type Props = { items: MediaItem[]; title: string; lang?: string }
type Slide = { key: string; view: MediaView; index: number; thumb?: string }
type Sources = ReadonlyMap<string, string | null>

const thumbKey = (slide: Slide) => slide.thumb ? `thumb:${slide.key}` : slide.key

// Share full-size images between stage and lightbox, using smaller blobs for
// the filmstrip. Keep fetched URLs alive until the gallery changes or unmounts.
function useGallerySources(slides: Slide[], index: number, lightboxIndex?: number) {
  const [sources, setSources] = useState<Sources>(() => new Map())
  const requestFull = useRef<(slide: Slide) => void>()
  useEffect(() => {
    let active = true
    const blobs = new Set<string>()
    const retries = new Set<ReturnType<typeof setTimeout>>()
    const requested = new Set<string>()
    function store(key: string, src: string | null) {
      if (active) setSources(previous => new Map(previous).set(key, src))
    }
    async function fetchBlob(key: string, cid: string, thumbnail: boolean, attempt = 0) {
      try {
        const src = await (thumbnail ? loadThumbnail(cid) : loadMediaImage(cid))
        if (!active) { URL.revokeObjectURL(src); return }
        blobs.add(src)
        store(key, src)
      } catch {
        if (!active) return
        if (attempt < 2) {
          const retry = setTimeout(() => {
            retries.delete(retry)
            void fetchBlob(key, cid, thumbnail, attempt + 1)
          }, 5000 * (attempt + 1))
          retries.add(retry)
        } else store(key, null)
      }
    }
    function request(key: string, cid: string, thumbnail = false) {
      if (requested.has(key)) return
      requested.add(key)
      void fetchBlob(key, cid, thumbnail)
    }
    requestFull.current = ({ key, view }) => {
      if (view.kind === 'image' && view.cid) request(key, view.cid)
    }
    for (const slide of new Map(slides.map(slide => [slide.key, slide])).values()) {
      const { key, view, thumb } = slide
      if (slides.length > 1 && view.kind === 'image' && view.cid) {
        if (thumb) request(thumbKey(slide), thumb, true)
        else request(key, view.cid)
      }
      if (view.kind === 'embed' && !view.embed.poster) {
        void resolvePreviewImage(view.embed.watchUrl).then(src => store(key, src), () => store(key, null))
      }
    }
    return () => {
      active = false
      requestFull.current = undefined
      for (const retry of retries) clearTimeout(retry)
      for (const src of blobs) URL.revokeObjectURL(src)
    }
  }, [slides])
  useEffect(() => {
    requestFull.current?.(slides[index])
    if (lightboxIndex !== undefined) requestFull.current?.(slides[lightboxIndex])
  }, [slides, index, lightboxIndex])
  return sources
}

function sourceFor(slide: Slide, sources: Sources, thumb = false) {
  const { key, view } = slide
  if (view.kind === 'image') return view.url ?? sources.get(thumb ? thumbKey(slide) : key)
  if (view.kind === 'embed') return view.embed.poster ?? sources.get(key)
}

function GalleryVisual({ src, fallback, alt = '', lang, thumb, showError }: {
  src?: string | null; fallback: string; alt?: string; lang?: string; thumb?: boolean; showError?: boolean
}) {
  const t = useMessages()
  const [loaded, setLoaded] = useState<string>()
  const [failed, setFailed] = useState<string>()
  const image = src && failed !== src ? src : undefined
  const unavailable = src === null || (!!src && failed === src)
  const visible = !!image && loaded === image
  return <span class="media-gallery-visual">
    <span class="media-gallery-fallback" data-loaded={visible} aria-hidden={image || !alt ? true : undefined}
      role={!image && alt ? 'img' : undefined} aria-label={!image && alt ? alt : undefined}>
      <span lang={lang}>{fallback}</span>
      {showError && unavailable && <small>{t.thumbnailLoadFailed}</small>}
    </span>
    {image && <img key={image} src={image} alt={alt} lang={lang} draggable={false} referrerpolicy="no-referrer"
      decoding="async" loading={thumb ? 'lazy' : 'eager'} data-loaded={visible}
      onLoad={() => setLoaded(image)} onError={() => setFailed(image)} />}
  </span>
}

function EmbedStage({ embed, src, label, lang }: { embed: VideoEmbed; src?: string | null; label: string; lang?: string }) {
  const t = useMessages()
  const [playing, setPlaying] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const provider = providerNames[embed.provider]
  useLayoutEffect(() => {
    if (playing) frame.current?.focus({ preventScroll: true })
  }, [playing])
  if (playing) return <iframe ref={frame} src={embed.embedUrl} title={label} lang={lang} loading="lazy"
    allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerpolicy="strict-origin-when-cross-origin" />
  return <div class="media-gallery-facade">
    <GalleryVisual src={src} fallback={provider} />
    <span class="media-gallery-badge">{provider}</span>
    <button type="button" class="media-gallery-play" aria-label={t.playVideo} onClick={() => setPlaying(true)}><Icon name="play" /></button>
  </div>
}

function arrowDirection(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), video, audio, iframe')) return 0
  return event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
}

function wrap(index: number, count: number) { return (index + count) % count }

function GalleryArrows({ move }: { move(direction: number): void }) {
  const t = useMessages()
  return <>
    <button type="button" class="media-gallery-control media-gallery-prev" aria-label={t.previousMedia} onClick={() => move(-1)}><Icon name="arrowLeft" /></button>
    <button type="button" class="media-gallery-control media-gallery-next" aria-label={t.nextMedia} onClick={() => move(1)}><Icon name="arrowRight" /></button>
  </>
}

function Lightbox({ slides, selected, sources, title, lang, select, dismiss }: {
  slides: Slide[]; selected: number; sources: Sources; title: string; lang?: string; select(index: number): void; dismiss(): void
}) {
  const t = useMessages()
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const backdropPressed = useRef(false)
  const index = slides.findIndex(slide => slide.index === selected)
  const slide = slides[index]
  const initialLetter = Array.from(title.trim())[0] ?? 'G'
  const move = (direction: number) => select(slides[wrap(index + direction, slides.length)].index)
  useLayoutEffect(() => {
    const element = dialog.current!
    const opener = document.activeElement
    element.showModal()
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      if (element.open) element.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  function close() {
    dialog.current?.close()
    dismiss()
  }
  function isBackdrop(target: EventTarget | null) {
    return target === dialog.current || target instanceof Element && target.matches('.media-lightbox-header, .media-lightbox-content, .media-lightbox-content .media-gallery-visual')
  }
  return <dialog ref={dialog} class="media-lightbox" aria-label={t.viewLarger}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close() }}
    onPointerDown={event => { event.stopPropagation(); backdropPressed.current = isBackdrop(event.target) }}
    onPointerCancel={() => { backdropPressed.current = false }}
    onClick={event => {
      event.stopPropagation()
      const pressed = backdropPressed.current
      backdropPressed.current = false
      if (isBackdrop(event.target) && (pressed || event.detail === 0)) close()
    }}
    onKeyDown={event => {
      event.stopPropagation()
      const direction = arrowDirection(event)
      if (direction && slides.length > 1) { event.preventDefault(); move(direction) }
    }}>
    <div class="media-lightbox-header">
      <span class="media-gallery-position" aria-live="polite">{t.mediaPosition(index + 1, slides.length)}</span>
      <button type="button" ref={closeButton} class="media-gallery-control media-lightbox-close" aria-label={t.close} onClick={close}><Icon name="close" /></button>
    </div>
    <div class="media-lightbox-content">
      <GalleryVisual key={slide.key} src={sourceFor(slide, sources)} fallback={initialLetter}
        alt={t.mediaImageAlt(title, slide.index + 1)} lang={lang} showError />
      {slides.length > 1 && <GalleryArrows move={move} />}
    </div>
  </dialog>
}

export function MediaGallery({ items, title, lang }: Props) {
  if (!items.length) return null
  // Reset selection/playback and release old sources when the actual list (not
  // merely its array identity) changes, e.g. after a synced project edit.
  return <GalleryContent key={JSON.stringify(items.map(item => [mediaKey(item), 'cid' in item ? item.thumb : undefined]))} items={items} title={title} lang={lang} />
}

function GalleryContent({ items, title, lang }: Props) {
  const t = useMessages()
  const [slides] = useState(() => items.map((item, index): Slide => ({
    key: mediaKey(item), view: describeMedia(item), index, thumb: 'cid' in item ? item.thumb : undefined,
  })))
  const [index, setIndex] = useState(0)
  const [lightboxIndex, setLightboxIndex] = useState<number>()
  const sources = useGallerySources(slides, index, lightboxIndex)
  const region = useRef<HTMLElement>(null)
  const selectedThumb = useRef<HTMLButtonElement>(null)
  const previousIndex = useRef(0)
  const focusThumb = useRef(false)
  const gesture = useRef<{ id: number; x: number; y: number }>()
  const suppressClick = useRef(false)
  const slide = slides[index]
  const { view } = slide
  const src = sourceFor(slide, sources)
  const initial = Array.from(title.trim())[0] ?? 'G'
  const multiple = slides.length > 1
  const move = (direction: number) => setIndex(previous => wrap(previous + direction, slides.length))
  const provider = view.kind === 'embed' ? providerNames[view.embed.provider] : undefined

  useLayoutEffect(() => {
    if (previousIndex.current === index) return
    previousIndex.current = index
    if (focusThumb.current) selectedThumb.current?.focus({ preventScroll: true })
    focusThumb.current = false
    selectedThumb.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [index])

  return <section ref={region} class="media-gallery" aria-roledescription="carousel" aria-label={t.gallery}
    tabIndex={multiple ? 0 : undefined} onKeyDown={event => {
      const direction = arrowDirection(event)
      if (!direction || !multiple || lightboxIndex !== undefined) return
      event.preventDefault()
      // Keep keyboard focus in the carousel if the focused slide disappears.
      if (event.target instanceof Element) {
        if (event.target.closest('.media-gallery-slide')) region.current?.focus({ preventScroll: true })
        if (event.target.closest('.media-gallery-thumb')) focusThumb.current = true
      }
      move(direction)
    }}>
    <div class="media-gallery-stage">
      <div key={index} class="media-gallery-slide">
        {view.kind === 'image' && <button type="button" class="media-gallery-image" aria-label={t.viewLarger} aria-description={t.mediaImageAlt(title, index + 1)}
          onPointerDown={event => {
            suppressClick.current = false
            gesture.current = event.pointerType === 'touch' && multiple ? { id: event.pointerId, x: event.clientX, y: event.clientY } : undefined
          }}
          onPointerCancel={() => { gesture.current = undefined }}
          onPointerUp={event => {
            const start = gesture.current
            gesture.current = undefined
            if (!start || start.id !== event.pointerId) return
            const dx = event.clientX - start.x
            if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(event.clientY - start.y)) {
              suppressClick.current = true
              move(dx < 0 ? 1 : -1)
            }
          }}
          onClick={event => {
            if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return }
            setLightboxIndex(index)
          }}>
          <GalleryVisual src={src} fallback={initial} alt={t.mediaImageAlt(title, index + 1)} lang={lang} showError />
          <span class="media-gallery-expand" aria-hidden="true"><Icon name="expand" /></span>
        </button>}
        {view.kind === 'embed' && <EmbedStage embed={view.embed} src={src} label={t.mediaVideoLabel(title, index + 1)} lang={lang} />}
        {view.kind === 'video' && <video controls playsinline preload="metadata" src={view.url} aria-label={t.mediaVideoLabel(title, index + 1)} lang={lang} />}
      </div>
      {multiple && <GalleryArrows move={move} />}
    </div>
    <div class="media-gallery-meta">
      <span class="media-gallery-name">{t.gallery}</span>
      {view.kind === 'video' && <span>{t.videoFile}</span>}
      <span class="media-gallery-position" aria-live="polite" aria-atomic="true">{t.mediaPosition(index + 1, slides.length)}</span>
    </div>
    {view.kind === 'embed' && provider && <div class="media-gallery-embed-info">
      <p>{t.embedNotice(provider)}</p>
      <a href={view.embed.watchUrl} target="_blank" rel="noopener noreferrer">{t.openOn(provider)} <Icon name="external" /></a>
    </div>}
    {multiple && <div class="media-gallery-filmstrip">
      {slides.map((item, i) => <button type="button" key={`${item.key}:${i}`} class="media-gallery-thumb"
        ref={i === index ? selectedThumb : undefined} aria-current={i === index ? 'true' : undefined}
        aria-label={t.showMedia(i + 1)} onClick={() => setIndex(i)}>
        <GalleryVisual src={sourceFor(item, sources, true)} fallback={item.view.kind === 'embed' ? providerNames[item.view.embed.provider] : item.view.kind === 'video' ? t.videoFile : initial}
          lang={item.view.kind === 'image' ? lang : undefined} thumb />
        {item.view.kind !== 'image' && <span class="media-gallery-thumb-play" aria-hidden="true"><Icon name="play" /></span>}
      </button>)}
    </div>}
    {lightboxIndex !== undefined && <Lightbox slides={slides.filter(item => item.view.kind === 'image')} selected={lightboxIndex}
      sources={sources} title={title} lang={lang} select={setLightboxIndex} dismiss={() => setLightboxIndex(undefined)} />}
  </section>
}
