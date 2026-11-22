import { describe, expect, it } from 'vitest'
import { IDEAL, synthesizeClip } from './poseSynth'
import { floorEdge, judgeTrackedFrames, POSE_PROFILES, postureOf, turnUpright } from './poseForm'
import { FEET_OFF_HOLDS, findHoldWindow, readHoldMoment } from './holdWindow'
import { REAL_CLIPS } from './realClips.fixture'

const moments = (input: ReturnType<typeof synthesizeClip> | (typeof REAL_CLIPS)['sidewaysTuck']['input'], id: string) => {
  const floor = floorEdge(input.tracked, postureOf(POSE_PROFILES[id])) ?? 'bottom'
  return input.tracked.map((f) => readHoldMoment(f.t, turnUpright(f.kps, floor)))
}
/** Hips dropped with the feet on the floor before the lift, and again on the way down. */
const setupAndExit = (p: number) => (p < 0.15 || p > 0.9 ? -0.65 : 0)

describe('the hold window (judge v8)', () => {
  it('never trims a steady hold', () => {
    for (const id of Object.keys(IDEAL)) {
      if (!POSE_PROFILES[id] || POSE_PROFILES[id].noChecks) continue
      for (let seed = 1; seed <= 12; seed++) {
        const w = findHoldWindow(moments(synthesizeClip({ ...IDEAL[id], seed }), id), FEET_OFF_HOLDS.has(id))
        expect(w?.trimmed ?? false, `${id} seed ${seed}`).toBe(false)
        expect(judgeTrackedFrames(synthesizeClip({ ...IDEAL[id], seed }), id).holdWindow, id).toBeUndefined()
      }
    }
  })

  it('finds the athlete’s real setup and judges from the lift', () => {
    for (const clip of [REAL_CLIPS.sidewaysTuck, REAL_CLIPS.bentArmTuck]) {
      const w = findHoldWindow(moments(clip.input, clip.exerciseId), true)!
      expect(w.trimmed).toBe(true)
      expect(w.start).toBeGreaterThan(1)
      expect(w.start).toBeLessThan(1.6)
      const v = judgeTrackedFrames(clip.input, clip.exerciseId)
      expect(v.holdWindow?.setupSec).toBeGreaterThan(0.9)
      // The fault the clip really has is still found inside the hold.
      expect(v.issues).toContain('arms')
    }
  })

  it('does not judge setup or exit: a clean tuck with feet down either side is not a sag', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const clip = synthesizeClip({ ...IDEAL['tuck-planche'], seed, hipOffset: setupAndExit })
      const v = judgeTrackedFrames(clip, 'tuck-planche')
      expect(v.ok, `seed ${seed}`).toBe(true)
      expect(v.issues, `seed ${seed}`).not.toContain('sag')
      expect(v.holdWindow, `seed ${seed}`).toBeDefined()
      expect(v.holdWindow!.setupSec).toBeGreaterThan(0.5)
      expect(v.holdWindow!.exitSec).toBeGreaterThan(0.3)
      // The hold itself verifies: clean time covers it rather than ending at a setup "fault".
      expect(v.cleanSeconds!, `seed ${seed}`).toBeGreaterThan(0.8 * (v.holdWindow!.endSec - v.holdWindow!.startSec) - 0.5)
    }
  })

  it('keeps a fault in the middle of the hold', () => {
    const midSag = (p: number) => (p > 0.35 && p < 0.75 ? -0.4 : 0)
    for (let seed = 1; seed <= 6; seed++) {
      const v = judgeTrackedFrames(synthesizeClip({ ...IDEAL['full-planche'], seed, hipOffset: midSag }), 'full-planche')
      expect(v.issues, `seed ${seed}`).toContain('sag')
    }
  })
})

describe('the floor of a hips-high hold filmed sideways (judge v8)', () => {
  const turn = (clip: ReturnType<typeof synthesizeClip>, how: 'cw' | 'ccw') => ({
    ...clip,
    width: clip.height,
    height: clip.width,
    tracked: clip.tracked.map((f) => ({
      t: f.t,
      kps: f.kps.map((k) => (how === 'cw' ? { ...k, x: clip.height - k.y, y: k.x } : { ...k, x: k.y, y: clip.width - k.x })),
    })),
  })
  it('turns it back, and still leaves an upright one alone', () => {
    for (const id of [...FEET_OFF_HOLDS]) {
      if (!IDEAL[id]) continue
      for (const hipOffset of [0.3, 0.5])
        for (const rollDeg of [-10, 0, 10])
          for (const facing of [1, -1] as const) {
            const clip = synthesizeClip({ ...IDEAL[id], hipOffset, rollDeg, facing, seed: 3, noise: 0.02 })
            expect(floorEdge(clip.tracked), `${id} upright`).toBe('bottom')
            expect(floorEdge(turn(clip, 'cw').tracked), `${id} ${hipOffset} cw roll ${rollDeg}`).toBe('left')
            expect(floorEdge(turn(clip, 'ccw').tracked), `${id} ${hipOffset} ccw roll ${rollDeg}`).toBe('right')
          }
    }
  })
})
