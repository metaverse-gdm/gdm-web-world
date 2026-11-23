import { useContext, useState } from 'preact/hooks'
import { actionError, LanguageContext } from '../i18n'
import type { Language } from '../i18n'

export function useAction(formatError: (reason: unknown, language: Language) => string = actionError) {
  const language = useContext(LanguageContext)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ reason: unknown }>()
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setFailure(undefined)
    try { await action() }
    catch (reason) { setFailure({ reason }) }
    finally { setBusy(false) }
  }
  return { busy, error: failure ? formatError(failure.reason, language) : '', run }
}
