import type { HTMLAttributes, ReactNode } from 'react'

/** A surface. One padding (16px), one radius (20px), one border; no shadow stacks. */
export function Card({
  className = '',
  padded = true,
  tone = 'plain',
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { padded?: boolean; tone?: 'plain' | 'accent'; children?: ReactNode }) {
  return (
    <div
      {...rest}
      className={`rounded-card border ${tone === 'accent' ? 'border-accent/30 bg-accent-soft' : 'border-line bg-surface'} ${
        padded ? 'p-4' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

/** The heading style of a card: one level, one look. */
export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="font-display text-title3 font-semibold text-ink">{children}</h3>
      {right}
    </div>
  )
}
