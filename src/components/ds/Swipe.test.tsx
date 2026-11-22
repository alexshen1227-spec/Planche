// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SwipeRow } from './Swipe'

afterEach(cleanup)

/**
 * Found on the phone emulation: a quick touch swipe lifts before its last
 * move has rendered, and the row used to decide from the rendered offset —
 * still zero — so the swipe did nothing. It decides from the lift now.
 */
function row(onComplete = vi.fn(), onDelete = vi.fn()) {
  render(
    <SwipeRow onComplete={onComplete} onEdit={() => {}} onDelete={onDelete}>
      <span>Set 1</span>
    </SwipeRow>,
  )
  return screen.getByText('Set 1').parentElement as HTMLElement
}
const ptr = (el: HTMLElement, type: string, x: number, id = 1) =>
  fireEvent(el, Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 100 }), { pointerId: id, pointerType: 'touch' }))

describe('SwipeRow', () => {
  it('completes on a quick swipe right: the lift arrives before the move has rendered', () => {
    const done = vi.fn()
    const el = row(done)
    const raw = (type: string, x: number) =>
      el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 100 }), { pointerId: 1, pointerType: 'touch' }))
    // One batch, as on a phone: no render between the move and the lift.
    act(() => {
      raw('pointerdown', 10)
      raw('pointermove', 110)
      raw('pointerup', 110)
    })
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('does not complete a short drag, nor one the browser cancelled', () => {
    const done = vi.fn()
    const el = row(done)
    ptr(el, 'pointerdown', 10)
    ptr(el, 'pointermove', 40)
    ptr(el, 'pointerup', 40)
    ptr(el, 'pointerdown', 10)
    ptr(el, 'pointermove', 150)
    ptr(el, 'pointercancel', 150)
    expect(done).not.toHaveBeenCalled()
  })

  it('opens the edit and delete actions on a swipe left', () => {
    const el = row()
    ptr(el, 'pointerdown', 200)
    ptr(el, 'pointermove', 100)
    ptr(el, 'pointerup', 100)
    expect(screen.getByLabelText('Delete set').closest('div')!.style.visibility).toBe('visible')
  })
})
