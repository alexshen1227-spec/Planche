// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClipPlayer } from './ClipPlayer'

/**
 * Timing a hold from its clip, through the real reviewer.
 *
 * jsdom decodes no video, so the clip is a stub blob and the playhead is set
 * by hand — what is under test is the marking flow and what it hands back,
 * not playback.
 */

vi.mock('../lib/clips', () => ({
  getClipBlob: vi.fn(async () => new Blob(['clip'], { type: 'video/webm' })),
}))

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:clip')
  URL.revokeObjectURL = vi.fn()
  // jsdom implements no media playback; pause and play are no-ops here.
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openReview(onMarkInterval = vi.fn()) {
  render(<ClipPlayer clipKey="k1" label="Tuck hold" onMarkInterval={onMarkInterval} />)
  const open = await screen.findByRole('button', { name: /Review clip fullscreen/ })
  act(() => {
    fireEvent.click(open)
  })
  const review = screen.getByRole('dialog', { name: /Fullscreen review/ })
  const video = review.querySelector('video')!
  let playhead = 0
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => playhead,
    set: (t: number) => {
      playhead = t
    },
  })
  const seek = (t: number) => {
    playhead = t
  }
  return { review, seek, onMarkInterval }
}

describe('timing a hold from the clip', () => {
  it('hands back the marked start and end', async () => {
    const { review, seek, onMarkInterval } = await openReview()
    const use = () => within(review).getByRole('button', { name: /Use|Mark the start|End must/ })
    expect((use() as HTMLButtonElement).disabled).toBe(true)

    seek(1.24)
    act(() => {
      fireEvent.click(within(review).getByRole('button', { name: /Hold started here/ }))
    })
    seek(6.6)
    act(() => {
      fireEvent.click(within(review).getByRole('button', { name: /Hold ended here/ }))
    })
    expect(use().textContent).toMatch(/Use 5\.4s for this hold/)
    act(() => {
      fireEvent.click(use())
    })
    expect(onMarkInterval).toHaveBeenCalledWith({ startSec: 1.24, endSec: 6.6 })
  })

  it('refuses an end before the start', async () => {
    const { review, seek, onMarkInterval } = await openReview()
    seek(5)
    act(() => {
      fireEvent.click(within(review).getByRole('button', { name: /Hold started here/ }))
    })
    seek(2)
    act(() => {
      fireEvent.click(within(review).getByRole('button', { name: /Hold ended here/ }))
    })
    const use = within(review).getByRole('button', { name: /End must come after the start/ }) as HTMLButtonElement
    expect(use.disabled).toBe(true)
    act(() => {
      fireEvent.click(use)
    })
    expect(onMarkInterval).not.toHaveBeenCalled()
  })

  it('offers no timing controls where re-timing is not allowed', async () => {
    render(<ClipPlayer clipKey="k2" label="Gallery clip" />)
    const open = await screen.findByRole('button', { name: /Review clip fullscreen/ })
    act(() => {
      fireEvent.click(open)
    })
    const review = await screen.findByRole('dialog', { name: /Fullscreen review/ })
    expect(within(review).queryByRole('button', { name: /Hold started here/ })).toBeNull()
  })
})
