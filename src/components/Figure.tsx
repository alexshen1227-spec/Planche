import { useId } from 'react'
import type { StepId } from '../types'
import { figureParts } from '../lib/figure'

/**
 * A position's figure (geometry in lib/figure). Plain figures take the text
 * colour; `accent` paints the body in the accent gradient.
 */
export function Figure({
  step,
  className = '',
  tone = 'plain',
}: {
  step: StepId
  className?: string
  /** `accent` paints the body in the accent gradient — for the one hero figure on a screen. */
  tone?: 'plain' | 'accent'
}) {
  const gradientId = useId()
  const parts = figureParts(step)
  const ink = tone === 'accent' ? `url(#${gradientId})` : 'currentColor'
  return (
    <svg viewBox="0 0 96 90" className={className} aria-hidden="true">
      {tone === 'accent' ? (
        <defs>
          {/* In view coordinates: a bounding-box gradient renders nothing on a
              perfectly level limb (its box has no height), and the full
              planche's body line is level. */}
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="10" y1="20" x2="86" y2="84">
            <stop offset="0" style={{ stopColor: 'var(--t-accent)' }} />
            <stop offset="1" style={{ stopColor: 'var(--t-accent-strong)' }} />
          </linearGradient>
        </defs>
      ) : null}
      <line
        x1={parts.ground.x1}
        y1={parts.ground.y}
        x2={parts.ground.x2}
        y2={parts.ground.y}
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        opacity={0.18}
      />
      {parts.bars ? (
        // A parallette in profile: the grip, and its two feet.
        <path d={parts.bars} stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.38} />
      ) : null}
      {parts.strokes.map((stroke, i) => (
        <path
          key={i}
          d={stroke.d}
          fill="none"
          stroke={ink}
          strokeWidth={stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={stroke.far ? 0.32 : 1}
        />
      ))}
      <circle cx={parts.head.cx} cy={parts.head.cy} r={parts.head.r} fill={ink} />
    </svg>
  )
}
