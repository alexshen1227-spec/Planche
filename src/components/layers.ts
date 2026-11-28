/**
 * What sits over what. A full-screen player (the session player, the gym player) is a *screen*; every sheet and modal
 * is a *dialog*, one layer up. Both are portalled to <body>, where at an equal z-index the later one in the document
 * paints on top — and a dialog open on a screen's first render is inserted *before* the screen, because React places
 * a new subtree's portals before the subtree itself. The gym player once shared the dialogs' z-50, so a quick log's
 * exercise list, which opens with the player, was drawn underneath it and "Add an exercise" showed nothing.
 * Toasts (z-[60]), the update banners (z-[65], z-[70]) and the clip review (z-[200]) sit above both.
 */
export const LAYER = { screen: 'z-40', dialog: 'z-50' } as const

type Hold = { count: number; restore: () => void }

/**
 * A page-wide state that several layers can ask for at once, counted: the first hold applies it and the last one
 * given back restores what was there before, whatever order they are given back in. Each layer once saved what it
 * found and put it back on close, which assumed layers close in reverse order. React runs a closing screen's cleanups
 * parent first, in document order: a quick log closed with two sheets up restored the first sheet's "scrolls", then
 * the second's "hidden", and the app would not scroll again until it was reloaded.
 */
function counted(holds: Map<object, Hold>, key: object, apply: () => () => void): () => void {
  const entry = holds.get(key) ?? { count: 0, restore: apply() }
  holds.set(key, entry)
  entry.count++
  let given = false
  return () => {
    if (given) return
    given = true
    entry.count--
    if (entry.count > 0) return
    holds.delete(key)
    entry.restore()
  }
}

const scrollHolds = new Map<object, Hold>()
const inertHolds = new Map<object, Hold>()

/** The page beneath a dialog does not scroll while any dialog is open. Returns the release. */
export function holdPageScroll(): () => void {
  const body = document.body
  return counted(scrollHolds, body, () => {
    const before = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      body.style.overflow = before
    }
  })
}

/** The app beneath a full-screen player is inert (no focus, no taps) and hidden from screen readers. Returns the release. */
export function holdInert(root: HTMLElement): () => void {
  return counted(inertHolds, root, () => {
    const wasInert = root.hasAttribute('inert')
    const wasHidden = root.getAttribute('aria-hidden')
    root.setAttribute('inert', '')
    root.setAttribute('aria-hidden', 'true')
    return () => {
      if (!wasInert) root.removeAttribute('inert')
      if (wasHidden === null) root.removeAttribute('aria-hidden')
      else root.setAttribute('aria-hidden', wasHidden)
    }
  })
}
