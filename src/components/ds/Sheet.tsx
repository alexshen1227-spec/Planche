import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { useDialogFocus } from '../ui'
import { prefersReducedMotion } from './motion'

const CLOSE_MS = 200
const DRAG_CLOSE_PX = 96

/**
 * A bottom sheet. Portalled to <body> (every view root's animation makes it a
 * containing block for fixed children), with the same focus trap, Escape and
 * scroll lock as Modal. Slides up on the spring, backdrop fades; drag the
 * handle down to dismiss. Under reduced motion it simply appears.
 */
export function Sheet({
  open,
  onClose,
  title,
  label,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  /** Accessible name; defaults to the title. */
  label?: string
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const dragStart = useRef<number | null>(null)

  useDialogFocus(open, onClose, dialogRef)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return
    if (prefersReducedMotion()) {
      setMounted(false)
      return
    }
    setClosing(true)
    const t = window.setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, CLOSE_MS)
    return () => window.clearTimeout(t)
    // `mounted` is read, never a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open && !mounted) return null

  const onHandleDown = (e: PointerEvent) => {
    dragStart.current = e.clientY
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    setDrag(0)
  }
  const onHandleMove = (e: PointerEvent) => {
    if (dragStart.current === null) return
    setDrag(Math.max(0, e.clientY - dragStart.current))
  }
  const onHandleUp = () => {
    const d = drag ?? 0
    dragStart.current = null
    setDrag(null)
    if (d > DRAG_CLOSE_PX) onClose()
  }

  return createPortal(
    <div
      className="ds-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/55 sm:items-center sm:p-6"
      data-closing={closing}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? title ?? 'Dialog'}
        tabIndex={-1}
        data-closing={closing}
        className="ds-sheet relative max-h-[92vh] w-full overflow-y-auto rounded-t-sheet border border-line bg-surface pb-[max(env(safe-area-inset-bottom),16px)] sm:max-w-lg sm:rounded-sheet"
        style={drag ? { transform: `translateY(${drag}px)`, animation: 'none' } : undefined}
      >
        <div
          className="flex min-h-11 cursor-grab touch-none items-center justify-center"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          aria-hidden="true"
        >
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ds-press absolute right-3 top-0 z-10 grid h-11 w-11 place-items-center rounded-full text-ink2 hover:text-ink"
        >
          <Icon name="x" size={18} />
        </button>
        <div className="px-4 pb-2">
          {title ? <h2 className="mb-3 font-display text-title2 font-semibold text-ink">{title}</h2> : null}
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
