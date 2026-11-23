import { beforeAll, describe, expect, it } from 'vitest'
import { signWireWithDelegation } from '@tik-choco/mistai/identity'
import { GLOBAL_ROOM_ID } from '../config'
import { signStringWithDidIdentity } from '../crypto/didIdentity'
import type { DidIdentity } from '../crypto/didIdentity'
import { identities, PROJECT_ID, projectFields, upsert } from '../test/fixtures'
import { CLOCK_SKEW_MS, DAY_MS } from './delegation'
import { localizedProject } from './localizedProject'
import { isCatalog, isHttpUrl, isRecord, LIMITS, makeWire, readRecord, readWire } from './wires'
import { stableStringify, verifyWire } from './wireSign'

let alice: DidIdentity, bob: DidIdentity
let signed: Awaited<ReturnType<typeof upsert>>
const english = { title: 'Train app', summary: 'Check the timetable', description: '' }
const chinese = { title: '列车应用', summary: '查看时刻表', description: '列车' }
beforeAll(async () => {
  [alice, bob] = await identities()
  signed = await upsert(alice)
})

describe('stats wires', () => {
  const day = '2026-06-18'
  const start = Date.parse(day)
  const now = start + 1000
  const views = { [PROJECT_ID]: 7 }
  const projects = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) =>
    [`190b17ef-7ad2-43e4-b374-${String(i).padStart(12, '0')}`, 7]))

  async function sign(overrides: Record<string, unknown> = {}) {
    const fields = { v: 1, roomId: GLOBAL_ROOM_ID, fromId: alice.did, type: 'gdmw:stats', day, views, updatedAt: now, ...overrides }
    return { ...fields, signature: await signStringWithDidIdentity(alice, stableStringify(fields)) }
  }

  it('validates signed stats as non-catalog records and enforces UTC boundaries', async () => {
    const wire = await sign({ views: projects(LIMITS.statsProjects) })
    const verified = readWire(wire, now)
    expect(verified && isRecord(verified)).toBe(true)
    expect(verified && isCatalog(verified)).toBe(false)
    expect(readRecord(wire, now)).toEqual(wire)
    expect(readRecord({ ...wire, views }, now)).toBeUndefined()
    expect(readRecord(await sign({ updatedAt: start - CLOCK_SKEW_MS }), now)).toBeDefined()
    expect(readRecord(await sign({ updatedAt: start + DAY_MS + CLOCK_SKEW_MS - 1 }), start + DAY_MS)).toBeDefined()
    expect(readRecord(wire, start + 89 * DAY_MS)).toBeDefined()
    expect(readRecord(wire, start + 90 * DAY_MS)).toBeUndefined()
  })

  it.each([
    { day: '2026-02-30' }, { day: '2026-6-18' }, { day: '2026-06-18T00:00:00Z' },
    { day: '2026-06-19', updatedAt: start + DAY_MS - CLOCK_SKEW_MS },
    { updatedAt: now + CLOCK_SKEW_MS + 1 }, { updatedAt: start - CLOCK_SKEW_MS - 1 },
    { updatedAt: start + DAY_MS + CLOCK_SKEW_MS }, { updatedAt: now + 0.5 },
    { views: {} }, { views: [1] }, { views: { invalid: 1 } }, { views: { [PROJECT_ID]: '1' } },
    { views: { [PROJECT_ID]: 0 } }, { views: { [PROJECT_ID]: 8 } }, { views: { [PROJECT_ID]: 2.5 } },
    { views: projects(LIMITS.statsProjects + 1) }, { delegation: 'x'.repeat(LIMITS.statsBytes) }, { extra: true },
  ])('rejects a correctly signed invalid record (%o)', async overrides => {
    expect(readRecord(await sign(overrides), now)).toBeUndefined()
  })

  it('bounds a declared day that is in the future even if the signed timestamp is within skew', async () => {
    const wire = await sign({ day: '2026-06-19', updatedAt: start + DAY_MS - CLOCK_SKEW_MS })
    expect(readRecord(wire, start + DAY_MS - CLOCK_SKEW_MS - 1)).toBeUndefined()
    expect(readRecord(wire, start + DAY_MS - CLOCK_SKEW_MS)).toBeDefined()
  })
})

