import { createDidIdentity } from '../crypto/didIdentity'
import type { DidIdentity } from '../crypto/didIdentity'
import { makeWire } from '../lib/wires'
import type { CatalogPayload, ProjectFields, Role } from '../lib/wires'

export const identities = () => Promise.all(Array.from({ length: 5 }, () => createDidIdentity()))
export const PROJECT_ID = '190b17ef-7ad2-43e4-b374-351e89cc5c44'
export const projectFields: ProjectFields = {
  title: '電車アプリ', summary: '時刻表を確認', description: '**電車**', url: 'https://example.com/', tags: ['ツール'],
}
export function approve(from: DidIdentity, subject: DidIdentity, role: Role, issuedAt: number, expiresAt?: number) {
  return makeWire(from, { type: 'gdmw:approval', subject: subject.did, role, issuedAt, expiresAt })
}
export function revoke(from: DidIdentity, subject: DidIdentity, revokedAt: number) {
  return makeWire(from, { type: 'gdmw:revocation', subject: subject.did, revokedAt })
}
type Upsert = Extract<CatalogPayload, { type: 'gdmw:project-upsert' }>
export function upsert(from: DidIdentity, overrides: Partial<Upsert> = {}) {
  return makeWire(from, {
    ...projectFields, type: 'gdmw:project-upsert', projectId: PROJECT_ID,
    createdAt: 20, updatedAt: 20, rev: 1, ...overrides,
  })
}
export function remove(from: DidIdentity, deletedAt: number) {
  return makeWire(from, { type: 'gdmw:project-delete', projectId: PROJECT_ID, deletedAt })
}
