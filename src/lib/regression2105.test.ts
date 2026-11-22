import { describe, expect, it } from 'vitest'
import { IDEAL, synthesizeClip } from './poseSynth'
import { judgeTrackedFrames, type JudgeInput } from './poseForm'
import { UNCALIBRATED_LOCKOUT_DEG } from './lockout'
import { lockoutFromVerdict } from './lockoutCalibration'

/**
 * The athlete's clip 2105.mp4 — "a clean ~10s tuck planche" — should verify
 * as clean. The clip itself is not in this repo (it was not on the machine
 * this was written on, and no free-licence side-on tuck could be found to
 * stand in), so this rebuilds it from what was reported and from the three
 * things that kept it from verifying:
 *
 * - filmed with the phone on its side under rotation lock (the recording is
 *   portrait, the floor along one edge), hips held above the shoulders;
 * - locked arms that a 2D model reads at about 169°;
 * - a setup with the feet on the floor before the lift, and the landing,
 *   inside the analysed window.
 *
 * When the real clip is available, freeze it with `fixtureFromPoses()` into
 * `realClips.fixture.ts` and assert the same thing on it.
 */
const SECONDS = 12.5
/** Feet down for the first ~1.4s and the last ~0.9s; between, hips held above the shoulders. */
const hips = (p: number) => (p < 0.11 || p > 0.93 ? -0.65 : 0.2)

function turnSideways(clip: JudgeInput): JudgeInput {
  return {
    ...clip,
    width: clip.height,
    height: clip.width,
    tracked: clip.tracked.map((f) => ({ t: f.t, kps: f.kps.map((k) => ({ ...k, x: clip.height - k.y, y: k.x })) })),
  }
}

const clip2105 = (seed: number, elbowBendDeg: number) =>
  turnSideways(
    synthesizeClip({ ...IDEAL['tuck-planche'], seed, durationSec: SECONDS, hipOffset: hips, elbowBendDeg, noise: 0.02 }),
  )

function expectCleanHold(v: ReturnType<typeof judgeTrackedFrames>) {
  expect(v.ok).toBe(true)
  expect(v.frameTurned).toBe('left')
  expect(v.issues).toEqual([])
  expect(v.unseen).toEqual([])
  expect(v.holdWindow?.setupSec).toBeGreaterThan(1)
  const held = v.holdWindow!.endSec - v.holdWindow!.startSec
  expect(held).toBeGreaterThan(9.5)
  expect(v.cleanSeconds!).toBeGreaterThan(held - 0.5)
}

describe('regression: a clean ~10s tuck filmed sideways (2105.mp4, as reported)', () => {
  for (let seed = 1; seed <= 10; seed++) {
    it(`verifies clean before calibrating, arms reading about 171° (seed ${seed})`, () => {
      expectCleanHold(judgeTrackedFrames({ ...clip2105(seed, 9), lockoutDeg: UNCALIBRATED_LOCKOUT_DEG }, 'tuck-planche'))
    })
    it(`verifies clean once a lower-reading lockout is calibrated (seed ${seed})`, () => {
      // Calibrate from a separate few seconds of the same locked arm, as
      // Settings → Lockout calibration does — re-filming, as an athlete would,
      // when a clip's elbows are too uncertain to read.
      let lockout = lockoutFromVerdict({ ok: false })
      for (let take = 1; take <= 3 && lockout.kind !== 'measured'; take++) {
        lockout = lockoutFromVerdict(
          judgeTrackedFrames(
            synthesizeClip({ ...IDEAL['tuck-planche'], seed: seed + 100 * take, elbowBendDeg: 12, noise: 0.02 }),
            'lockout-check',
            { explain: true },
          ),
        )
      }
      expect(lockout.kind).toBe('measured')
      if (lockout.kind !== 'measured') return
      expectCleanHold(judgeTrackedFrames({ ...clip2105(seed, 12), lockoutDeg: lockout.deg }, 'tuck-planche'))
    })
  }
})
