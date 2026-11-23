// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { initialState } from '../store'

const dispatch = vi.fn()
const base = initialState()
const state = { ...base, onboarded: true, profile: { ...base.profile, skills: ['planche', 'handstand'] } } as any

vi.mock('../../lib/store', async (orig) => ({
  ...(await orig<typeof import('../store')>()),
  useStore: () => ({ state, dispatch }),
}))

;(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => cleanup())

describe('progress9: Progress shows the selected skill', () => {
  it('the planche shows the pressing ladder; the handstand shows its own rep line instead, never the planche’s', async () => {
    const { Stats } = await import('../../views/Stats')
    render(<Stats />)
    expect(screen.queryByRole('heading', { name: 'Pressing ladder' })).not.toBeNull()
    expect(document.getElementById('rep-ladder')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /handstand push-up/i }))
    expect(screen.queryByRole('heading', { name: 'Pressing ladder' })).toBeNull()
    expect(document.getElementById('rep-ladder')?.querySelector('h2')?.textContent).toMatch(/push-up/i)
  })

  it('names the consistency chart and keeps a real heading order', async () => {
    const { Stats } = await import('../../views/Stats')
    const { container } = render(<Stats />)
    expect(screen.getByRole('img', { name: /Consistency: \d+ training days? in the last 16 weeks/ })).toBeTruthy()
    const levels = [...container.querySelectorAll('h1,h2,h3,h4')].map((h) => Number(h.tagName[1]))
    expect(levels[0]).toBe(1)
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], levels.join('')).toBeLessThanOrEqual(1)
  })
})
