import { describe, expect, it } from 'vitest'
import { fixtureFromPoses, selfTestJudge } from './benchTools'
import { judgeTrackedFrames } from './poseForm'
import { IDEAL, synthesizeClip } from './poseSynth'

describe('the shipped self-test', () => {
  it('passes every promise it protects', () => {
    const report = selfTestJudge()
    const failing = report.checks.filter((check) => !check.pass)
    expect(failing).toEqual([])
    expect(report.pass).toBe(true)
    // The bench shows this to athletes as a transparency feature, so the list
    // has to stay meaningful: every graded position plus every fault family.
    expect(report.checks.length).toBeGreaterThanOrEqual(18)
  })

  it('names every check uniquely so a failure is unambiguous', () => {
    const report = selfTestJudge(1)
    const names = report.checks.map((check) => check.name)
    expect(new Set(names).size).toBe(names.length)
    // A passing check carries no failure detail — the athlete-facing list
    // stays quiet unless something is actually wrong.
    for (const check of report.checks.filter((c) => c.pass)) {
      expect(check.detail).toBeUndefined()
    }
  })
})

describe('fixture capture', () => {
  it('freezes poses in exactly the REAL_POSES shape, joints ordered and rounded', () => {
    const poses = synthesizeClip({ ...IDEAL['tuck-planche'], seed: 2 })
    const { entry, code } = fixtureFromPoses('sample', 'A synthetic tuck used to test capture.', poses)
    expect(entry.width).toBe(poses.width)
    expect(entry.rotation).toBe(0)
    // Both sides of the seven core joints the synthetic clip carries.
    expect(entry.points.length).toBe(14)
    for (const [name, x, y, score] of entry.points) {
      expect(typeof name).toBe('string')
      expect(x).toBeCloseTo(Math.round(x * 10) / 10, 6)
      expect(y).toBeCloseTo(Math.round(y * 10) / 10, 6)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
    expect(code).toContain("sample: {")
    expect(code).toContain('truth:')
    expect(code).toContain("['left_shoulder'")
  })
})

describe('verdict explanation', () => {
  it('is absent unless asked for, and never part of the plain verdict', () => {
    const clip = synthesizeClip({ ...IDEAL['tuck-planche'], seed: 3 })
    expect(judgeTrackedFrames(clip, 'tuck-planche').explain).toBeUndefined()
  })

  it('shows exactly which moments convicted a mid-hold collapse', () => {
    const clip = synthesizeClip({
      ...IDEAL['tuck-planche'],
      durationSec: 12,
      frames: 40,
      elbowBendDeg: (p: number) => (p < 0.5 ? -2 : (p - 0.5) * 80),
      seed: 3,
    })
    const verdict = judgeTrackedFrames(clip, 'tuck-planche', { explain: true })
    const explain = verdict.explain!
    expect(explain).toBeDefined()
    expect(verdict.issues).toContain('arms')
    expect(explain.sustainedFaults).toContain('arms')
    expect(explain.frames.length).toBe(verdict.framesUsed)
    expect(explain.envelope.length).toBe(verdict.framesSampled)

    // The working must agree with the verdict it explains: clean early
    // moments carry no issues, the collapsed tail names the arms.
    const early = explain.envelope.filter((moment) => moment.t < 4)
    const late = explain.envelope.filter((moment) => moment.t > 9)
    expect(early.every((moment) => moment.issues.length === 0)).toBe(true)
    expect(late.some((moment) => moment.issues.includes('arms'))).toBe(true)
    const firstBad = explain.envelope.find((moment) => moment.bad === true)
    expect(firstBad).toBeDefined()
    expect(firstBad!.t).toBeGreaterThanOrEqual(verdict.cleanSeconds! - 0.5)
  })
})
