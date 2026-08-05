import { useEffect, useState } from 'react'
import { subscribeToasts, type Toast } from '../lib/toast'

const KIND_STYLE: Record<Toast['kind'], string> = {
  info: 'border-line bg-raised text-ink',
  success: 'border-ok/30 bg-ok-soft text-ink',
  pr: 'border-accent/40 bg-accent-soft text-ink',
  danger: 'border-danger/40 bg-danger-soft text-ink',
}

/**
 * Toasts are the app's main confirmation channel — new PRs, saved sets,
 * failed imports, restored backups — and every one of them was visual only.
 *
 * Two regions rather than one: a failure ("Import failed", "Could not delete
 * form clips") needs to interrupt whatever is being read, while "Set logged."
 * must not. Both containers stay mounted even when empty, because a live
 * region added to the DOM at the same moment as its content is frequently not
 * announced at all.
 */
export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => subscribeToasts(setToasts), [])
  const urgent = toasts.filter((t) => t.kind === 'danger')
  const polite = toasts.filter((t) => t.kind !== 'danger')

  const bubble = (t: Toast) => (
    <div
      key={t.id}
      className={`animate-rise rounded-xl border px-4 py-2.5 text-[14px] font-medium shadow-pop backdrop-blur ${KIND_STYLE[t.kind]}`}
    >
      {t.text}
    </div>
  )

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4">
      <div role="alert" aria-live="assertive" className="flex flex-col items-center gap-2">
        {urgent.map(bubble)}
      </div>
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
        {polite.map(bubble)}
      </div>
    </div>
  )
}
