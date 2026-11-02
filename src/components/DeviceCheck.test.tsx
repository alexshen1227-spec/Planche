// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceCheck } from './DeviceCheck'
import { deviceCheckAdvice, readDeviceCheck, summarizeDeviceCheck } from '../lib/deviceCheck'

/**
 * "Check this phone" opens the camera for a preview, so it carries the same
 * contract as the recorder: every track it opens is stopped on every way out.
 */

interface FakeTrack {
  readyState: 'live' | 'ended'
  stop: () => void
}
let tracks: FakeTrack[] = []

function fakeStream() {
  const track: FakeTrack = {
    readyState: 'live',
    stop() {
      track.readyState = 'ended'
    },
  }
  tracks.push(track)
  return { getTracks: () => [track], getVideoTracks: () => [track] }
}

beforeEach(() => {
  tracks = []
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fakeStream()) },
  })
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
})
afterEach(() => cleanup())

// Sound and voice off skip straight to the camera step.
const atCamera = () => render(<DeviceCheck soundOn={false} voiceOn={false} onDone={() => undefined} />)
const toCamera = () => {
  fireEvent.click(screen.getByText('Next'))
  fireEvent.click(screen.getByText('Next'))
}

describe('the phone check’s camera preview', () => {
  it('stops the preview when the athlete moves on', async () => {
    atCamera()
    toCamera()
    await act(async () => {
      fireEvent.click(screen.getByText('Open the camera'))
    })
    expect(tracks.filter((t) => t.readyState === 'live')).toHaveLength(1)
    fireEvent.click(screen.getByText('I can see the picture — next'))
    expect(tracks.filter((t) => t.readyState === 'live')).toHaveLength(0)
  })

  it('stops the preview when the check is closed mid-way', async () => {
    const view = atCamera()
    toCamera()
    await act(async () => {
      fireEvent.click(screen.getByText('Open the camera'))
    })
    view.unmount()
    expect(tracks.filter((t) => t.readyState === 'live')).toHaveLength(0)
  })

  it('stops a camera that arrives after the check was closed', async () => {
    // The permission sheet is up when the athlete closes the check: the
    // unmount cleanup has already run by the time the stream exists.
    let resolve: (s: ReturnType<typeof fakeStream>) => void = () => undefined
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => new Promise((r) => (resolve = r))) },
    })
    const view = atCamera()
    toCamera()
    await act(async () => {
      fireEvent.click(screen.getByText('Open the camera'))
    })
    view.unmount()
    await act(async () => {
      resolve(fakeStream())
    })
    expect(tracks).toHaveLength(1)
    expect(tracks.filter((t) => t.readyState === 'live')).toHaveLength(0)
  })

  it('names a refused camera instead of failing silently', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
        }),
      },
    })
    atCamera()
    toCamera()
    await act(async () => {
      fireEvent.click(screen.getByText('Open the camera'))
    })
    expect(screen.getByText('Camera access was refused.')).toBeTruthy()
  })
})

describe('what the phone check tells the athlete', () => {
  it('gives a fix for each failure, and none when everything works', () => {
    const ok = { at: 0, sound: true, voice: true, camera: 'live' as const, recorder: true, wakeLock: true, share: true }
    expect(deviceCheckAdvice(ok)).toEqual([])
    const advice = deviceCheckAdvice({ ...ok, sound: false, camera: 'denied', wakeLock: false })
    expect(advice).toHaveLength(3)
    expect(advice[0]).toMatch(/silent switch/)
    expect(advice[1]).toMatch(/Camera blocked/)
    expect(advice[2]).toMatch(/auto-lock/)
  })

  it('summarises a result to paste, and keeps it on this device', () => {
    const r = { at: Date.UTC(2026, 10, 1), sound: false, camera: 'live' as const, recorder: true }
    const text = summarizeDeviceCheck(r, 'TestPhone')
    expect(text).toMatch(/Chime heard: no/)
    expect(text).toMatch(/Voice heard: not checked/)
    expect(text).toMatch(/Camera: live \(can record: yes\)/)
    localStorage.setItem('planchelab.deviceCheck', JSON.stringify(r))
    expect(readDeviceCheck()).toEqual(r)
    localStorage.setItem('planchelab.deviceCheck', '{broken')
    expect(readDeviceCheck()).toBeNull()
  })
})
