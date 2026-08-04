// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ownsCameraAttempt, useFormRecorder } from './recorder'

/**
 * Camera lifecycle, against a simulated device.
 *
 * This is the one part of the app that had never been exercised at all — only
 * read. It cannot be: `getUserMedia` needs hardware, and every previous audit
 * could do no better than reason about the code. A fake device does not prove
 * a real camera light goes out, but it does prove the thing underneath it —
 * that every track this app opens is stopped on every exit path, and that a
 * retired request can never strand or overwrite a live one. Those are the
 * failures that leave the indicator burning on someone's phone.
 */

interface FakeTrack {
  kind: string
  readyState: 'live' | 'ended'
  label: string
  stop: () => void
  getSettings: () => { width: number; height: number }
  getCapabilities: () => { width: { max: number }; height: { max: number }; zoom: { min: number } }
  applyConstraints: (c: unknown) => Promise<void>
}

let openedStreams: { track: FakeTrack; stream: FakeStream }[] = []
let pendingOpens: { resolve: (s: FakeStream) => void; reject: (e: unknown) => void }[] = []
let constraintGate: (() => void) | null = null

interface FakeStream {
  id: number
  getTracks: () => FakeTrack[]
  getVideoTracks: () => FakeTrack[]
}

function makeStream(label = 'back camera'): FakeStream {
  const track: FakeTrack = {
    kind: 'video',
    readyState: 'live',
    label,
    stop() {
      track.readyState = 'ended'
    },
    getSettings: () => ({ width: 1280, height: 720 }),
    getCapabilities: () => ({ width: { max: 1920 }, height: { max: 1080 }, zoom: { min: 1 } }),
    applyConstraints: async () => {
      // Lets a test hold the open sequence mid-flight, which is exactly when
      // an impatient athlete toggles filming off again.
      if (constraintGate) await new Promise<void>((r) => (constraintGate = r))
    },
  }
  const stream: FakeStream = {
    id: openedStreams.length + 1,
    getTracks: () => [track],
    getVideoTracks: () => [track],
  }
  openedStreams.push({ track, stream })
  return stream
}

/** Every track this app has ever opened, so leaks are visible. */
const liveTracks = () => openedStreams.filter((s) => s.track.readyState === 'live')

/**
 * Let the open sequence reach getUserMedia.
 *
 * `prepare` looks the lenses up first, so the camera request is several awaits
 * deep and is not issued synchronously with the call.
 */
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

class FakeRecorder {
  static isTypeSupported = () => true
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'video/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  start() {
    this.state = 'recording'
  }
  requestData() {
    this.ondataavailable?.({ data: new Blob(['x'], { type: 'video/webm' }) })
  }
  stop() {
    this.state = 'inactive'
    this.onstop?.()
  }
}

