import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../Icon'
import { Button } from './Button'
import { prefersReducedMotion } from './motion'

/**
 * Animates a number to its new value (requestAnimationFrame, ease-out).
 * Instant under reduced motion and when the value is not finite.
 */
export function CountUp({
  value,
  decimals = 0,
  duration = 700,
  from,
  format,
  className = '',
}: {
  value: number
  decimals?: number
  duration?: number
  /** Where the first count starts; defaults to 0 on mount, then the previous value. */
  from?: number
  format?: (n: number) => string
  className?: string
}) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() || !Number.isFinite(value) ? value : (from ?? 0)))
  const last = useRef(shown)
  useEffect(() => {
    if (!Number.isFinite(value) || prefersReducedMotion() || duration <= 0) {
      last.current = value
      setShown(value)
      return
    }
    const start = last.current
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      const v = start + (value - start) * eased
      last.current = v
      setShown(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  const text = format ? format(shown) : shown.toFixed(decimals)
  return <span className={`tnum ${className}`}>{text}</span>
}

/** A labelled figure: small label, big tabular number, optional unit and sub-line. */
export function Metric({
  label,
  value,
  unit,
  sub,
  size = 'md',
}: {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  size?: 'md' | 'lg'
}) {
  return (
    <div className="min-w-0">
      <div className="text-footnote font-medium text-ink3">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={`tnum font-display font-semibold leading-none text-ink ${size === 'lg' ? 'text-display' : 'text-title1'}`}>
          {value}
        </span>
        {unit ? <span className="text-footnote text-ink3">{unit}</span> : null}
      </div>
      {sub ? <div className="mt-1 text-footnote text-ink2">{sub}</div> : null}
    </div>
  )
}

/** Nothing here yet: say what this is and what to do about it. */
export function EmptyState({
  icon = 'sparkle',
  title,
  children,
  action,
  onAction,
}: {
  icon?: IconName
  title: string
  children?: ReactNode
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-raised text-ink3">
        <Icon name={icon} size={22} />
      </span>
      <h3 className="mt-3 font-display text-title3 font-semibold text-ink">{title}</h3>
      {children ? <p className="mt-1 max-w-[32ch] text-body text-ink2">{children}</p> : null}
      {action && onAction ? (
        <Button className="mt-4" onClick={onAction}>
          {action}
        </Button>
      ) : null}
    </div>
  )
}

/** Something failed: say so plainly and offer the way out. */
export function ErrorState({
  title = 'Something went wrong',
  children,
  onRetry,
}: {
  title?: string
  children?: ReactNode
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="flex flex-col items-center px-4 py-8 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-danger-soft text-danger-text">
        <Icon name="alert" size={22} />
      </span>
      <h3 className="mt-3 font-display text-title3 font-semibold text-ink">{title}</h3>
      {children ? <p className="mt-1 max-w-[34ch] text-body text-ink2">{children}</p> : null}
      {onRetry ? (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

/** A placeholder while data loads. Pulses softly; still when motion is reduced. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`ds-skeleton rounded-control ${className}`} />
}
