import type { ReactNode } from 'react'

/**
 * A countdown ring: the stroke fills as `left` runs down to 0 and the time
 * sits in the middle. The offset eases linearly between the ticks it is given,
 * so it reads as continuous; reduced motion just steps.
 */
export function RingTimer({
  left,
  total,
  size = 84,
  stroke = 6,
  children,
  label,
}: {
  left: number
  total: number
  size?: number
  stroke?: number
  children?: ReactNode
  label: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const done = total > 0 ? Math.max(0, Math.min(1, 1 - left / total)) : 1
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--t-line-strong)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--t-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - done)}
          style={{ transition: 'stroke-dashoffset 500ms linear' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  )
}
