import { useEffect, useRef, useState } from 'preact/hooks'
import { useMessages } from '../i18n'
import { resolvePreviewImage, resolveScreenshot } from '../lib/linkPreview'
import { loadMediaImage, loadThumbnail } from '../lib/thumbnails'
import { isMistlSite } from '../lib/mistlSite'

type Props = { cid?: string; url?: string; projectUrl?: string; title?: string; decorative?: boolean; onError?: () => void; mediaImage?: boolean }

export function Thumbnail({ cid, url, projectUrl, title, decorative, onError, mediaImage }: Props) {
  const host = useRef<HTMLDivElement>(null)
  // mistl-hosted sites live on the viewer's loopback: never fetch them for a
  // preview or hand their URL to the screenshot service.
  const auto = !cid && !url && !isMistlSite(projectUrl) ? projectUrl : undefined
  const source = cid ?? url ?? auto
  const [seen, setSeen] = useState<string>()
  const visible = source !== undefined && seen === source
  useEffect(() => {
    if (!source || visible) return
    const element = host.current
    if (!element || typeof IntersectionObserver !== 'function') { setSeen(source); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setSeen(source)
        observer.disconnect()
      }
    }, { rootMargin: cid ? '240px' : '0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [cid, source, visible])

  return <div ref={host} class="thumbnail" aria-hidden={decorative || undefined}>
    <ThumbnailImage key={visible ? `${source}:${!!mediaImage}` : undefined} cid={visible ? cid : undefined}
      url={visible ? url : undefined} projectUrl={visible ? auto : undefined}
      title={title} decorative={decorative} onError={onError} mediaImage={mediaImage} />
  </div>
}

function ThumbnailImage({ cid, url, projectUrl, title = '', decorative, onError, mediaImage }: Props) {
  const t = useMessages()
  const [blob, setBlob] = useState<string>()
  const [preview, setPreview] = useState<string | null>()
  const [loadedUrl, setLoadedUrl] = useState<string>()
  const [failed, setFailed] = useState(false)
  const [screenshot, setScreenshot] = useState<string>()

  useEffect(() => {
    if (!cid) return
    let active = true
    let url: string | undefined
    let retry: ReturnType<typeof setTimeout>
    async function fetchImage(id: string, attempt: number) {
      try {
        const next = await (mediaImage ? loadMediaImage(id) : loadThumbnail(id))
        if (!active) { URL.revokeObjectURL(next); return }
        url = next
        setBlob(url)
      } catch {
        if (active && attempt < 2) retry = setTimeout(() => { void fetchImage(id, attempt + 1) }, 5000 * (attempt + 1))
      }
    }
    void fetchImage(cid, 0)
    return () => {
      active = false
      clearTimeout(retry)
      if (url) URL.revokeObjectURL(url)
    }
  }, [cid, mediaImage])
  useEffect(() => {
    if (!projectUrl) return
    let active = true
    void resolvePreviewImage(projectUrl).then(image => { if (active) setPreview(image) })
    return () => { active = false }
  }, [projectUrl])
  useEffect(() => {
    if (!projectUrl || preview !== null) return
    let active = true
    void resolveScreenshot(projectUrl).then(image => {
      if (!active) return
      if (image) setScreenshot(image)
      else setFailed(true)
    })
    return () => { active = false }
  }, [projectUrl, preview])

  const source = failed ? undefined : cid ? blob : url ?? (projectUrl ? preview ?? screenshot : undefined)
  const initial = Array.from(title.trim())[0] ?? 'G'
  return <>
    <span class="image-fallback" data-loaded={!!source && loadedUrl === source} aria-hidden="true">{initial}</span>
    {source && <img key={source} src={source} alt={!decorative && title ? t.thumbnailAlt(title) : ''}
      referrerpolicy="no-referrer" loading="lazy" decoding="async" data-loaded={loadedUrl === source}
      onLoad={() => setLoadedUrl(source)} onError={() => {
        if (projectUrl && preview) setPreview(null)
        else { setFailed(true); onError?.() }
      }} />}
  </>
}
