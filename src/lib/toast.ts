export interface Toast {
  id: number
  kind: 'info' | 'success' | 'pr' | 'danger'
  text: string
  /** True when the toast waits to be dismissed instead of timing out. */
  sticky?: boolean
}

type Listener = (toasts: Toast[]) => void

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l(toasts)
}

/**
 * Failures stay until dismissed; everything else times out.
 *
 * "Set logged." is worth three seconds and no more. But "Could not delete form
 * clips, so no data was reset" is the app telling you that something you asked
 * for did not happen — and it was disappearing in 3.6 seconds with no way to
 * bring it back, which is how an athlete ends up believing their data was
 * cleared when it was not. Anything that reports a failure now waits.
 *
 * @param ttl milliseconds to live. Ignored for `danger`, which is sticky.
 */
export function pushToast(text: string, kind: Toast['kind'] = 'info', ttl = 3600) {
  const sticky = kind === 'danger'
  const t: Toast = { id: nextId++, kind, text, ...(sticky ? { sticky } : {}) }
  toasts = [...toasts.slice(-3), t]
  emit()
  if (sticky) return
  // Plain setTimeout rather than window.setTimeout: the handle is never kept,
  // so nothing here needs the DOM, and this keeps the module unit-testable.
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id)
    emit()
  }, ttl)
}

/** Remove one toast early — the close button on a sticky failure. */
export function dismissToast(id: number) {
  const before = toasts.length
  toasts = toasts.filter((t) => t.id !== id)
  if (toasts.length !== before) emit()
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn)
  fn(toasts)
  return () => {
    listeners.delete(fn)
  }
}
