import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureAudio, primeSignal, releaseSignal, unlockAudio } from './audio'

/**
 * The silent switch on an iPhone mutes Web Audio unless Safari's audio
 * session is "playback". Decisions asserted on a stubbed session: the
 * athlete's setting picks the type, and the walk-back measurement plays
 * through the switch for its own duration only.
 */
describe('audio session type', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('follows the athlete’s choice, and the measurement borrows playback', () => {
    const session = { type: 'auto' }
    vi.stubGlobal('navigator', { audioSession: session })
    configureAudio(true, true, 0.7, false)
    expect(session.type).toBe('ambient')
    primeSignal()
    expect(session.type).toBe('playback')
    releaseSignal()
    expect(session.type).toBe('ambient')
    configureAudio(true, true, 0.7, true)
    expect(session.type).toBe('playback')
    releaseSignal()
    expect(session.type).toBe('playback')
  })

  it('does nothing where the browser has no audio session', () => {
    vi.stubGlobal('navigator', {})
    expect(() => configureAudio(true, true, 0.7, true)).not.toThrow()
    expect(() => releaseSignal()).not.toThrow()
  })
})

describe('unlocking audio from a tap', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('primes speech once with a silent utterance, and resumes the context on every tap', () => {
    // iOS speaks and plays only from a gesture; every cue in a hold comes from
    // a timer, so a tap has to have unlocked both first.
    const resume = vi.fn(() => Promise.resolve())
    class FakeContext {
      state = 'suspended'
      resume = resume
    }
    const speak = vi.fn()
    class FakeUtterance {
      volume = 1
      constructor(public text: string) {}
    }
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('AudioContext', FakeContext)
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() })
    configureAudio(true, true, 0.7)
    unlockAudio()
    unlockAudio()
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0][0]).toMatchObject({ volume: 0 })
    expect(resume).toHaveBeenCalledTimes(2)
  })
})
