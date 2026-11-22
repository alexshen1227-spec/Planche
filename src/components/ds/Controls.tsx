import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from '../Icon'

/** One choice out of a few. radiogroup semantics; arrow keys move the choice. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
}: {
  options: { value: T; label: ReactNode; disabled?: boolean }[]
  value: T
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  const move = (e: KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const n = options.length
    for (let step = 1; step <= n; step++) {
      const next = options[(((i + dir * step) % n) + n) % n]
      if (!next.disabled) {
        onChange(next.value)
        const group = (e.currentTarget as HTMLElement).parentElement
        window.setTimeout(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(), 0)
        return
      }
    }
  }
  return (
    <div role="radiogroup" aria-label={label} className={`flex gap-1 rounded-inner bg-raised p-1 ${className}`}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => move(e, i)}
            className={`ds-press min-h-11 flex-1 rounded-control px-3 text-body font-semibold ${
              on ? 'bg-surface text-ink shadow-card' : 'text-ink2 hover:text-ink'
            } disabled:opacity-40`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** A selectable pill. aria-pressed, 44px tall. */
export function ToggleChip({
  active,
  onClick,
  children,
  disabled,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`ds-press inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-footnote font-medium ${
        active
          ? 'border-transparent bg-accent text-on-accent'
          : 'border-line bg-surface text-ink2 hover:border-line-strong hover:text-ink'
      } disabled:opacity-40`}
    >
      {active ? <Icon name="check" size={14} /> : null}
      {children}
    </button>
  )
}

/** A number with minus and plus. Both buttons are 44px; the value is tabular. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  label,
  unit,
  format,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label: string
  unit?: string
  format?: (value: number) => string
}) {
  const id = useId()
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)))
  const btn =
    'ds-press grid h-11 w-11 shrink-0 place-items-center rounded-control border border-line-strong bg-raised text-ink disabled:opacity-40'
  return (
    <div role="group" aria-labelledby={id} className="flex items-center gap-2">
      <span id={id} className="sr-only">
        {label}
      </span>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => set(value - step)} className={btn}>
        <Icon name="minus" size={18} />
      </button>
      <div className="min-w-[64px] text-center" aria-live="polite">
        <span className="tnum font-display text-title2 font-semibold text-ink">{format ? format(value) : value}</span>
        {unit ? <span className="ml-1 text-footnote text-ink3">{unit}</span> : null}
      </div>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => set(value + step)} className={btn}>
        <Icon name="plus" size={18} />
      </button>
    </div>
  )
}
