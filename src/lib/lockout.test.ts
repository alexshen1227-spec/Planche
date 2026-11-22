import { describe, expect, it } from 'vitest'
import { IDEAL, synthesizeClip } from './poseSynth'
import { judgeTrackedFrames, POSE_PROFILES, withLockout } from './poseForm'
import { lockoutReference, MIN_LOCKOUT_DEG, UNCALIBRATED_LOCKOUT_DEG } from './lockout'
import { lockoutFromReadings, lockoutFromVerdict, MIN_LOCKOUT_READINGS } from './lockoutCalibration'
import { REAL_CLIPS } from './realClips.fixture'

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]
const tuck = (bend: number, seed: number, lockoutDeg?: number) =>
  judgeTrackedFrames(
    { ...synthesizeClip({ ...IDEAL['tuck-planche'], elbowBendDeg: bend, seed }), ...(lockoutDeg !== undefined ? { lockoutDeg } : {}) },
    'tuck-planche',
  )

describe('lockout reference (judge v8)', () => {
  it('an arm that reads 168° is a named bend from 180, and locked from the uncalibrated reference', () => {
    for (const seed of SEEDS) {
      expect(tuck(14, seed).issues, `seed ${seed} at 180`).toContain('arms')
      const v = tuck(12, seed, UNCALIBRATED_LOCKOUT_DEG)
      expect(v.issues, `seed ${seed} uncalibrated`).not.toContain('arms')
      expect(v.lockoutDeg).toBe(UNCALIBRATED_LOCKOUT_DEG)
    }
  })

  it('moves the zero point only: a real bend past the athlete’s lockout is still named', () => {
    for (const seed of SEEDS) {
      // Calibrated at 168: a further 22° (reading ~146°) is a bend on any camera.
      expect(tuck(34, seed, 168).issues, `seed ${seed}`).toContain('arms')
      expect(tuck(34, seed, UNCALIBRATED_LOCKOUT_DEG).issues, `seed ${seed}`).toContain('arms')
      // And their own locked arm reads clean against their own reference.
      expect(tuck(12, seed, 168).issues, `seed ${seed}`).not.toContain('arms')
    }
  })

  it('never passes the athlete’s visibly soft real elbows before calibrating', () => {
    // Named, or — where the readings scatter too widely to accuse — unseen,
    // which blocks progression credit. Never a pass for the arms.
    for (const clip of [REAL_CLIPS.sidewaysTuck, REAL_CLIPS.bentArmTuck]) {
      const v = judgeTrackedFrames({ ...clip.input, lockoutDeg: UNCALIBRATED_LOCKOUT_DEG }, clip.exerciseId)
      expect(v.issues.includes('arms') || v.unseen.includes('elbows')).toBe(true)
    }
    // The clearer of the two is still a named bend.
    const upright = judgeTrackedFrames({ ...REAL_CLIPS.bentArmTuck.input, lockoutDeg: UNCALIBRATED_LOCKOUT_DEG }, 'tuck-planche')
    expect(upright.issues).toContain('arms')
  })

  it('applies to straight-arm support holds only', () => {
    expect(withLockout(POSE_PROFILES['tuck-planche'], 168).minElbowDeg).toBe(168)
    expect(withLockout(POSE_PROFILES['tuck-planche'], undefined).minElbowDeg).toBe(180)
    for (const id of Object.keys(POSE_PROFILES)) {
      const p = POSE_PROFILES[id]
      const moved = withLockout(p, 168)
      if ((p.posture ?? 'support') !== 'support' || p.minElbowDeg !== 180) expect(moved, id).toBe(p)
    }
  })

  it('clamps the reference, and absent means a textbook 180', () => {
    expect(lockoutReference(undefined)).toBe(180)
    expect(lockoutReference(Number.NaN)).toBe(180)
    expect(lockoutReference(150)).toBe(MIN_LOCKOUT_DEG)
    expect(lockoutReference(190)).toBe(180)
    expect(tuck(0, 1).lockoutDeg).toBeUndefined()
  })
})

describe('lockout calibration', () => {
  it('measures the median of the readings', () => {
    const m = lockoutFromReadings([167, 168, 169, 170, 168, 167, 169, undefined])
    expect(m).toEqual({ kind: 'measured', deg: 168, readings: 7, spread: 1 })
  })
  it('refuses too few readings', () => {
    const few = Array.from({ length: MIN_LOCKOUT_READINGS - 1 }, () => 170)
    expect(lockoutFromReadings(few).kind).toBe('refused')
  })
  it('refuses a reading that is itself a bend, so calibrating cannot excuse soft elbows', () => {
    const bent = lockoutFromReadings([150, 152, 151, 149, 153, 150, 151])
    expect(bent.kind).toBe('refused')
  })
  it('passes the judge’s own refusal through rather than “no readings”', () => {
    const refused = lockoutFromVerdict({ ok: false, reason: 'Could not see your elbows well enough to judge anything here.' })
    expect(refused).toEqual({ kind: 'refused', reason: 'Could not see your elbows well enough to judge anything here.' })
  })
  it('never stores more than 180', () => {
    const m = lockoutFromReadings([181, 182, 180, 183, 181, 182])
    expect(m.kind === 'measured' && m.deg).toBe(180)
  })
})
