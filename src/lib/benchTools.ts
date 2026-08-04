import type { Kp } from './poseBackend'
import { judgeTrackedFrames, POSE_PROFILES, type JudgeInput } from './poseForm'
import { realClip } from './realPoses.fixture'
import { IDEAL, synthesizeClip, type SynthParams } from './poseSynth'

/**
 * Tools for the form judge bench — the transparency layer.
 *
 * The node test suite proves the judge's source is right; nothing proves the
 * copy that actually shipped to this device still behaves, after bundling,
 * minification and whatever the browser did on the way. `selfTestJudge` is
 * that proof: a compact accuracy run any phone can execute in a moment, over
 * synthetic holds of known truth *and* the frozen real photographs. An
 * athlete taps one button and reads pass/fail; an automated session calls it
 * and gets structure.
 *
 * Imported only by the lazy dev-lab chunk — a workout pays nothing for it.
 */

export interface SelfTestCheck {
  name: string
  pass: boolean
  /** What was expected vs seen, only when the check failed. */
  detail?: string
}

export interface SelfTestReport {
  pass: boolean
  checks: SelfTestCheck[]
}

const GRADED = Object.keys(POSE_PROFILES).filter((id) => !POSE_PROFILES[id].noChecks)

function judgeSynth(id: string, extra: SynthParams, seed: number) {
  return judgeTrackedFrames(synthesizeClip({ ...IDEAL[id], seed, ...extra }), id)
}

/**
 * The judge's core promises, exercised in the running bundle.
 *
 * Deliberately a subset of the full eval — the bar here is "is the shipped
 * judge intact", not "re-derive every threshold on a phone". Each check names
 * the promise it protects in plain language, because the athlete-facing use
 * of this is a transparency page, not a CI log.
 */
export function selfTestJudge(seeds = 3): SelfTestReport {
  const checks: SelfTestCheck[] = []
  const add = (name: string, pass: boolean, detail?: string) =>
    checks.push({ name, pass, ...(pass || !detail ? {} : { detail }) })

  // 1. A textbook rep of every graded position reads clean, fully judged.
  for (const id of GRADED) {
    let failure: string | undefined
    for (let seed = 1; seed <= seeds && !failure; seed++) {
      const v = judgeSynth(id, {}, seed)
      if (!v.ok) failure = `refused: ${v.reason}`
      else if (v.issues.length) failure = `accused of ${v.issues.join(', ')}`
      else if (v.unseen.length) failure = `left ${v.unseen.join(', ')} unseen`
    }
    add(`A textbook ${POSE_PROFILES[id].label.toLowerCase()} reads clean`, !failure, failure)
  }

  // 2. Each fault family is still named where the position checks it.
  const faults: { name: string; id: string; extra: SynthParams; issue: string }[] = [
    { name: 'Bent arms are named', id: 'tuck-planche', extra: { elbowBendDeg: 20 }, issue: 'arms' },
    { name: 'Sagging hips are named', id: 'full-planche', extra: { hipOffset: -0.4 }, issue: 'sag' },
    { name: 'Piked hips are named', id: 'full-planche', extra: { hipOffset: 0.4 }, issue: 'pike' },
    { name: 'A missing lean is named', id: 'planche-lean', extra: { leanRatio: 0.05 }, issue: 'lean' },
    { name: 'Bent knees are named where legs must be straight', id: 'full-planche', extra: { kneeBendDeg: 30 }, issue: 'knees' },
    { name: 'Closed hips are named where they must be open', id: 'straddle-planche', extra: { hipAngleDeg: 140 }, issue: 'closed' },
    { name: 'A real shrug is named', id: 'full-planche', extra: { shrugGap: 0.18 }, issue: 'shrug' },
  ]
  for (const fault of faults) {
    let failure: string | undefined
    for (let seed = 1; seed <= seeds && !failure; seed++) {
      const v = judgeSynth(fault.id, fault.extra, seed)
      if (!v.issues.includes(fault.issue as never)) {
        failure = `expected "${fault.issue}", got [${v.issues.join(', ')}]`
      }
    }
    add(fault.name, !failure, failure)
  }

  // 3. The deliberate shapes of a progression are never treated as faults.
  {
    const v = judgeSynth('tuck-planche', {}, 1)
    add(
      'A tuck is never accused of being tucked',
      v.ok && !v.issues.includes('knees') && !v.issues.includes('closed'),
      `got [${v.issues.join(', ')}]`,
    )
  }

  // 4. Footage the side-view contract cannot grade is refused, not guessed at.
  {
    const v = judgeSynth('tuck-planche', { bodyWidth: 0.75 }, 1)
    add(
      'A front-on clip is refused rather than misread',
      !v.ok && /side-on/.test(v.reason ?? ''),
      v.ok ? 'was graded' : `unexpected reason: ${v.reason}`,
    )
  }

  // 5. The one-leg promise: a lone tucked leg is unseen, never accused.
  {
    const v = judgeSynth(
      'one-leg-planche',
      { hipAngleDeg: 80, kneeBendDeg: 110, secondLeg: { hipAngleDeg: 178, kneeBendDeg: 1 } },
      1,
    )
    add(
      'Extending the far-side leg is never called bent knees',
      v.ok && !v.issues.includes('knees') && !v.issues.includes('closed'),
      `got [${v.issues.join(', ')}] unseen [${v.unseen.join(', ')}]`,
    )
  }

  // 6. The real photographs, replayed through the same verdict path.
  {
    const v = judgeTrackedFrames(realClip('plancheLean'), 'planche-lean')
    add(
      'The reference planche lean photo still passes clean',
      v.ok && v.issues.length === 0 && (v.score ?? 0) >= 90,
      `ok=${v.ok} issues=[${v.issues.join(', ')}] score=${v.score}`,
    )
  }
  {
    const v = judgeTrackedFrames(realClip('straddleOffAxis'), 'straddle-planche')
    add(
      'The off-axis straddle photo is still refused',
      !v.ok && /side-on/.test(v.reason ?? ''),
      v.ok ? 'was graded' : `unexpected reason: ${v.reason}`,
    )
  }
  {
    const v = judgeTrackedFrames(realClip('lsitCroppedHead'), 'tuck-planche')
    const cleanPass = v.ok && v.issues.length === 0 && (v.score ?? 0) >= 85
    add(
      'The hallucinated L-sit photo never passes clean',
      !cleanPass,
      `ok=${v.ok} issues=[${v.issues.join(', ')}] score=${v.score}`,
    )
  }

  return { pass: checks.every((check) => check.pass), checks }
}

