import { describe, expect, it } from 'vitest'
import { IDEAL, synthesizeClip } from './poseSynth'
import { judgeTrackedFrames, type JudgeInput } from './poseForm'

/**
 * Screen y grows downward, so every vertical comparison in the judge is one
 * sign slip from reading "hips above the shoulders" as sagging. These pin each
 * one by its decision, in every picture orientation the app can be handed (the
 * phone upright, on either side under rotation lock, upside down) and with the
 * athlete facing either way.
 */
type How = 'upright' | 'cw' | 'ccw' | 'flip'
const HOWS: How[] = ['upright', 'cw', 'ccw', 'flip']

function transform(clip: JudgeInput, how: How, mirror: boolean): JudgeInput {
  const W = clip.width
  const H = clip.height
  const mirrored = mirror
    ? clip.tracked.map((f) => ({ t: f.t, kps: f.kps.map((k) => ({ ...k, x: W - k.x })) }))
    : clip.tracked
  if (how === 'upright') return { ...clip, tracked: mirrored }
  return {
    ...clip,
    width: how === 'flip' ? W : H,
    height: how === 'flip' ? H : W,
    tracked: mirrored.map((f) => ({
      t: f.t,
      kps: f.kps.map((k) =>
        how === 'cw'
          ? { ...k, x: H - k.y, y: k.x }
          : how === 'ccw'
            ? { ...k, x: k.y, y: W - k.x }
            : { ...k, x: W - k.x, y: H - k.y },
      ),
    })),
  }
}

const judge = (id: string, extra: Record<string, number>, how: How, mirror: boolean, seed = 3) =>
  judgeTrackedFrames(transform(synthesizeClip({ ...IDEAL[id], seed, ...extra }), how, mirror), id)

describe('vertical sign conventions (y grows downward)', () => {
  for (const how of HOWS) {
    for (const mirror of [false, true]) {
      const label = `${how}${mirror ? ', facing the other way' : ''}`

      it(`hips above the shoulders are never sagging (${label})`, () => {
        // A tuck allows 0.22 either way; 0.5 above is a pike, never a sag.
        const high = judge('tuck-planche', { hipOffset: 0.5 }, how, mirror)
        expect(high.hipOffset!).toBeGreaterThan(0.3)
        expect(high.issues).not.toContain('sag')
        expect(high.issues).toContain('pike')
        // And a hip a little above level is no fault at all.
        const level = judge('tuck-planche', { hipOffset: 0.12 }, how, mirror)
        expect(level.issues).not.toContain('sag')
        expect(level.issues).not.toContain('pike')
      })

      it(`hips below the shoulders are sagging, never piking (${label})`, () => {
        const low = judge('full-planche', { hipOffset: -0.45 }, how, mirror)
        expect(low.hipOffset!).toBeLessThan(-0.3)
        expect(low.issues).toContain('sag')
        expect(low.issues).not.toContain('pike')
      })

      it(`lean is measured toward the head (${label})`, () => {
        const leaning = judge('tuck-planche', { leanRatio: 0.6 }, how, mirror)
        expect(leaning.leanRatio!).toBeGreaterThan(0.45)
        expect(leaning.issues).not.toContain('lean')
        const upright = judge('tuck-planche', { leanRatio: 0.02 }, how, mirror)
        expect(upright.leanRatio!).toBeLessThan(0.15)
        expect(upright.issues).toContain('lean')
      })

      it(`a shrug is a short shoulder-to-ear gap, whichever way the picture lies (${label})`, () => {
        const neutral = judge('tuck-planche', {}, how, mirror)
        const shrugged = judge('tuck-planche', { shrugGap: 0.12 }, how, mirror)
        expect(neutral.issues).not.toContain('shrug')
        expect(shrugged.issues).toContain('shrug')
        expect(shrugged.shrugRatio!).toBeLessThan(neutral.shrugRatio!)
      })
    }
  }

  it('reads the same numbers in every orientation', () => {
    const base = judge('tuck-planche', { hipOffset: 0.15, leanRatio: 0.5 }, 'upright', false)
    for (const how of HOWS) {
      for (const mirror of [false, true]) {
        const v = judge('tuck-planche', { hipOffset: 0.15, leanRatio: 0.5 }, how, mirror)
        expect(v.hipOffset!).toBeCloseTo(base.hipOffset!, 2)
        expect(v.leanRatio!).toBeCloseTo(base.leanRatio!, 2)
        expect(v.issues).toEqual(base.issues)
      }
    }
  })
})
