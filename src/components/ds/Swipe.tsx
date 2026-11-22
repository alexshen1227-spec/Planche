import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Icon } from '../Icon'

const THRESHOLD = 64
const ACTION_W = 64
const SLOP = 8

/**
 * A row you can swipe: right past 64px runs `onComplete`, left past 64px
 * reveals Edit and Delete. Springs back on release. It is an extra on top of
 * the row's own buttons, never the only way to do something.
 *
 * Movement under 8px is a tap and is left alone, so steppers and buttons
 * inside the row keep working; once a drag starts, the click that follows it
 * is swallowed.
 */
export function SwipeRow({
  children,
  onComplete,
  onEdit,
  onDelete,
  completeLabel = 'Done',
  canDelete = true,
}: {
  children: ReactNode
  onComplete?: () => void
  onEdit?: () => void
  onDelete?: () => void
  completeLabel?: string
  canDelete?: boolean
}) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [open, setOpen] = useState(false)
  const start = useRef<{ x: number; y: number; base: number; id: number } | null>(null)
  const moved = useRef(false)
  const lastDx = useRef(0)
  const hasActions = Boolean(onEdit || onDelete)
  const openW = ((onEdit ? 1 : 0) + (onDelete && canDelete ? 1 : 0)) * ACTION_W

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    start.current = { x: e.clientX, y: e.clientY, base: open ? -openW : 0, id: e.pointerId }
    moved.current = false
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current
    if (!s || s.id !== e.pointerId) return
    const ddx = e.clientX - s.x
    if (!moved.current) {
      if (Math.abs(e.clientY - s.y) > SLOP && Math.abs(e.clientY - s.y) > Math.abs(ddx)) {
        start.current = null // a vertical scroll, not ours
        return
      }
      if (Math.abs(ddx) < SLOP) return
      moved.current = true
      setDragging(true)
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    const min = hasActions ? -openW - 24 : 0
    const max = onComplete ? THRESHOLD + 48 : 0
    const next = Math.max(min, Math.min(max, s.base + ddx))
    lastDx.current = next
    setDx(next)
  }
  const end = (e?: PointerEvent<HTMLDivElement>) => {
    const s = start.current
    start.current = null
    if (!s || !moved.current) return
    setDragging(false)
    // Decide from where the finger actually lifted, not from the last
    // rendered offset: a quick swipe can lift before its final move has
    // rendered, and the rendered offset would still read zero.
    const min = hasActions ? -openW - 24 : 0
    const max = onComplete ? THRESHOLD + 48 : 0
    const dx = e && e.pointerId === s.id ? Math.max(min, Math.min(max, s.base + (e.clientX - s.x))) : lastDx.current
    if (dx >= THRESHOLD && onComplete) {
      setOpen(false)
      setDx(0)
      onComplete()
    } else if (dx <= -THRESHOLD && openW > 0) {
      setOpen(true)
      setDx(-openW)
    } else {
      setOpen(false)
      setDx(0)
    }
    // The click that ends a drag must not press whatever it ended on.
    window.setTimeout(() => {
      moved.current = false
    }, 0)
  }
  const close = () => {
    setOpen(false)
    setDx(0)
  }

  return (
    <div className="relative overflow-hidden rounded-inner">
      {onComplete ? (
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 flex items-center gap-2 bg-ok-soft px-4 text-footnote font-semibold text-ok-text"
          style={{ width: Math.max(0, dx) + 16, opacity: dx > 8 ? 1 : 0 }}
        >
          <Icon name="check" size={18} />
          {dx >= THRESHOLD ? completeLabel : null}
        </div>
      ) : null}
      {openW > 0 ? (
        <div
          className="absolute inset-y-0 right-0 flex"
          style={{ width: openW, visibility: open || dx < 0 ? 'visible' : 'hidden' }}
        >
          {onEdit ? (
            <button
              type="button"
              aria-label="Edit set"
              onClick={() => {
                close()
                onEdit()
              }}
              className="flex w-16 flex-col items-center justify-center gap-0.5 border-l border-line bg-raised text-caption font-semibold text-ink"
            >
              <Icon name="pencil" size={18} />
              Edit
            </button>
          ) : null}
          {onDelete && canDelete ? (
            <button
              type="button"
              aria-label="Delete set"
              onClick={() => {
                close()
                onDelete()
              }}
              className="flex w-16 flex-col items-center justify-center gap-0.5 bg-danger-solid text-caption font-semibold text-white"
            >
              <Icon name="trash" size={18} />
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        className="ds-swipe relative rounded-inner bg-surface"
        data-dragging={dragging}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => {
          // The browser took the gesture (a scroll): never a completed swipe.
          start.current = null
          setDragging(false)
          setDx(open ? -openW : 0)
          lastDx.current = 0
          window.setTimeout(() => {
            moved.current = false
          }, 0)
        }}
        onClickCapture={(e) => {
          if (moved.current) {
            e.stopPropagation()
            e.preventDefault()
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
