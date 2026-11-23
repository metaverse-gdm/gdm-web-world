import type { JSX } from 'preact'
import { useId, useLayoutEffect, useState } from 'preact/hooks'
import { useMessages } from '../i18n'

type Field = HTMLInputElement | HTMLTextAreaElement
type ValidationMessage = 'requiredField' | 'invalidUrl' | 'invalidField'

function validationMessage(field: Field): ValidationMessage {
  if (field.validity.valueMissing) return 'requiredField'
  if (field.validity.typeMismatch && field instanceof HTMLInputElement && field.type === 'url') return 'invalidUrl'
  return 'invalidField'
}

export function ValidatedForm({ children, onSubmit, onInput, onReset, ...props }: JSX.IntrinsicElements['form']) {
  const t = useMessages()
  const errorId = useId()
  const [invalid, setInvalid] = useState<{ field: Field; message: ValidationMessage }>()
  const field = invalid?.field

  useLayoutEffect(() => {
    if (!field) return
    const description = field.getAttribute('aria-describedby')
    const invalidState = field.getAttribute('aria-invalid')
    field.setAttribute('aria-invalid', 'true')
    field.setAttribute('aria-describedby', description ? `${description} ${errorId}` : errorId)
    return () => {
      if (description === null) field.removeAttribute('aria-describedby')
      else field.setAttribute('aria-describedby', description)
      if (invalidState === null) field.removeAttribute('aria-invalid')
      else field.setAttribute('aria-invalid', invalidState)
    }
  }, [field, errorId])

  return <form {...props} noValidate onSubmit={event => {
    const first = event.currentTarget.querySelector<Field>('input:invalid, textarea:invalid')
    if (first) {
      event.preventDefault()
      setInvalid({ field: first, message: validationMessage(first) })
      first.focus()
      return
    }
    setInvalid(undefined)
    onSubmit?.(event)
  }} onInput={event => {
    if (field && event.target === field) setInvalid(field.validity.valid ? undefined : { field, message: validationMessage(field) })
    onInput?.(event)
  }} onReset={event => {
    setInvalid(undefined)
    onReset?.(event)
  }}>
    {invalid && <p id={errorId} class="error" role="alert">{t[invalid.message]}</p>}
    {children}
  </form>
}