beforeEach(() => {
  openedStreams = []
  pendingOpens = []
  constraintGate = null
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => makeStream()),
      enumerateDevices: vi.fn(async () => [
        { kind: 'videoinput', deviceId: 'back-1', label: 'back camera' },
      ]),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('camera lifecycle', () => {
  it('opens a stream and reports itself ready', async () => {
    const { result } = renderHook(() => useFormRecorder())
    await act(async () => {
      await result.current.prepare()
    })
    expect(result.current.supported).toBe(true)
    expect(result.current.status).toBe('idle')
    expect(liveTracks()).toHaveLength(1)
  })

  it('stops every track it opened when filming is released', async () => {
    const { result } = renderHook(() => useFormRecorder())
    await act(async () => {
      await result.current.prepare()
    })
    expect(liveTracks()).toHaveLength(1)
    act(() => {
      result.current.release()
    })
    // The camera indicator only goes out when the track is genuinely stopped.
    expect(liveTracks()).toHaveLength(0)
  })

  it('leaves nothing running when the session unmounts mid-recording', async () => {
    const { result, unmount } = renderHook(() => useFormRecorder())
    await act(async () => {
      await result.current.prepare()
      await result.current.start()
    })
    expect(result.current.status).toBe('recording')
    unmount()
    expect(liveTracks()).toHaveLength(0)
  })

  it('never strands a camera when filming is toggled off and straight back on', async () => {
    // The reported failure: release() invalidated the in-flight request but
    // left its promise cached, so re-enabling awaited a request that could
    // never publish, and the UI sat on "Starting camera" forever.
    navigator.mediaDevices.getUserMedia = vi.fn(
      () => new Promise<FakeStream>((resolve, reject) => pendingOpens.push({ resolve, reject })),
    ) as never

    const { result } = renderHook(() => useFormRecorder())
    let first: Promise<boolean>
    act(() => {
      first = result.current.prepare()
    })
    await settle()
    expect(result.current.status).toBe('starting')
    expect(pendingOpens).toHaveLength(1)

    act(() => {
      result.current.release()
    })

    // Re-enable while the first request is still unresolved.
    let second: Promise<boolean>
    act(() => {
      second = result.current.prepare()
    })
    await settle()
    // A fresh request was issued rather than the retired one being reused.
    expect(pendingOpens).toHaveLength(2)

    // The retired request now resolves. It must not become the live camera.
    await act(async () => {
      pendingOpens[0].resolve(makeStream('retired'))
      await first
    })
    await act(async () => {
      pendingOpens[1].resolve(makeStream('replacement'))
      await second
    })

    await waitFor(() => expect(result.current.status).toBe('idle'))
    // Exactly one camera is live, and it is the replacement.
    expect(liveTracks()).toHaveLength(1)
    expect(liveTracks()[0].track.label).toBe('replacement')
  })

  it('does not let a retired request report a denial over a working camera', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(
      () => new Promise<FakeStream>((resolve, reject) => pendingOpens.push({ resolve, reject })),
    ) as never

    const { result } = renderHook(() => useFormRecorder())
    let first: Promise<boolean>
    act(() => {
      first = result.current.prepare()
    })
    await settle()
    act(() => {
      result.current.release()
    })
    let second: Promise<boolean>
    act(() => {
      second = result.current.prepare()
    })
    await settle()
    await act(async () => {
      pendingOpens[1].resolve(makeStream('replacement'))
      await second
    })
    // The abandoned request fails afterwards, as a cancelled permission does.
    await act(async () => {
      pendingOpens[0].reject(new Error('NotAllowedError'))
      await first
    })
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(liveTracks()).toHaveLength(1)
  })

  it('reports a real denial honestly and leaves no track behind', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(async () => {
      throw new Error('NotAllowedError')
    }) as never
    const { result } = renderHook(() => useFormRecorder())
    await act(async () => {
      await result.current.prepare()
    })
    await waitFor(() => expect(result.current.status).toBe('denied'))
    expect(liveTracks()).toHaveLength(0)
  })

  it('hands back a clip and returns to idle after a recorded set', async () => {
    const { result } = renderHook(() => useFormRecorder())
    await act(async () => {
      await result.current.prepare()
      await result.current.start()
    })
    let blob: Blob | null = null
    await act(async () => {
      blob = await result.current.stop()
    })
    expect(blob).toBeInstanceOf(Blob)
    expect(result.current.status).toBe('idle')
    // Stopping the recorder must not stop the camera — the next set reuses it.
    expect(liveTracks()).toHaveLength(1)
    act(() => {
      result.current.release()
    })
    expect(liveTracks()).toHaveLength(0)
  })

  it('releases the previous camera when the lens preference changes', async () => {
    const { result } = renderHook(() => useFormRecorder())
    await act(async () => {
      await result.current.prepare()
    })
    const firstTrack = liveTracks()[0].track
    await act(async () => {
      result.current.setWide(false)
    })
    await waitFor(() => expect(firstTrack.readyState).toBe('ended'))
    // One camera at a time, whatever the athlete taps.
    expect(liveTracks().length).toBeLessThanOrEqual(1)
    act(() => {
      result.current.release()
    })
    expect(liveTracks()).toHaveLength(0)
  })
})

describe('request ownership', () => {
  it('admits only the newest, non-retired attempt', () => {
    const a = Promise.resolve(true)
    const b = Promise.resolve(true)
    expect(ownsCameraAttempt(a, a, 3, 3)).toBe(true)
    // Retired: the pending slot has moved on.
    expect(ownsCameraAttempt(a, b, 3, 3)).toBe(false)
    // Superseded: a newer generation exists.
    expect(ownsCameraAttempt(a, a, 2, 3)).toBe(false)
  })
})
