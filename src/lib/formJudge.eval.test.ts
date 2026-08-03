import { describe, expect, it } from 'vitest'
import type { FormIssue } from '../types'
import { judgeTrackedFrames, MATERIAL_TOLERANCE, POSE_PROFILES, SHRUG_MIN_RATIO } from './poseForm'
import { REAL_POSES, realClip } from './realPoses.fixture'
import { buildTruePose, IDEAL, PROPORTIONS, synthesizeClip, type SynthParams } from './poseSynth'

/**
 * Accuracy eval for the camera form judge.
 *
 * Unlike the unit tests next door, these do not pin one function's behaviour —
 * they run whole clips of known-truth poses through the real verdict path and
 * ask the only questions that matter to an athlete: does a good rep come back
 * clean, and does a bad one come back named correctly?
 */

const GRADED = Object.keys(POSE_PROFILES).filter((id) => !POSE_PROFILES[id].noChecks)

describe('synthetic pose fidelity', () => {
  it('lays out skeletons that really have the requested measurements', () => {
    const params: SynthParams = {
      elbowBendDeg: 12,
      hipAngleDeg: 95,
      kneeBendDeg: 80,
      hipOffset: 0.15,
      leanRatio: 0.35,
      shrugGap: 0.4,
    }
    const { truth } = buildTruePose(params)
    expect(truth.elbowDeg).toBeCloseTo(168, 1)
    expect(truth.kneeDeg).toBeCloseTo(100, 1)
    expect(truth.hipAngleDeg).toBeCloseTo(95, 1)
    expect(truth.hipOffset).toBeCloseTo(0.15, 3)
    expect(truth.leanRatio).toBeCloseTo(0.35, 3)
    expect(truth.shrugRatio).toBeCloseTo(0.4, 3)
  })

  it('puts a flexing elbow toward the hips and a locked one away from them', () => {
    const flexed = buildTruePose({ elbowBendDeg: 10 })
    const locked = buildTruePose({ elbowBendDeg: -10 })
    const side = (pose: ReturnType<typeof buildTruePose>) => {
      const u = {
        x: pose.wrist.x - pose.shoulder.x,
        y: pose.wrist.y - pose.shoulder.y,
      }
      const along =
        ((pose.elbow.x - pose.shoulder.x) * u.x + (pose.elbow.y - pose.shoulder.y) * u.y) /
        (u.x * u.x + u.y * u.y)
      const offX = pose.elbow.x - (pose.shoulder.x + u.x * along)
      const offY = pose.elbow.y - (pose.shoulder.y + u.y * along)
      const torsoX = pose.hip.x - pose.shoulder.x
      const torsoY = pose.hip.y - pose.shoulder.y
      return Math.sign(offX * torsoX + offY * torsoY)
    }
    expect(side(flexed)).toBe(1)
    expect(side(locked)).toBe(-1)
    expect(flexed.truth.elbowDeg).toBeCloseTo(locked.truth.elbowDeg, 6)
  })

  it('mirrors cleanly for either camera side and either facing', () => {
    for (const facing of [1, -1] as const) {
      const { truth } = buildTruePose({ facing, hipOffset: 0.2, leanRatio: 0.4, elbowBendDeg: 8 })
      expect(truth.hipOffset).toBeCloseTo(0.2, 3)
      expect(truth.leanRatio).toBeCloseTo(0.4, 3)
      expect(truth.elbowDeg).toBeCloseTo(172, 1)
    }
  })

  it('keeps a textbook rep inside the side-view gate for every position', () => {
    for (const id of GRADED) {
      const clip = synthesizeClip({ ...IDEAL[id], seed: 7 })
      const verdict = judgeTrackedFrames(clip, id)
      expect(`${id}: ${verdict.reason ?? 'ok'}`).toBe(`${id}: ok`)
    }
  })
})

