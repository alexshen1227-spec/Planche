import { describe, expect, it } from 'vitest'
import type { AutoForm, SetLog } from '../types'
import {
  JUDGE_VERSION,
  MAX_PLAUSIBLE_HYPEREXTENSION_DEG,
  judgeTrackedFrames,
  signedElbowBend,
  sustainedSofteningStart,
  type FrameReading,
} from './poseForm'
import { IDEAL, synthesizeClip, type SynthParams } from './poseSynth'
import {
  cleanEvidence,
  countedClipWindow,
  progressionCredit,
  readingFitsWindow,
  trainingSetValue,
  verifiedCleanSeconds,
} from './progression'

/**
 * Judge v4: the fixes from the 2026-10-10 camera audit (PJ-01 to PJ-06).
 * Each case pins a decision the audit found wrong, on synthetic holds whose
 * true angles are known. The real-footage numbers behind the chosen
 * thresholds are in the doc comments next to each constant.
 */

const tuck = (overrides: SynthParams = {}, seed = 3) =>
  judgeTrackedFrames(synthesizeClip({ ...IDEAL['tuck-planche'], frames: 31, durationSec: 10, seed, ...overrides }), 'tuck-planche')

describe('PJ-03: a late softening ends clean time where it starts', () => {
  it('catches a 15° bend over the final three seconds that the whole-hold reading hid', () => {
    const verdict = tuck({ noise: 0, elbowBendDeg: (p) => (p >= 0.7 ? 15 : -2) })
    expect(verdict.ok).toBe(true)
    expect(verdict.issues).toContain('arms')
    // The seconds before the bend are kept, not discarded.
    expect(verdict.cleanSeconds!).toBeGreaterThan(6.5)
    expect(verdict.cleanSeconds!).toBeLessThan(8)
    expect(verdict.heldIssues).not.toContain('arms')
    expect(verdict.subscores?.find((s) => s.key === 'elbow')?.score).toBeLessThan(100)
  })

  it('never treats a constant bend as a late breakdown, so its training dose stays', () => {
    const verdict = tuck({ noise: 0, elbowBendDeg: 15 })
    expect(verdict.heldIssues).toContain('arms')
    expect(verdict.cleanSeconds!).toBeGreaterThan(9)
  })

  it('needs a locked phase first and a run that persists', () => {
    const frames = (values: number[]): FrameReading[] => values.map((v, i) => ({ t: i / 3, elbowDeg: v }))
    // Straight for 2s, bent after: found.
    expect(sustainedSofteningStart(frames([...Array(6).fill(181), ...Array(12).fill(160)]), 180, 6)).not.toBeNull()
    // Bent from the start: not a softening.
    expect(sustainedSofteningStart(frames(Array(18).fill(160)), 180, 6)).toBeNull()
    // A brief dip that recovers: not sustained.
    expect(sustainedSofteningStart(frames([...Array(8).fill(181), 160, 160, ...Array(8).fill(181)]), 180, 6)).toBeNull()
  })
})

describe('PJ-04: sides and signs', () => {
  it('reads a collapse the sign rule calls "125° of hyperextension" as the bend it is', () => {
    const point = (x: number, y: number) => ({ x, y, score: 0.95 })
    const shoulder = point(0, 0)
    const wrist = point(0, 100)
    const hip = point(100, 0)
    // Elbow far out on the side away from the hips: a deep bend whose sign the
    // hip-direction rule gets wrong.
    const bend = signedElbowBend(shoulder, point(-60, 50), wrist, hip, 100)!
    expect(bend).toBeGreaterThan(MAX_PLAUSIBLE_HYPEREXTENSION_DEG)
    // Small genuine hyperextension keeps its sign.
    expect(signedElbowBend(shoulder, point(-6, 50), wrist, hip, 100)!).toBeLessThan(0)
  })

  const resolvedFar = { farScore: 0.85, bodyWidth: 0.24 } as const

  it('does not certify straight arms when only the far arm reads bent', () => {
    // The bent arm is the genuinely fainter far one (so the judge keeps the
    // straight near arm as its primary), resolved as a separate limb, and bent
    // just enough that the plain average would pass: 14° and -2° average to 6°.
    const verdicts = [1, 2, 3, 4, 5, 6].map((seed) =>
      tuck(
        { noise: 0.01, elbowBendDeg: -2, secondArm: { elbowBendDeg: 14 }, farScore: 0.75, nearScore: 0.93, bodyWidth: 0.3 },
        seed,
      ),
    )
    const refusedToCertify = verdicts.filter((v) => v.issues.includes('arms') || v.unseen.includes('elbows')).length
    expect(refusedToCertify).toBeGreaterThanOrEqual(5)
  })

  it('grades a bent near arm on its own instead of averaging it with a straight far arm', () => {
    const verdicts = [1, 2, 3, 4, 5].map((seed) =>
      tuck({ noise: 0.01, elbowBendDeg: 16, secondArm: { elbowBendDeg: -2 }, ...resolvedFar }, seed),
    )
    for (const v of verdicts) expect(v.issues).toContain('arms')
  })
})

