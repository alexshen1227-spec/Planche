// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Sheet } from './ds'
import { holdInert, holdPageScroll } from './layers'
import { Modal } from './ui'

// Page-wide states that several layers ask for at once — the scroll lock under a dialog, the inert app under a
// player — are counted: the page is given back when the last layer closes, whatever order they close in. Each
// dialog once saved the page's scroll and put it back on close; a quick log closed with two sheets up left the app
// unable to scroll until it was reloaded.

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

const noop = () => {}
function Two({ first, second }: { first: boolean; second: boolean }) {
  return (
    <>
      <Sheet open={first} onClose={noop} label="First">first</Sheet>
      <Modal open={second} onClose={noop} label="Second">second</Modal>
    </>
  )
}

it('keeps the page from scrolling until the last dialog closes, in either order', () => {
  // Gone together, as when the screen they sit on closes: React cleans up parent first, in document order, so the
  // dialog opened first is the first to give its hold back.
  const together = render(<Two first second />)
  expect(document.body.style.overflow).toBe('hidden')
  together.unmount()
  expect(document.body.style.overflow).toBe('')
  // One at a time, the first opened closing first: the page stays held while the second is still up.
  const apart = render(<Two first second />)
  apart.rerender(<Two first={false} second />)
  expect(document.body.style.overflow).toBe('hidden')
  apart.rerender(<Two first={false} second={false} />)
  expect(document.body.style.overflow).toBe('')
})

it('restores what the page had before the first hold, once, when the last hold is given back', () => {
  document.body.style.overflow = 'clip'
  const a = holdPageScroll()
  const b = holdPageScroll()
  a()
  a()
  expect(document.body.style.overflow).toBe('hidden')
  b()
  expect(document.body.style.overflow).toBe('clip')

  const root = document.createElement('div')
  root.setAttribute('aria-hidden', 'false')
  const first = holdInert(root)
  const second = holdInert(root)
  first()
  expect([root.hasAttribute('inert'), root.getAttribute('aria-hidden')]).toEqual([true, 'true'])
  second()
  expect([root.hasAttribute('inert'), root.getAttribute('aria-hidden')]).toEqual([false, 'false'])
})