/** Run one scenario and report the parts an athlete would actually read. */
function judge(id: string, overrides: SynthParams = {}, seed = 3) {
  const clip = synthesizeClip({ ...IDEAL[id], seed, ...overrides })
  const verdict = judgeTrackedFrames(clip, id)
  return {
    ok: verdict.ok,
    reason: verdict.reason,
    issues: verdict.issues,
    unseen: verdict.unseen,
    score: verdict.score,
    elbowDeg: verdict.elbowDeg,
    kneeDeg: verdict.kneeDeg,
    hipAngleDeg: verdict.hipAngleDeg,
    hipOffset: verdict.hipOffset,
    leanRatio: verdict.leanRatio,
    shrugRatio: verdict.shrugRatio,
    cleanRatio: verdict.cleanRatio,
    fixFirst: verdict.fixFirst?.issue,
  }
}

/** Ten seeds per scenario: one lucky noise draw proves nothing either way. */
function across(id: string, overrides: SynthParams = {}, seeds = 10) {
  return Array.from({ length: seeds }, (_, i) => judge(id, overrides, i + 1))
}

const rate = (runs: ReturnType<typeof judge>[], predicate: (r: ReturnType<typeof judge>) => boolean) =>
  runs.filter(predicate).length / runs.length

describe('form judge accuracy — a good rep must read clean', () => {
  for (const id of GRADED) {
    it(`${id}: a textbook hold is not accused of anything`, () => {
      const runs = across(id)
      const graded = rate(runs, (r) => r.ok)
      const clean = rate(runs, (r) => r.ok && r.issues.length === 0)
      const seen = rate(runs, (r) => r.ok && r.unseen.length === 0)
      const bad = runs.filter((r) => !r.ok || r.issues.length || r.unseen.length).slice(0, 3)
      const detail = bad.length ? ` ${JSON.stringify(bad)}` : ''
      expect(`${id} graded=${graded} clean=${clean} seen=${seen}${detail}`).toBe(
        `${id} graded=1 clean=1 seen=1`,
      )
    })
  }
})

/**
 * One clearly-wrong version of each fault, per position, sized well past the
 * point where a coach watching the video would call it. Positions that do not
 * grade a criterion are absent from its list — a tuck planche is *supposed* to
 * have bent knees, and flagging that would be the worst failure of all.
 */
function faultScenarios(id: string): { issue: FormIssue; label: string; params: SynthParams }[] {
  const profile = POSE_PROFILES[id]
  const cases: { issue: FormIssue; label: string; params: SynthParams }[] = [
    { issue: 'arms', label: 'clearly bent arms', params: { elbowBendDeg: 20 } },
    {
      // Below anything head position alone produces on real footage, which is
      // the only size of shrug this metric can honestly claim to see.
      issue: 'shrug',
      label: 'shoulders shrugged to the ears',
      params: { shrugGap: SHRUG_MIN_RATIO - 0.15 },
    },
  ]
  if (profile.levelTolerance !== undefined) {
    cases.push(
      {
        issue: 'sag',
        label: 'hips dropped below the shoulders',
        params: { hipOffset: -(profile.levelTolerance + 0.18) },
      },
      {
        issue: 'pike',
        label: 'hips piked above the shoulders',
        params: { hipOffset: profile.levelTolerance + 0.18 },
      },
    )
  }
  if (profile.minLeanRatio !== undefined) {
    cases.push({
      issue: 'lean',
      label: 'shoulders barely past the hands',
      params: { leanRatio: profile.minLeanRatio - 0.18 },
    })
  }
  if (profile.minKneeDeg !== undefined) {
    cases.push({ issue: 'knees', label: 'knees visibly bent', params: { kneeBendDeg: 30 } })
  }
  if (profile.minHipAngleDeg !== undefined) {
    cases.push({
      issue: 'closed',
      label: 'hips still folded',
      params: { hipAngleDeg: profile.minHipAngleDeg - 30 },
    })
  }
  return cases
}

describe('form judge accuracy — a real fault must be named', () => {
  for (const id of GRADED) {
    for (const { issue, label, params } of faultScenarios(id)) {
      it(`${id}: ${label} is reported as "${issue}"`, () => {
        const runs = across(id, params)
        const caught = rate(runs, (r) => r.ok && r.issues.includes(issue))
        expect(`${id}/${issue} caught=${caught} ${JSON.stringify(runs[0])}`).toBe(
          `${id}/${issue} caught=1 ${JSON.stringify(runs[0])}`,
        )
      })
    }
  }
})

