import { useEffect, useState } from 'react'
import { subscribeToasts, type Toast } from '../lib/toast'

const KIND_STYLE: Record<Toast['kind'], string> = {
  info: 'border-line bg-raised text-ink',
  success: 'border-ok/30 bg-ok-soft text-ink',
  pr: 'border-accent/40 bg-accent-soft text-ink',
  danger: 'border-danger/40 bg-danger-soft text-ink',
}

export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => subscribeToasts(setToasts), [])
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`animate-rise rounded-xl border px-4 py-2.5 text-[14px] font-medium shadow-pop backdrop-blur ${KIND_STYLE[t.kind]}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