describe('wire validation and signatures', () => {
  it('round-trips a Web Crypto Ed25519 signature through the wire and vault verifier', () => {
    expect(signed.fromId).toBe(alice.did)
    expect(signed.roomId).toBe(GLOBAL_ROOM_ID)
    expect(signed).not.toHaveProperty('lang')
    expect(signed).not.toHaveProperty('translations')
    expect(signed).not.toHaveProperty('thumbnailUrl')
    expect(readRecord(JSON.parse(JSON.stringify(signed)))).toEqual(signed)
    expect(verifyWire(signed)).toBe(true)
  })
  it('signs each translation and a direct thumbnail URL', async () => {
    const project = await upsert(alice, {
      lang: 'ja', translations: { en: english, zh: chinese }, thumbnailUrl: 'https://example.com/train.png',
    })
    expect(readRecord(JSON.parse(JSON.stringify(project)))).toEqual(project)
    expect(localizedProject(project, 'zh')).toEqual({ ...chinese, lang: 'zh' })
    const primary = { title: signed.title, summary: signed.summary, description: signed.description }
    expect(localizedProject(project, 'ja')).toEqual({ ...primary, lang: 'ja' })
    expect(localizedProject(signed, 'en')).toEqual(primary)
    expect(readWire({ ...project, translations: { en: { ...english, title: 'Changed' } } })).toBeUndefined()
  })
  it('verifies a signed profile as a catalog record', async () => {
    const profile = await makeWire(alice, { type: 'gdmw:profile', displayName: '開発チーム', updatedAt: 25 })
    const parsed = readRecord(JSON.parse(JSON.stringify(profile)))
    expect(parsed).toEqual(profile)
    expect(parsed && isCatalog(parsed)).toBe(true)
    expect(readRecord({ ...profile, displayName: 'Changed' })).toBeUndefined()
  })
  it.each([
    { displayName: '' }, { displayName: ' ' }, { displayName: ' Name' }, { displayName: 'Name ' },
    { displayName: 'a'.repeat(LIMITS.displayName + 1) }, { updatedAt: 0 }, { updatedAt: 1.5 },
    { updatedAt: 25 + CLOCK_SKEW_MS + 1 }, { subject: 'elsewhere' },
  ])('rejects an invalid profile even when correctly signed (%o)', async update => {
    const fields = {
      v: 1, roomId: GLOBAL_ROOM_ID, fromId: alice.did,
      type: 'gdmw:profile', displayName: 'Valid', updatedAt: 25, ...update,
    }
    expect(readRecord(await signWireWithDelegation(fields, alice), 25)).toBeUndefined()
  })
  it('uses canonical object key ordering', () => {
    expect(stableStringify({ z: undefined, zeta: 5, a: [{ body: '日本語', a: 1 }] }))
      .toBe('{"a":[{"a":1,"body":"日本語"}],"zeta":5}')
    expect(verifyWire(Object.fromEntries(Object.entries(signed).reverse()))).toBe(true)
  })
  it('still verifies legacy code-unit-sorted signatures for each wire schema', async () => {
    function legacy(value: unknown): string {
      if (value === null || typeof value !== 'object') return JSON.stringify(value)
      if (Array.isArray(value)) return `[${value.map(legacy).join(',')}]`
      const object = value as Record<string, unknown>
      return `{${Object.keys(object).sort().filter(key => object[key] !== undefined)
        .map(key => `${JSON.stringify(key)}:${legacy(object[key])}`).join(',')}}`
    }
    const { signature, ...project } = signed
    const payloads = [
      project,
      { type: 'gdmw:project-delete', projectId: signed.projectId, deletedAt: 20 },
      { type: 'gdmw:approval', subject: bob.did, issuedAt: 20, expiresAt: 30, role: 'member', note: 'ok', requestSignature: signature },
      { type: 'gdmw:revocation', subject: bob.did, revokedAt: 20 },
      { type: 'gdmw:approval-request', displayName: 'User', message: '', requestedAt: 20 },
      { type: 'gdmw:request-reject', subject: bob.did, requestSignature: signature, rejectedAt: 20 },
      { type: 'gdmw:sync-digest', keys: [signature] },
      { type: 'gdmw:sync-want', keys: [signature] },
      { type: 'gdmw:sync-records', records: [signed] },
      { type: 'gdmw:vault-config', config: { by: alice.did, mode: 'custom', room: 'escrow', rev: 1 } },
    ]
    for (const payload of payloads) {
      const fields = { v: 1, roomId: GLOBAL_ROOM_ID, fromId: alice.did, ...payload }
      expect(stableStringify(fields)).toBe(legacy(fields))
      const legacyWire = { ...fields, signature: await signStringWithDidIdentity(alice, legacy(fields)) }
      expect(readWire(legacyWire)).toEqual(legacyWire)
    }
  })
  it.each([
    { title: '' }, { summary: 'a'.repeat(LIMITS.summary + 1) }, { description: [] },
    { projectId: 'abc' }, { repoUrl: 'data:text/html,x' }, { url: 'javascript:alert(1)' },
    { tags: ['a', 'a'] }, { tags: [7] }, { updatedAt: 19 }, { rev: 2.5 },
    { thumb: 'unknown-key' }, { thumbnailCid: 'https://evil.invalid/' }, { v: 2 },
    { lang: 'fr' }, { translations: [] }, { translations: { fr: english } },
    { lang: 'en', translations: { en: english } },
    { translations: { ja: english, en: english, zh: chinese } },
    { translations: { en: { ...english, title: ' ' } } },
    { translations: { en: { ...english, summary: '' } } },
    { translations: { en: { title: english.title, summary: english.summary } } },
    { translations: { en: { ...english, description: 'a'.repeat(LIMITS.description + 1) } } },
    { translations: { en: { ...english, url: 'https://example.com' } } },
    { thumbnailUrl: 'http://example.com/image.png' }, { thumbnailUrl: 'https://user@example.com/image.png' },
    { thumbnailUrl: 'https://example.com/' + 'a'.repeat(LIMITS.url) }, { thumbnailUrl: '' },
    { thumbnailUrl: 'https://example.com/image.png', thumbnailCid: 'A'.repeat(32) },
  ])('rejects invalid fields even when correctly signed (%o)', async update => {
    const fields = { ...signed, ...update }
    expect(readWire(await signWireWithDelegation(fields, alice))).toBeUndefined()
  })
  it('rejects a signature made for another room', async () => {
    const fields = { ...signed, roomId: 'elsewhere' }
    const forgedRoom = await signWireWithDelegation(fields, alice)
    expect(verifyWire(forgedRoom)).toBe(true)
    expect(readWire(forgedRoom)).toBeUndefined()
  })
  it('rejects content tampering and DID impersonation', () => {
    expect(readWire({ ...signed, url: 'https://alternate.example' })).toBeUndefined()
    expect(readWire({ ...signed, fromId: bob.did })).toBeUndefined()
    expect(readWire({ ...signed, signature: signed.signature + '==' })).toBeUndefined()
  })
  it('does not let a caller sign for another DID', async () => {
    await expect(signWireWithDelegation({ fromId: bob.did }, alice)).rejects.toThrow()
  })
  it('enforces the URL scheme, hostname and credential rules', () => {
    expect(isHttpUrl(projectFields.url)).toBe(true)
    expect(isHttpUrl('http://localhost:1234')).toBe(true)
    expect(isHttpUrl('//example.com')).toBe(false)
    expect(isHttpUrl('https://user@example.com')).toBe(false)
    expect(isHttpUrl('https://')).toBe(false)
  })
  it('accepts bounded sync control and bars recursive record batches', async () => {
    const batch = await makeWire(alice, { type: 'gdmw:sync-records', records: [signed] })
    expect(readWire(batch)).toEqual(batch)
    expect(readRecord(batch)).toBeUndefined()
    const fields = { ...batch, records: [batch] }
    expect(readWire(await signWireWithDelegation(fields, alice))).toBeUndefined()
  })
})
