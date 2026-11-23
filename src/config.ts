import { isEd25519DidKey } from './crypto/didIdentity'

export const APP_ID = 'gdm-world'
export const GLOBAL_ROOM_ID = 'gdm-world-global'
export const CATALOG_SCOPE_ID = 'gdm-world-catalog-0173ebadfb432886a12466acc316b3139b825c29'

// Add deployment-wide roots here or set VITE_ROOT_ADMIN_DIDS to a comma-separated list.
const builtInRoots: string[] = []
const envRoots = (import.meta.env.VITE_ROOT_ADMIN_DIDS as string | undefined)?.split(',') ?? []
export const ROOT_ADMIN_DIDS: string[] = [...new Set(
  [...builtInRoots, ...envRoots].map(did => did.trim()).filter(isEd25519DidKey),
)]
