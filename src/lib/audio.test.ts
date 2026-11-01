import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureAudio, primeSignal, releaseSignal } from './audio'

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