describe('form judge accuracy — the shape of a progression is not a fault', () => {
  it('never calls a tuck planche piked, closed or bent-kneed for being tucked', () => {
    for (const id of ['tuck-planche', 'adv-tuck-planche']) {
      const runs = across(id)
      expect(`${id} ${JSON.stringify([...new Set(runs.flatMap((r) => r.issues))])}`).toBe(`${id} []`)
    }
  })

  it('does not accuse a one-leg planche of a bent knee for its tucked leg', () => {
    const runs = across('one-leg-planche')
    expect(rate(runs, (r) => r.issues.includes('knees') || r.issues.includes('closed'))).toBe(0)
  })

  it('grades the extended leg even when the tucked leg is the better-tracked one', () => {
    const runs = across('one-leg-planche', { nearScore: 0.75, farScore: 0.8 })
    expect(rate(runs, (r) => r.ok && r.issues.length === 0)).toBe(1)
  })

  it('reads a straddle through its foreshortened side-view legs', () => {
    const runs = across('straddle-planche', { foreshorten: 0.6 })
    expect(rate(runs, (r) => r.ok && r.issues.length === 0 && r.unseen.length === 0)).toBe(1)
  })
})

describe('form judge robustness — the same hold filmed differently', () => {
  const setups: { label: string; params: SynthParams }[] = [
    { label: 'filmed from the other side', params: { side: 'right' } },
    { label: 'head pointing the other way', params: { facing: -1 } },
    { label: 'phone rolled 8 degrees', params: { rollDeg: 8 } },
    { label: 'phone rolled minus 8 degrees', params: { rollDeg: -8 } },
    { label: 'occasional dropped joints', params: { dropoutRate: 0.12 } },
    { label: 'a horizontal body the model is unsure about', params: { nearScore: 0.55 } },
    { label: 'a wrist half-hidden behind a parallette', params: { jointScores: { wrist: 0.5 } } },
    { label: 'a short hold sampled few times', params: { durationSec: 4, frames: 12 } },
    { label: 'a long hold', params: { durationSec: 40, frames: 72 } },
  ]

  for (const { label, params } of setups) {
    it(`${label}: textbook holds stay clean and fully judged`, () => {
      const failures: string[] = []
      for (const id of GRADED) {
        const runs = across(id, params)
        const clean = rate(runs, (r) => r.ok && r.issues.length === 0)
        const seen = rate(runs, (r) => r.ok && r.unseen.length === 0)
        if (clean < 1 || seen < 1) {
          failures.push(
            `${id} clean=${clean} seen=${seen} ${JSON.stringify(
              runs.find((r) => !r.ok || r.issues.length || r.unseen.length),
            )}`,
          )
        }
      }
      expect(failures).toEqual([])
    })
  }
})

describe('form judge — degraded tracking must fail gracefully, not collapse', () => {
  /**
   * Doubling the landmark error is not a setup an athlete chooses; it is what a
   * dim room or an awkward angle does to the tracker. The contract here is
   * deliberately weaker than above and deliberately still a contract: quality
   * may drop, but it must drop slowly and stay on the right side of the answer.
   * Anything tighter would be fitting to a noise level that has not yet been
   * measured against real footage.
   */
  it('keeps a textbook hold overwhelmingly clean at twice the landmark noise', () => {
    for (const id of GRADED) {
      const runs = across(id, { noise: 0.02 }, 20)
      const clean = rate(runs, (r) => r.ok && r.issues.length === 0)
      const graded = rate(runs, (r) => r.ok)
      const overreach = runs.some((r) => r.issues.length > 1)
      expect(`${id} clean>=0.85:${clean >= 0.85} graded:${graded} piledOn:${overreach}`).toBe(
        `${id} clean>=0.85:true graded:1 piledOn:false`,
      )
    }
  })

  it('still names a gross fault when tracking is poor', () => {
    for (const id of GRADED) {
      const runs = across(id, { noise: 0.02, elbowBendDeg: 25 }, 20)
      expect(`${id} ${rate(runs, (r) => r.issues.includes('arms'))}`).toBe(`${id} 1`)
    }
  })
})

