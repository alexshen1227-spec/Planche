import type { StepId } from '../types'

interface Pose {
  head: [number, number]
  limbs: number[][][] // list of polylines, each a list of [x, y] points
  ground: [number, number]
}

/**
 * Minimal side-view pictograms of each position. Same visual grammar
 * everywhere: filled head, thick rounded limbs, faint ground line.
 */
const POSES: Record<StepId, Pose> = {
  foundations: {
    head: [60, 14],
    limbs: [
      [[60, 22], [60, 46]],
      [[60, 29], [47, 41]],
      [[60, 29], [73, 41]],
      [[60, 46], [51, 74]],
      [[60, 46], [69, 74]],
    ],
    ground: [38, 84],
  },
  lean: {
    head: [84, 33],
    limbs: [
      [[74, 42], [66, 76]], // arm, shoulders ahead of the hand
      [[74, 42], [40, 59], [14, 74]], // body line to the toes
    ],
    ground: [8, 84],
  },
  frog: {
    head: [68, 33],
    limbs: [
      [[58, 44], [62, 76]], // arm
      [[58, 44], [40, 52]], // back
      [[40, 52], [53, 62], [42, 70]], // folded leg resting on the arm
    ],
    ground: [30, 84],
  },
  tuck: {
    head: [75, 34],
    limbs: [
      [[64, 42], [64, 76]], // vertical arm
      [[64, 42], [46, 47]], // rounded back
      [[46, 47], [57, 58], [44, 64]], // knees to chest
    ],
    ground: [30, 84],
  },
  advtuck: {
    head: [77, 35],
    limbs: [
      [[66, 42], [64, 76]],
      [[66, 42], [38, 42]], // flat back
      [[38, 42], [37, 58], [49, 61]], // knees under hips
    ],
    ground: [26, 84],
  },
  oneleg: {
    head: [77, 35],
    limbs: [
      [[66, 42], [64, 76]],
      [[66, 42], [38, 42]],
      [[38, 42], [8, 41]], // extended leg
      [[38, 42], [38, 56], [48, 59]], // tucked leg
    ],
    ground: [26, 84],
  },
  straddle: {
    head: [77, 35],
    limbs: [
      [[66, 42], [64, 76]],
      [[66, 42], [40, 42]],
      [[40, 42], [9, 31]], // top leg of the straddle V
      [[40, 42], [11, 55]], // bottom leg
    ],
    ground: [26, 84],
  },
  full: {
    head: [77, 35],
    limbs: [
      [[66, 42], [64, 76]],
      [[66, 42], [8, 41]], // one rigid line
    ],
    ground: [26, 84],
  },
}

export function Figure({ step, className = '' }: { step: StepId; className?: string }) {
  const pose = POSES[step]
  return (
    <svg viewBox="0 0 96 90" className={className} aria-hidden="true">
      <line
        x1={pose.ground[0]}
        y1={81}
        x2={pose.ground[1]}
        y2={81}
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        opacity={0.22}
      />
      {pose.limbs.map((pts, i) => (
        <polyline
          key={i}
          points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      <circle cx={pose.head[0]} cy={pose.head[1]} r={6} fill="currentColor" />
    </svg>
  )
}
