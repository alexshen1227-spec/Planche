// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CheckInForm } from './CheckInForm'

afterEach(cleanup)

/**
 * A profile note makes the coach ask for a check-in every couple of days. The
 * check-in never mentioned it, so an athlete whose arm had long settled kept
 * being warned about it with no idea where to make it stop.
 */
describe('the check-in and the profile note', () => {
  it('shows the note and clears it when the athlete says it is gone', () => {
    const clear = vi.fn()
    render(
      <CheckInForm onDone={vi.fn()} onSkip={vi.fn()} injuryNote="Right wrist feels irritated" onClearInjuryNote={clear} />,
    )
    expect(screen.getByText(/Right wrist feels irritated/)).toBeTruthy()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /It’s gone — clear the note/ }))
    })
    expect(clear).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Note cleared/)).toBeTruthy()
  })

  it('leaves the note alone when the athlete says it is still there', () => {
    const clear = vi.fn()
    render(<CheckInForm onDone={vi.fn()} onSkip={vi.fn()} injuryNote="Left wrist sore" onClearInjuryNote={clear} />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Still there' }))
    })
    expect(clear).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Still there' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('asks nothing when there is no note', () => {
    render(<CheckInForm onDone={vi.fn()} onSkip={vi.fn()} onClearInjuryNote={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /clear the note/ })).toBeNull()
  })
})