/** The joints a fixture keeps — the same set every existing entry stores. */
const FIXTURE_JOINTS = [
  'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder',
  'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
  'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
]

export interface CapturedFixture {
  /** Ready to spread into REAL_POSES. */
  entry: {
    truth: string
    width: number
    height: number
    rotation: 0 | 90 | 270
    points: [string, number, number, number][]
  }
  /** The same entry as paste-ready source for realPoses.fixture.ts. */
  code: string
}

/**
 * Freeze one detected frame as a REAL_POSES-format fixture.
 *
 * The truth string is the contract: it must say what the photograph actually
 * shows, established by a person looking at it — not by the model, whose
 * output is exactly the thing under test.
 */
export function fixtureFromPoses(name: string, truth: string, poses: JudgeInput): CapturedFixture {
  const kps: Kp[] = poses.tracked[0]?.kps ?? []
  const round = (value: number, places: number) => {
    const factor = 10 ** places
    return Math.round(value * factor) / factor
  }
  const points = FIXTURE_JOINTS.flatMap((joint): [string, number, number, number][] => {
    const kp = kps.find((candidate) => candidate.name === joint)
    return kp ? [[joint, round(kp.x, 1), round(kp.y, 1), round(kp.score ?? 0, 3)]] : []
  })
  const entry: CapturedFixture['entry'] = {
    truth,
    width: poses.width,
    height: poses.height,
    rotation: poses.rotation ?? 0,
    points,
  }
  const pointLines = points
    .map(([n, x, y, s]) => `      ['${n}', ${x}, ${y}, ${s}],`)
    .join('\n')
  const code = [
    `  ${name}: {`,
    `    truth:`,
    `      '${truth.replace(/'/g, "\\'")}',`,
    `    width: ${entry.width},`,
    `    height: ${entry.height},`,
    `    rotation: ${entry.rotation},`,
    `    points: [`,
    pointLines,
    `    ],`,
    `  },`,
  ].join('\n')
  return { entry, code }
}
