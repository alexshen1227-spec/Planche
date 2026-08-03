import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export function Modal({
  open,
  onClose,
  children,
  wide = false,
  label = 'Dialog',
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  wide?: boolean
  /** Concise accessible name announced when focus enters the modal. */
  label?: string
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    const focusable =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    window.setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(focusable)
      ;(first ?? dialogRef.current)?.focus()
    }, 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll<HTMLElement>(focusable)]
        if (!items.length) {
          e.preventDefault()
          dialogRef.current.focus()
          return
        }
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [open, onClose])

  if (!open) return null
  // Portalled to <body>: the views animate in with a transform, and a
  // transformed ancestor becomes the containing block for fixed children —
  // which would place this overlay down the page instead of over the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-6 animate-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface shadow-pop animate-pop sm:rounded-3xl ${
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        }`}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-line bg-raised text-ink2 transition hover:text-ink"
        >
          <Icon name="x" size={16} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function ProgressRing({
  value,
  size = 64,
  stroke = 6,
  className = '',
  track = 'var(--t-line)',
  color,
  glow = false,
  children,
}: {
  value: number
  size?: number
  stroke?: number
  className?: string
  track?: string
  /** Solid stroke override; defaults to the accent gradient. */
  color?: string
  glow?: boolean
  children?: ReactNode
}) {
  const gradId = useId()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  const strokeColor = color ?? `url(#${gradId})`
  return (
    <div className={`relative ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {color ? null : (
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--t-ring-grad-a)" />
              <stop offset="100%" stopColor="var(--t-ring-grad-b)" />
            </linearGradient>
          </defs>
        )}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{
            transition: 'stroke-dashoffset 0.5s cubic-bezier(0.2,0.9,0.3,1), stroke 0.3s ease',
            filter: glow ? 'drop-shadow(0 0 10px color-mix(in oklab, var(--t-accent) 55%, transparent))' : undefined,
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="text-[13px] font-medium text-ink3">{label}</div>
      <div className="mt-1 font-display text-[26px] font-semibold leading-tight text-ink">{value}</div>
      {sub ? <div className="mt-0.5 text-[13px] text-ink2">{sub}</div> : null}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-end justify-between gap-3 first:mt-0">
      <h2 className="font-display text-[17px] font-semibold text-ink">{children}</h2>
      {right}
    </div>
  )
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={typeof active === 'boolean' ? active : undefined}
      className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition ${
        active
          ? 'border-transparent bg-accent text-on-accent'
          : 'border-line bg-surface text-ink2 hover:border-line-strong hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}
