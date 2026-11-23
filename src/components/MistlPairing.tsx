import { useState } from 'preact/hooks'
import { clearDelegation, formatPairingCode, loadDelegation, normalizePairingCode } from '@tik-choco/mistai/identity'
import { formatPairingError, importDidDelegation, pairDidDelegation } from '../lib/didPairing'
import { useMessages } from '../i18n'
import type { Runtime } from '../lib/runtime'
import { useAction } from '../hooks/useAction'
import { CopyDid, DateText, ErrorText } from './common'
import { Icon } from './Icon'
import { ValidatedForm } from './ValidatedForm'

export function MistlPairing({ runtime }: { runtime: Pick<Runtime, 'getSelf' | 'identity' | 'refreshDelegation'> }) {
  const t = useMessages().pairing
  const action = useAction(formatPairingError)
  const [code, setCode] = useState('')
  const [json, setJson] = useState('')
  const self = runtime.getSelf()
  const leaf = runtime.identity.did
  function run(update: () => Promise<void>) {
    void action.run(async () => {
      await update()
      runtime.refreshDelegation()
    })
  }

  return <section class="panel form-stack mistl-pairing" aria-labelledby="mistl-pairing-title" aria-busy={action.busy}>
    <h2 id="mistl-pairing-title">{t.title}</h2>
    {self.delegation && <div class="form-stack pairing-status">
      <div class="settings-identity"><span>{t.root}</span><CopyDid did={self.id} delegated /></div>
      <p>{t.expires} <DateText at={Date.parse(self.delegation.exp)} /></p>
      {self.expiresSoon && <p class="delegation-warning" role="status">{t.expiryWarning}</p>}
      <p class="muted" id="mistl-unpair-warning">{t.unlinkWarning}</p>
      <div><button type="button" class="danger" aria-describedby="mistl-unpair-warning" disabled={action.busy} onClick={() => {
        run(async () => {
          clearDelegation()
          if (loadDelegation()?.sig === self.delegation?.sig) {
            throw new DOMException('Delegation storage unavailable', 'StorageError')
          }
        })
      }}>{t.unlink}</button></div>
    </div>}
    <ValidatedForm class="form-stack" onSubmit={event => {
      event.preventDefault()
      run(async () => { await pairDidDelegation(code, leaf); setCode('') })
    }}>
      <label>{t.code}
        <input value={code} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" spellcheck={false} required
          aria-describedby="mistl-code-hint" disabled={action.busy} onInput={event => setCode(event.currentTarget.value)} onBlur={() => {
            const normalized = normalizePairingCode(code)
            if (normalized) setCode(formatPairingCode(normalized))
          }} />
        <span id="mistl-code-hint" class="muted">{t.codeHint}</span>
      </label>
      <div><button type="submit" class="primary" disabled={action.busy}>{t.pair}</button></div>
    </ValidatedForm>
    <details class="pairing-manual">
      <summary>{t.manual}<Icon name="chevron" /></summary>
      <div class="pairing-manual-body">
        <ValidatedForm class="form-stack" onSubmit={event => {
          event.preventDefault()
          run(async () => { await importDidDelegation(json, leaf); setJson('') })
        }}>
          <div class="muted" id="mistl-json-hint"><p>{t.manualHint}</p><code>mistl key delegate --leaf &lt;did:key&gt;</code></div>
          <textarea rows={4} aria-label={t.manual} aria-describedby="mistl-json-hint" value={json} required spellcheck={false}
            disabled={action.busy} onInput={event => setJson(event.currentTarget.value)} />
          <div><button type="submit" disabled={action.busy}>{t.save}</button></div>
        </ValidatedForm>
      </div>
    </details>
    {action.busy && <p class="muted" role="status">{t.busy}</p>}
    <ErrorText message={action.error} />
  </section>
}