describe('form judge — clean time and the one cue that matters', () => {
  it('credits the whole hold when nothing breaks down', () => {
    for (const id of GRADED) {
      const runs = across(id)
      expect(`${id} ${Math.min(...runs.map((r) => r.cleanRatio ?? 0))}`).toBe(`${id} 1`)
    }
  })

  it('ends the clean window where a hold actually collapses, not at the first wobble', () => {
    // Locked for the first half, folding steadily after it.
    const runs = across('tuck-planche', {
      durationSec: 12,
      frames: 40,
      elbowBendDeg: (p) => (p < 0.5 ? -2 : (p - 0.5) * 80),
    })
    for (const run of runs) {
      expect(run.issues).toContain('arms')
      expect(run.cleanRatio!).toBeGreaterThan(0.35)
      expect(run.cleanRatio!).toBeLessThan(0.85)
    }
  })

  it('leads with the elbows when several things are wrong at once', () => {
    const runs = across('straddle-planche', {
      elbowBendDeg: 20,
      hipOffset: -0.4,
      leanRatio: 0.1,
      kneeBendDeg: 30,
    })
    expect(new Set(runs.map((r) => r.fixFirst))).toEqual(new Set(['arms']))
  })

  it('scores a textbook hold near the top and a collapsed one far below it', () => {
    for (const id of GRADED) {
      const good = across(id).map((r) => r.score ?? 0)
      const bad = across(id, { elbowBendDeg: 35, hipOffset: -0.45, leanRatio: 0.05 }).map(
        (r) => r.score ?? 0,
      )
      expect(`${id} good=${Math.min(...good) >= 90} bad=${Math.max(...bad) <= 60}`).toBe(
        `${id} good=true bad=true`,
      )
    }
  })
})

describe('form judge — refusals happen only when the camera really cannot see', () => {
  it('refuses a front-on clip rather than grading foreshortened angles', () => {
    const runs = across('tuck-planche', { bodyWidth: 0.75 })
    expect(rate(runs, (r) => !r.ok && /not fully side-on/.test(r.reason ?? ''))).toBe(1)
  })

  it('still grades a slightly angled shot', () => {
    const runs = across('tuck-planche', { bodyWidth: 0.3 })
    expect(rate(runs, (r) => r.ok)).toBe(1)
  })

  it('names the criterion it lost rather than failing the whole clip', () => {
    // Legs walked out of frame; the arms and body line were in shot throughout.
    const runs = across('full-planche', { jointScores: { knee: 0.1, ankle: 0.1 } })
    for (const run of runs) {
      expect(run.ok).toBe(true)
      expect(run.unseen).toContain('knees')
      expect(run.elbowDeg).toBeGreaterThan(170)
      expect(run.issues).not.toContain('knees')
    }
  })

  it('refuses only when nothing at all was gradeable', () => {
    const runs = across('full-planche', { nearScore: 0.15, farScore: 0.1 })
    expect(rate(runs, (r) => !r.ok)).toBe(1)
  })
})

describe('form judge — the shrug metric is grounded in real proportions', () => {
  it('does not call a neutral head position a shrug', () => {
    expect(buildTruePose({}).truth.shrugRatio).toBeCloseTo(PROPORTIONS.earGap, 3)
    const runs = across('full-planche', { shrugGap: PROPORTIONS.earGap })
    expect(rate(runs, (r) => r.issues.includes('shrug'))).toBe(0)
  })
})

