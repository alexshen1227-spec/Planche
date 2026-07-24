export interface Toast {
  id: number
  kind: 'info' | 'success' | 'pr' | 'danger'
  text: string
}

type Listener = (toasts: Toast[]) => void

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l(toasts)
}

export function pushToast(text: string, kind: Toast['kind'] = 'info', ttl = 3600) {
  const t: Toast = { id: nextId++, kind, text }
  toasts = [...toasts.slice(-3), t]
  emit()
  window.setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id)
    emit()
  }, ttl)
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn)
  fn(toasts)
  return () => {
    listeners.delete(fn)
  }
}
