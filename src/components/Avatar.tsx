import { useEffect, useState } from 'preact/hooks'
import { loadMediaImage } from '../lib/thumbnails'
import { Icon } from './Icon'

/** Decorative beside a person's or group's visible name. */
export function Avatar({ cid, group = false, large = false }: { cid?: string; group?: boolean; large?: boolean }) {
  return <span class={`avatar${large ? ' avatar--large' : ''}`} aria-hidden="true">
    <AvatarContent key={cid} cid={cid} group={group} />
  </span>
}

function AvatarContent({ cid, group }: { cid?: string; group: boolean }) {
  const [src, setSrc] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!cid) return
    let active = true
    let url: string | undefined
    void loadMediaImage(cid).then(next => {
      if (!active) { URL.revokeObjectURL(next); return }
      url = next
      setSrc(url)
    }).catch(() => { /* Unavailable blobs retain the fallback icon. */ })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [cid])
  return src && !failed ? <img src={src} alt="" decoding="async" onError={() => setFailed(true)} />
    : <Icon name={group ? 'users' : 'user'} />
}
