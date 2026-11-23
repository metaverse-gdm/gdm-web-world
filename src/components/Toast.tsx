import { createContext } from 'preact'
import type { ComponentChildren } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

type Toast = { message: string; kind: 'status' | 'alert' }
export const ToastContext = createContext<(toast: Toast) => void>(() => {})

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const nextId = useRef(0)
  const [toast, setToast] = useState<Toast & { id: number }>()
  const [leaving, setLeaving] = useState(0)
  const show = useCallback((notice: Toast) => setToast({ ...notice, id: ++nextId.current }), [])
  useEffect(() => {
    if (!toast) return
    const exit = window.setTimeout(() => setLeaving(toast.id), 2800)
    const remove = window.setTimeout(() => setToast(undefined), 3000)
    return () => { window.clearTimeout(exit); window.clearTimeout(remove) }
  }, [toast])

  return <ToastContext.Provider value={show}>
    {children}
    <div class="toast-region">
      <div role="status">{toast?.kind === 'status' && <span key={toast.id} class="toast" data-leaving={toast.id === leaving}>{toast.message}</span>}</div>
      <div role="alert">{toast?.kind === 'alert' && <span key={toast.id} class="toast" data-leaving={toast.id === leaving}>{toast.message}</span>}</div>
    </div>
  </ToastContext.Provider>
}
