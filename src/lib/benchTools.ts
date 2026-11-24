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

  // The ordinary textbook sweep uses a slight anatomical hyperextension and
  // default tracker noise. That missed the reported failure: an exactly
  // straight arm plus measured worst-normal (2% torso) landmark jitter could
  // still be accused. Keep the seeds that exposed each old failure mode in the
  // shipped, one-tap test so a bundled regression cannot hide behind averages.
  {
    let failure: string | undefined
    for (const seed of [2, 5, 13, 21, 46]) {
      const v = judgeSynth('tuck-planche', { elbowBendDeg: 0, noise: 0.02 }, seed)
      if (!v.ok) failure = `seed ${seed} refused: ${v.reason}`
      else if (v.issues.includes('arms')) failure = `seed ${seed} accused straight elbows at ${v.elbowDeg?.toFixed(1)}°`
      if (failure) break
    }
    add('Exactly straight elbows survive measured tracking noise', !failure, failure)
  }

  // Repeated rounded scores can be legitimate when two attempts land at the
  // same measured angle. Prove the shipped score itself is responsive rather
  // than stuck: known 8° and 14° bends must produce ordered arm subscores.
  {
    const straighter = judgeSynth('ppp-hold', { elbowBendDeg: 8, noise: 0 }, 1)
    const softer = judgeSynth('ppp-hold', { elbowBendDeg: 14, noise: 0 }, 1)
    const armScore = (verdict: typeof straighter) =>
      verdict.subscores?.find((subscore) => subscore.key === 'elbow')?.score
    const straightScore = armScore(straighter)
    const softScore = armScore(softer)
    add(
      'Arm score changes with measured elbow lockout',
      straightScore !== undefined && softScore !== undefined && straightScore > softScore,
      `8° bend scored ${straightScore ?? 'missing'}; 14° bend scored ${softScore ?? 'missing'}`,
    )
  }

  // The 2026-10 audit's late bend: straight for seven seconds, then a 15° bend
  // for the last three. The whole-hold reading alone called it perfect.
  // Verified time must end near where the bend starts, keeping the seconds
  // before it, and the bend must be named.
  {
    const v = judgeSynth('tuck-planche', { noise: 0, frames: 31, elbowBendDeg: (p) => (p >= 0.7 ? 15 : -2) }, 1)
    const clean = v.cleanSeconds ?? 0
    add(
      'A late elbow softening ends verified time where it starts',
      v.ok && v.issues.includes('arms') && clean > 6.5 && clean < 8,
      `clean ${clean.toFixed(1)}s of 10s, issues [${v.issues.join(', ')}]`,
    )
  }
  // A held bend can never sit beside a full "Verified clean" score.
  {
    const v = judgeSynth('tuck-planche', { noise: 0, elbowBendDeg: 15 }, 1)
    const verified = v.subscores?.find((subscore) => subscore.key === 'cleanTime')?.score
    add(
      'A held elbow bend reads zero verified clean time',
      v.ok && verified === 0,
      `verified-clean subscore ${verified ?? 'missing'}`,
    )
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
    // The positions that are not a side-on support hold, each with the fault
    // only it has — and bends sized to the coarser bar those postures get.
    { name: 'Clearly bent arms are named under a bar', id: 'front-lever', extra: { elbowBendDeg: 55 }, issue: 'arms' },
    { name: 'Sagging hips are named in a front lever', id: 'front-lever', extra: { hipOffset: -0.4 }, issue: 'sag' },
    { name: 'Clearly bent arms are named in a handstand', id: 'freestanding-handstand', extra: { elbowBendDeg: 48 }, issue: 'arms' },
    { name: 'Closed shoulders are named in a handstand', id: 'freestanding-handstand', extra: { shoulderDeg: 130 }, issue: 'shoulders' },
    { name: 'A 90° hold on nearly straight arms is named', id: 'ninety-hold', extra: { elbowBendDeg: 40 }, issue: 'angle' },
    { name: 'A flag well off level is named', id: 'human-flag', extra: { tiltDeg: 30 }, issue: 'tilt' },
    { name: 'A clearly bent arm is named in a flag', id: 'human-flag', extra: { elbowBendDeg: 42 }, issue: 'arms' },
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

  {
    const v = judgeSynth('human-flag', { bodyWidth: 0.12 }, 1)
    add(
      'A flag filmed from the side is refused rather than misread',
      !v.ok && /front-on/.test(v.reason ?? ''),
      v.ok ? 'was graded' : `unexpected reason: ${v.reason}`,
    )
  }
  {
    const v = judgeSynth('human-flag', { tiltDeg: 80 }, 1)
    add(
      'A body running up the pole is called off level, not a turned phone',
      v.ok && v.issues.includes('tilt') && v.frameTurned === undefined,
      `ok=${v.ok} issues=[${v.issues.join(', ')}] turned=${v.frameTurned ?? 'no'}`,
    )
  }
  {
    // A 90° hold bends its arms on purpose.
    const v = judgeSynth('ninety-hold', {}, 1)
    add(
      'A 90° hold is never accused of bent arms',
      v.ok && !v.issues.includes('arms') && !v.issues.includes('angle'),
      `got [${v.issues.join(', ')}]`,
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
  {
    const v = judgeTrackedFrames(realClip('handstandStraight'), 'freestanding-handstand')
    add(
      'The real straight handstand photo passes, shoulders measured',
      v.ok && v.issues.length === 0 && v.unseen.length === 0 && (v.shoulderDeg ?? 0) > 160,
      `ok=${v.ok} issues=[${v.issues.join(', ')}] unseen=[${v.unseen.join(', ')}] shoulder=${v.shoulderDeg?.toFixed(0)}`,
    )
  }
  {
    const v = judgeTrackedFrames(realClip('handstandArched'), 'freestanding-handstand')
    add(
      'The real arched handstand photo has its closed shoulders named',
      v.ok && v.issues.includes('shoulders') && !v.issues.includes('arms'),
      `ok=${v.ok} issues=[${v.issues.join(', ')}]`,
    )
  }
  {
    const v = judgeTrackedFrames(realClip('flagLevel'), 'human-flag')
    add(
      'The real level flag photo passes clean',
      v.ok && v.issues.length === 0 && v.unseen.length === 0,
      `ok=${v.ok} issues=[${v.issues.join(', ')}] unseen=[${v.unseen.join(', ')}]`,
    )
  }
  {
    const v = judgeTrackedFrames(realClip('poleHoldUpright'), 'human-flag')
    add(
      'The real upright pole hold is never read as a level flag',
      v.ok && v.issues.includes('tilt'),
      `ok=${v.ok} issues=[${v.issues.join(', ')}] tilt=${v.tiltDeg?.toFixed(0)}`,
    )
  }
  {
    const v = judgeTrackedFrames(realClip('flagOblique'), 'human-flag')
    add(
      'The real flag filmed at an angle is refused',
      !v.ok && /at an angle/.test(v.reason ?? ''),
      v.ok ? `was graded: [${v.issues.join(', ')}]` : `unexpected reason: ${v.reason}`,
    )
  }
  {
    const v = judgeTrackedFrames(realClip('frontLeverRings'), 'front-lever')
    add(
      'The real straight-armed front lever photo is not accused',
      v.ok && v.issues.length === 0,
      `ok=${v.ok} issues=[${v.issues.join(', ')}] elbow=${v.elbowDeg?.toFixed(0)} knee=${v.kneeDeg?.toFixed(0)}`,
    )
  }

  const spread = judgeSynth('human-flag', { straddleDeg: 45 }, 1)
  add('A wide straddle earns no full-flag seconds', spread.heldIssues?.includes('split') === true && spread.cleanSeconds === 0)
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
