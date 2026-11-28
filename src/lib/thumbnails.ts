import { getBlob, pinBlob } from './mistClient'

const MAX_FILE = 12 * 1024 * 1024
const MAX_BYTES = 200 * 1024
const DIMENSION = 720
// Gallery images are shown large on the detail view, so they keep more pixels.
const MEDIA_BYTES = 480 * 1024
const MEDIA_DIMENSION = 1600

function imageType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  const header = new TextDecoder().decode(bytes.subarray(0, 12))
  if (header.startsWith('RIFF') && header.slice(8) === 'WEBP') return 'image/webp'
}

export const saveThumbnail = (file: File) => saveImage(file, DIMENSION, MAX_BYTES, 'gdm-world-thumbnail')
export const saveMediaImage = (file: File) => saveImage(file, MEDIA_DIMENSION, MEDIA_BYTES, 'gdm-world-media')

async function saveImage(file: File, dimension: number, maxBytes: number, name: string) {
  if (!file.size || file.size > MAX_FILE || !imageType(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) {
    throw new Error('JPEG・PNG・WebP の画像を 12 MB 以下で選んでください。')
  }
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const resize = Math.min(1, dimension / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * resize))
    canvas.height = Math.max(1, Math.round(bitmap.height * resize))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画像を縮小できませんでした。')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.82, 0.64, 0.45]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality))
      if (blob && blob.size <= maxBytes) {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        return pinBlob(name, bytes)
      }
    }
    throw new Error('画像が大きすぎます。別の画像を選んでください。')
  } finally { bitmap.close() }
}

export const loadThumbnail = (cid: string) => loadImage(cid, MAX_BYTES)
/** Gallery blobs may be larger than thumbnails; a thumbnail cid also loads here. */
export const loadMediaImage = (cid: string) => loadImage(cid, MEDIA_BYTES)

async function loadImage(cid: string, maxBytes: number) {
  const bytes = await getBlob(cid)
  const type = imageType(bytes)
  if (bytes.byteLength > maxBytes || !type) throw new Error('Invalid thumbnail bytes')
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }))
}