describe('real photographs, real pose model', () => {
  it('passes a genuinely good planche lean without a single complaint', () => {
    const verdict = judgeTrackedFrames(realClip('plancheLean'), 'planche-lean')
    const summary = {
      ok: verdict.ok,
      reason: verdict.reason,
      issues: verdict.issues,
      unseen: verdict.unseen,
      elbowLocked: (verdict.elbowDeg ?? 0) >= 175,
      legsStraight: (verdict.kneeDeg ?? 0) >= 170,
      cleanRatio: verdict.cleanRatio,
      highScore: (verdict.score ?? 0) >= 90,
    }
    expect(summary).toEqual({
      ok: true,
      reason: undefined,
      issues: [],
      unseen: [],
      elbowLocked: true,
      legsStraight: true,
      cleanRatio: 1,
      highScore: true,
    })
  })

  it('holds that verdict when the tracker will not sit still', () => {
    // Frame-to-frame wander at and beyond what real video actually shows.
    for (const jitter of [0.01, 0.015, 0.02]) {
      for (let seed = 1; seed <= 8; seed++) {
        const verdict = judgeTrackedFrames(
          realClip('plancheLean', { jitter, seed }),
          'planche-lean',
        )
        expect(`jitter=${jitter} seed=${seed} ${verdict.ok} ${verdict.issues}`).toBe(
          `jitter=${jitter} seed=${seed} true `,
        )
      }
    }
  })

  it('refuses a real straddle planche filmed off-axis instead of guessing at it', () => {
    const verdict = judgeTrackedFrames(realClip('straddleOffAxis'), 'straddle-planche')
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/not fully side-on/)
  })

  it('measures a plank as a plank: straight, but barely leaning', () => {
    const verdict = judgeTrackedFrames(realClip('plank'), 'ppp-hold')
    // Shoulders stacked over the hands, so almost none of the forward lean a
    // pseudo planche plank is for. This is the number the lean thresholds are
    // calibrated against at the bottom end.
    expect(verdict.leanRatio!).toBeLessThan(0.2)
    // The body is a straight line even though it slopes: hips are not folded.
    expect(verdict.hipAngleDeg!).toBeGreaterThan(170)
  })

  it('reads real proportions the way the synthetic model assumes', () => {
    // If these drifted apart, every threshold tuned on synthetic poses would be
    // tuned for a body shape that does not exist.
    const pose = REAL_POSES.plancheLean
    const at = (n: string) => pose.points.find((p) => p[0] === n)!
    const span = (a: string, b: string) =>
      Math.hypot(at(a)[1] - at(b)[1], at(a)[2] - at(b)[2])
    const torso = span('left_shoulder', 'left_hip')
    expect(span('left_shoulder', 'left_elbow') / torso).toBeCloseTo(PROPORTIONS.upperArm, 1)
    expect(span('left_elbow', 'left_wrist') / torso).toBeCloseTo(PROPORTIONS.forearm, 1)
    expect(span('left_hip', 'left_knee') / torso).toBeCloseTo(PROPORTIONS.thigh, 1)
    expect(span('left_knee', 'left_ankle') / torso).toBeCloseTo(PROPORTIONS.shank, 1)
    expect(span('left_shoulder', 'left_ear') / torso).toBeCloseTo(PROPORTIONS.earGap, 1)
  })

  it('does not call a real neutral head position a shrug', () => {
    // Measured 0.35 here, 0.46 head-up and 0.24 on a head-down push-up, none of
    // which is a shrug. The accusation threshold has to clear all of them.
    const verdict = judgeTrackedFrames(realClip('plancheLean'), 'planche-lean')
    expect(verdict.shrugRatio!).toBeGreaterThan(SHRUG_MIN_RATIO - MATERIAL_TOLERANCE.shrugRatio)
    expect(verdict.issues).not.toContain('shrug')
  })
})

describe('a plank is not a pseudo planche plank', () => {
  it('tells an athlete planking instead of leaning that the lean is missing', () => {
    // Filmed at 0.12 of forward lean, against a real planche lean's 0.82. The
    // distinction is the entire exercise, so it has to be named. It is not the
    // *first* cue, and should not be: the same frames also show genuinely bent
    // elbows, and straightening those outranks leaning further on them.
    const verdict = judgeTrackedFrames(realClip('plank'), 'ppp-hold')
    expect(verdict.issues).toContain('lean')
    expect(verdict.fixFirst?.issue).toBe('arms')
  })

  it('still passes a genuine lean that is nowhere near the reference athlete', () => {
    // Half the filmed athlete's lean is a real attempt, not a plank.
    for (const id of ['ppp-hold', 'planche-lean']) {
      const runs = across(id, { leanRatio: 0.42 })
      expect(`${id} ${rate(runs, (r) => r.issues.includes('lean'))}`).toBe(`${id} 0`)
    }
  })
})
