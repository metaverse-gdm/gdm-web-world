import { getBlob, pinBlob } from './mistClient'

const MAX_FILE = 12 * 1024 * 1024
const MAX_BYTES = 200 * 1024
const DIMENSION = 720

function imageType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  const header = new TextDecoder().decode(bytes.subarray(0, 12))
  if (header.startsWith('RIFF') && header.slice(8) === 'WEBP') return 'image/webp'
}

export async function saveThumbnail(file: File) {
  if (!file.size || file.size > MAX_FILE || !imageType(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) {
    throw new Error('JPEG・PNG・WebP の画像を 12 MB 以下で選んでください。')
  }
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const resize = Math.min(1, DIMENSION / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * resize))
    canvas.height = Math.max(1, Math.round(bitmap.height * resize))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画像を縮小できませんでした。')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.82, 0.64, 0.45]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality))
      if (blob && blob.size <= MAX_BYTES) {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        return pinBlob('gdm-world-thumbnail', bytes)
      }
    }
    throw new Error('画像が大きすぎます。別の画像を選んでください。')
  } finally { bitmap.close() }
}

export async function loadThumbnail(cid: string) {
  const bytes = await getBlob(cid)
  const type = imageType(bytes)
  if (bytes.byteLength > MAX_BYTES || !type) throw new Error('Invalid thumbnail bytes')
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }))
}
