import { ed25519 } from '@noble/curves/ed25519.js'
import { ed25519PublicKeyFromDidKey, stableStringify } from '@tik-choco/mistai/identity'
import { base64ToBytes } from '../crypto/cryptoEncoding'
export { stableStringify }

export function compareStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

const encoder = new TextEncoder()
export const isSignature = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{85}[AQgw]$/.test(value)

export function verifySignature(did: string, payload: string, signature: string): boolean {
  if (did.length !== 56) return false
  try {
    const key = ed25519PublicKeyFromDidKey(did)
    const base64 = signature.replace(/-/g, '+').replace(/_/g, '/')
    const bytes = base64ToBytes(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    return !!key && ed25519.verify(bytes, encoder.encode(payload), key, { zip215: false })
  } catch {
    return false
  }
}

// Live and vault records have the same synchronous verification path.
export function verifyWire(wire: Record<string, unknown>): boolean {
  if (typeof wire.fromId !== 'string' || !isSignature(wire.signature)) return false
  try {
    const unsigned = { ...wire }
    delete unsigned.signature
    return verifySignature(wire.fromId, stableStringify(unsigned), wire.signature)
  } catch {
    return false
  }
}