describe('PJ-05: a joint outside the picture is not an observation', () => {
  it('drops a confidently placed wrist that lies outside the frame', () => {
    // The geometry stays intact: only the picture's bottom edge moves up past
    // the hands, which is what a crop does. Every wrist is now below the frame.
    const clip = synthesizeClip({ ...IDEAL['tuck-planche'], noise: 0, frames: 24 })
    const lowestWrist = Math.min(
      ...clip.tracked.flatMap((frame) => frame.kps.filter((p) => p.name?.endsWith('_wrist')).map((p) => p.y)),
    )
    const cropped = { ...clip, height: lowestWrist - 2 }
    const verdict = judgeTrackedFrames(cropped, 'tuck-planche')
    expect(verdict.unseen).toContain('elbows')
    expect(verdict.details.some((d) => /outside the picture/.test(d))).toBe(true)
    // Control: the uncropped picture grades the same elbows.
    expect(judgeTrackedFrames(clip, 'tuck-planche').unseen).not.toContain('elbows')
  })
})

describe('PJ-06: steadiness is movement against the hands, not the camera', () => {
  it('reads a smoothly panning phone the same as a still one', () => {
    const still = synthesizeClip({ ...IDEAL['tuck-planche'], noise: 0.015, frames: 31, seed: 5 })
    const panned = synthesizeClip({ ...IDEAL['tuck-planche'], noise: 0.015, frames: 31, seed: 5 })
    panned.tracked.forEach((frame, i) => {
      for (const point of frame.kps) {
        point.x += i * 6 + 40 * Math.sin(i / 2)
        point.y += i * 2
      }
    })
    const a = judgeTrackedFrames(still, 'tuck-planche')
    const b = judgeTrackedFrames(panned, 'tuck-planche')
    expect(a.drift).toBeDefined()
    expect(Math.abs(a.drift! - b.drift!)).toBeLessThan(0.002)
    expect(b.details.join(' ')).not.toMatch(/tired|fatigue|slipping/i)
  })

  it('still sees a body that genuinely sways', () => {
    const still = tuck({ noise: 0.015 })
    const sway = tuck({ noise: 0.015, hipOffset: (p) => 0.06 + 0.12 * Math.sin(p * Math.PI * 4) })
    expect(sway.drift!).toBeGreaterThan(still.drift! * 1.5)
  })
})

describe('PJ-01: one meaning for clean time', () => {
  const auto = (extra: Partial<AutoForm>): AutoForm => ({
    issues: [],
    confidence: 0.9,
    cleanSeconds: 8,
    cleanRatio: 0.8,
    ...extra,
  })

  it('says unknown, not verified, when the elbows were not judged', () => {
    expect(cleanEvidence(auto({ unseen: ['elbows'] }))).toEqual({ state: 'unknown', reason: 'elbows' })
    expect(verifiedCleanSeconds(auto({ unseen: ['elbows'] }))).toBeUndefined()
  })

  it('says none when a bend was held inside the window, whatever the raw time', () => {
    expect(cleanEvidence(auto({ issues: ['arms'], heldIssues: ['arms'] }))).toEqual({ state: 'fault', seconds: 0 })
  })

  it('says unknown when the camera saw too little of the hold', () => {
    expect(cleanEvidence(auto({ coverage: 0.4 }))).toEqual({ state: 'unknown', reason: 'coverage' })
    expect(cleanEvidence(auto({ coverage: 0.9 }))).toMatchObject({ state: 'verified', seconds: 8 })
  })

  it('never shows a full "Verified clean" score next to a held arm fault', () => {
    const verdict = tuck({ noise: 0, elbowBendDeg: 15 })
    expect(verdict.heldIssues).toContain('arms')
    expect(verdict.subscores?.find((s) => s.key === 'cleanTime')?.score).toBe(0)
  })

  it('leaves Verified clean out of the score when the elbows were not seen', () => {
    const clip = synthesizeClip({ ...IDEAL['tuck-planche'], noise: 0, frames: 24 })
    for (const frame of clip.tracked) for (const point of frame.kps) if (point.name?.endsWith('_elbow')) point.score = 0.05
    const verdict = judgeTrackedFrames(clip, 'tuck-planche')
    expect(verdict.unseen).toContain('elbows')
    expect(verdict.subscores?.some((s) => s.key === 'cleanTime')).toBe(false)
  })

  it('is recorded as a new judge version', () => {
    expect(JUDGE_VERSION).toBeGreaterThanOrEqual(4)
  })
})

