import { useState } from 'preact/hooks'
import { ROOT_ADMIN_DIDS } from '../config'
import { messages, useMessages } from '../i18n'
import { useAction } from '../hooks/useAction'
import type { Runtime } from '../lib/runtime'
import { personId, validDid } from '../lib/wires'
import type { Role } from '../lib/wires'
import { BackLink, ConfirmDialog, DateText, ErrorText, PersonName } from './common'
import { Select } from './Select'
import { ValidatedForm } from './ValidatedForm'

export function AdminPage({ runtime }: { runtime: Runtime }) {
  const t = useMessages()
  const action = useAction()
  const [roleToGrant, setRoleToGrant] = useState<Role>('member')
  const [revocation, setRevocation] = useState<{ did: string; opener: HTMLButtonElement }>()
  const requests = runtime.getRequests()
  const leaves = runtime.getKnownLeaves()
  const approved = [...runtime.getCatalog().roles.entries()]
    .filter((entry): entry is [string, Role] => entry[1] !== null)
    .sort(([a], [b]) => Number(ROOT_ADMIN_DIDS.includes(b)) - Number(ROOT_ADMIN_DIDS.includes(a)) || a.localeCompare(b))

  return <section class="screen-stack" aria-label={t.admin}>
    <BackLink />
    <ErrorText message={action.error} />
    <div class="admin-layout">
      <section class="panel">
        <h2>{t.requests}</h2>
        {requests.length === 0 ? <p class="muted">{t.noRequests}</p>
          : <ul class="admin-list">{requests.map(request => {
            const person = personId(request)
            return <li key={request.signature}>
              <div class="row-between">
                <PersonName did={person} name={request.displayName.trim()} delegated={person !== request.fromId} />
                <DateText at={request.requestedAt} />
              </div>
              {person !== request.fromId && <div class="muted">{t.browserDid} <code>{request.fromId}</code></div>}
              {request.message && <p class="request-message">{request.message}</p>}
              <div class="actions">
                <button disabled={action.busy} onClick={() => { void action.run(() => runtime.approve(person, 'member', request.signature)) }}>{t.approveMember}</button>
                <button disabled={action.busy} onClick={() => { void action.run(() => runtime.approve(person, 'admin', request.signature)) }}>{t.approveAdmin}</button>
                <button class="danger" disabled={action.busy} onClick={() => { void action.run(() => runtime.reject(person, request.signature)) }}>{t.reject}</button>
              </div>
            </li>
          })}</ul>}
      </section>
      <ValidatedForm class="panel" onSubmit={event => {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        void action.run(async () => {
          const did = String(data.get('did') ?? '').trim()
          if (!validDid(did)) throw new Error(messages.ja.invalidDid)
          await runtime.approve(did, roleToGrant)
          form.reset()
        })
      }} onReset={() => setRoleToGrant('member')}>
        <h2>{t.approveByDid}</h2>
        <label>{t.subjectDid}<input name="did" placeholder="did:key:z6Mk…" required maxLength={80} /></label>
        <Select<Role> label={t.role} value={roleToGrant} onChange={setRoleToGrant} disabled={action.busy} options={[
          { value: 'member', label: t.member }, { value: 'admin', label: t.administrator },
        ]} />
        <div><button class="primary" disabled={action.busy} type="submit">{t.approve}</button></div>
      </ValidatedForm>
    </div>
    <section class="panel">
      <h2>{t.approved}</h2>
      {approved.length === 0 ? <p class="muted">{t.noApproved}</p>
        : <ul class="admin-list">{approved.map(([did, role]) => {
          const root = ROOT_ADMIN_DIDS.includes(did)
          return <li class="row-between user-row" key={did}>
            <div><strong>{root ? t.rootAdmin : role === 'admin' ? t.administrator : t.member}</strong>
              <PersonName did={did} name={runtime.displayNameFor(did)} avatarCid={runtime.avatarFor(did)} delegated={leaves.has(did)} />
              {[...leaves.get(did) ?? []].sort().map(leaf => <div key={leaf} class="muted">{t.browserDid} <code>{leaf}</code></div>)}
            </div>
            {!root && <button class="danger" disabled={action.busy}
              onClick={event => setRevocation({ did, opener: event.currentTarget })}>{t.revoke}</button>}
          </li>
        })}</ul>}
    </section>
    {revocation && <ConfirmDialog message={t.confirmRevoke} confirm={t.revoke} opener={revocation.opener} onClose={accepted => {
      setRevocation(undefined)
      if (accepted) void action.run(() => runtime.revoke(revocation.did))
    }} />}
  </section>
}
