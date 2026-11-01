// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { StoreProvider, useStore } from './store'

/**
 * The store applies the sound settings to the audio module. Every setting the
 * call reads must re-apply it: "Play through the silent switch" once did
 * nothing until another sound setting moved, because the effect did not
 * depend on it.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('applies play-through-silent the moment it is switched', () => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  const session = { type: 'auto' }
  Object.defineProperty(navigator, 'audioSession', { configurable: true, value: session })
  let dispatch: ReturnType<typeof useStore>['dispatch'] | null = null
  function Probe() {
    dispatch = useStore().dispatch
    return null
  }
  render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  )
  expect(session.type).toBe('ambient')
  act(() => dispatch!({ type: 'SET_SETTINGS', patch: { soundThroughSilent: true } }))
  expect(session.type).toBe('playback')
  act(() => dispatch!({ type: 'SET_SETTINGS', patch: { soundThroughSilent: false } }))
  expect(session.type).toBe('ambient')
})
