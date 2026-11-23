import { delegationSigningPayload, isEd25519DidKey, type DelegationV1 } from '@tik-choco/mistai/identity'
import { verifySignature } from './wireSign'

export const CLOCK_SKEW_MS = 5 * 60_000
export const DAY_MS = 24 * 60 * 60_000

// Mistvault's parse is synchronous and mistai 0.10.4 verifies with async Web Crypto.
export function verifyDelegationSync(value: unknown, leaf: string, now: number): value is DelegationV1 {
  if (!value || typeof value !== 'object') return false
  const { v, root, leaf: delegate, iat, exp, sig } = value as Partial<DelegationV1>
  if (v !== 1 || delegate !== leaf || typeof root !== 'string' || root === leaf
    || typeof iat !== 'string' || typeof exp !== 'string' || typeof sig !== 'string'
    || !isEd25519DidKey(leaf)) return false
  const start = Date.parse(iat)
  const end = Date.parse(exp)
  return start < end && end - start <= 400 * DAY_MS
    && now >= start - CLOCK_SKEW_MS && now <= end + CLOCK_SKEW_MS
    && verifySignature(root, delegationSigningPayload({ v, root, leaf, iat, exp }), sig)
}
