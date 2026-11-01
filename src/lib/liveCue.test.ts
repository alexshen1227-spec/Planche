import { describe, expect, it } from 'vitest'
import { IDEAL, synthesizeClip, type SynthParams } from './poseSynth'
import { CUE_SETTLE_SEC, elbowCueDue, liveElbowDeg, type LiveReading } from './liveCue'

/** Feed a synthetic hold through the live path, frame by frame, as the camera would. */
function cueTime(id: string, extra: SynthParams, seed: number): number | null {
  const clip = synthesizeClip({ ...IDEAL[id], frames: 26, durationSec: 10, seed, ...extra })
  const readings: LiveReading[] = []
  for (const frame of clip.tracked) {
    readings.push({ t: frame.t, elbowDeg: liveElbowDeg(frame.kps, clip.width, clip.height) })
    if (elbowCueDue(readings)) return frame.t
  }
  return null
}

describe('live elbow cue', () => {
  it('never speaks over exactly straight arms at measured landmark noise', () => {
    for (const id of ['tuck-planche', 'adv-tuck-planche', 'straddle-planche', 'full-planche', 'planche-lean']) {
      for (let seed = 1; seed <= 60; seed++) {
        expect(cueTime(id, { elbowBendDeg: 0, noise: 0.02 }, seed)).toBeNull()
      }
    }
  })

  it('speaks within a couple of seconds of a clear bend', () => {
    let caught = 0
    for (let seed = 1; seed <= 20; seed++) {
      const t = cueTime('tuck-planche', { elbowBendDeg: (p) => (p >= 0.4 ? 25 : -2), noise: 0.015 }, seed)
      if (t !== null && t >= 4 && t <= 6.5) caught++
    }
    expect(caught).toBeGreaterThanOrEqual(18)
  })

  it('ignores the entry, and one bad reading', () => {
    const entry: LiveReading[] = [0.2, 0.5, 0.8].map((t) => ({ t, elbowDeg: 140 }))
    expect(elbowCueDue(entry)).toBe(false)
    const blip: LiveReading[] = [1.2, 1.6, 2.0, 2.4].map((t, i) => ({ t, elbowDeg: i === 2 ? 140 : 179 }))
    expect(elbowCueDue(blip)).toBe(false)
    const sustained: LiveReading[] = [1.2, 1.6, 2.0, 2.4].map((t) => ({ t, elbowDeg: 150 }))
    expect(elbowCueDue(sustained)).toBe(true)
    // An unreadable moment breaks the run rather than counting as bent.
    const gap: LiveReading[] = [1.2, 1.6, 2.0].map((t, i) => ({ t, elbowDeg: i === 1 ? undefined : 150 }))
    expect(elbowCueDue(gap)).toBe(false)
    expect(CUE_SETTLE_SEC).toBeGreaterThan(0)
  })

  it('stays quiet when the view is not side-on', () => {
    const clip = synthesizeClip({ ...IDEAL['tuck-planche'], noise: 0, frames: 12, bodyWidth: 0.65, farScore: 0.9, elbowBendDeg: 30 })
    for (const frame of clip.tracked) expect(liveElbowDeg(frame.kps, clip.width, clip.height)).toBeUndefined()
  })
})