describe('PJ-02: credit belongs to the stretch of clip that was checked', () => {
  const qualifying = (timing: SetLog['timing'], value: number, auto: AutoForm): SetLog => ({
    exerciseId: 'tuck-planche',
    kind: 'hold',
    value,
    target: 5,
    section: 'main',
    at: 0,
    ...(timing ? { timing } : {}),
    form: { rating: 'clean', confirmed: true, flightConfirmed: true, auto },
  })
  const checked: AutoForm = { issues: [], confidence: 0.9, cleanSeconds: 6, cleanRatio: 1, analysedFromSec: 2, analysedSec: 6 }

  it('gives a hold re-timed to a disjoint stretch no credit until it is checked again', () => {
    const moved = qualifying({ method: 'video', videoStartSec: 20, videoEndSec: 26 }, 6, checked)
    expect(progressionCredit(moved, 'tuck-planche')).toBe(0)
    const same = qualifying({ method: 'video', videoStartSec: 2, videoEndSec: 8 }, 6, checked)
    expect(progressionCredit(same, 'tuck-planche')).toBe(6)
  })

  it('caps a same-start extension at what was verified, and credits a shortened hold its own length', () => {
    const longer = qualifying({ method: 'video', videoStartSec: 2, videoEndSec: 12 }, 10, checked)
    expect(progressionCredit(longer, 'tuck-planche')).toBe(6)
    const shorter = qualifying({ method: 'video', videoStartSec: 2, videoEndSec: 6 }, 4, checked)
    expect(progressionCredit(shorter, 'tuck-planche')).toBe(4)
  })

  it('keeps stopwatch holds as before: credit up to the verified clean time', () => {
    const stopwatch = qualifying(undefined, 9, { ...checked, analysedFromSec: undefined, cleanSeconds: 7 })
    expect(progressionCredit(stopwatch, 'tuck-planche')).toBe(7)
  })

  it('refuses a late reading taken over a different start than the hold has now', () => {
    const now = countedClipWindow({ value: 1, timing: { method: 'video', videoStartSec: 40, videoEndSec: 41 } })
    expect(readingFitsWindow({ analysedFromSec: 28 }, now)).toBe(false)
    expect(readingFitsWindow({ analysedFromSec: 40 }, now)).toBe(true)
  })
})

describe('a recording shorter than its hold', () => {
  // Found end to end: a camera stream that delivered almost no frames made a
  // 0.015s clip of a 2.9s hold, graded as the whole hold — "18 usable of 18"
  // moments that were one picture, and a breakdown the camera never saw.
  const filmed = (durationSec: number, creditedHoldSec: number, overrides: SynthParams = {}) =>
    judgeTrackedFrames(
      {
        ...synthesizeClip({ ...IDEAL['tuck-planche'], frames: Math.max(3, Math.round(durationSec * 3)), durationSec, seed: 5, ...overrides }),
        creditedHoldSec,
      },
      'tuck-planche',
    )

  it('refuses under a second of footage instead of grading one picture as the hold', () => {
    const verdict = filmed(0.015, 2.9)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/under a second of this 2\.9s hold/)
  })

  it('reads a recording that stopped partway for what it filmed, and says what it missed', () => {
    // 3.93s, not 4: a window that does not end on a tenth is the one the old
    // rounded comparison misread as a loss of position.
    const verdict = filmed(3.93, 8, { noise: 0 })
    expect(verdict.ok).toBe(true)
    expect(verdict.unfilmedSec).toBe(4.1)
    expect(verdict.issues).toEqual([])
    // Verified time never reaches past the footage...
    expect(verdict.cleanSeconds!).toBeLessThanOrEqual(3.93)
    expect(verdict.cleanSeconds!).toBeGreaterThan(3.5)
    // ...the ratio describes the filmed part, so a clean film is not "broke"...
    expect(verdict.cleanRatio!).toBeGreaterThan(0.95)
    // ...and the end of the footage is not reported as a loss of position.
    expect(verdict.notes.join(' ')).toMatch(/recording stopped 4\.1s before your hold ended/)
    expect(verdict.notes.join(' ')).not.toMatch(/tolerant envelope|stopped seeing a complete/)
  })

  it('does not disclose the recorder start-up gap, and judges a full recording as before', () => {
    expect(filmed(7.85, 8, { noise: 0 }).unfilmedSec).toBeUndefined()
    expect(filmed(8, 8, { noise: 0 }).unfilmedSec).toBeUndefined()
  })

  const set = (auto: AutoForm, rating: 'clean' | 'slipped' = 'clean'): SetLog => ({
    exerciseId: 'tuck-planche',
    kind: 'hold',
    value: 8,
    target: 5,
    section: 'main',
    at: 0,
    form: { rating, confirmed: true, flightConfirmed: true, auto },
  })
  const stopped: AutoForm = {
    issues: [],
    confidence: 0.9,
    elbowDeg: 178,
    cleanSeconds: 4,
    cleanRatio: 1,
    unfilmedSec: 4,
    analysedSec: 8,
  }

  it('credits progression only for the filmed clean seconds, but keeps the whole training dose', () => {
    expect(progressionCredit(set(stopped), 'tuck-planche')).toBe(4)
    expect(trainingSetValue(set(stopped))).toBe(8)
  })

  it('still caps the dose where a breakdown was seen inside the footage', () => {
    // Clean for 2s, then a breakdown the camera filmed (and the athlete agreed
    // with), then the recording stopped.
    const brokeInFootage = { ...stopped, cleanSeconds: 2, cleanRatio: 0.5, issues: ['lean' as const] }
    expect(trainingSetValue(set(brokeInFootage, 'slipped'))).toBe(2)
  })
})
