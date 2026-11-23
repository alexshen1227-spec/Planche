/**
 * The "What weight was that?" question, kept pure so it can be pinned. It asks
 * about one set of one movement, so it must be forgotten the moment that
 * movement is no longer there — a swap once left it open over the replacement
 * ("Dumbbell fly" was asked about again) — and a weight already typed in the
 * set's box answers it without a sheet.
 */
export interface LoadAsk {
  item: number
  set: number
  /** The movement the question was about. */
  exerciseId: string
}

/** The question still stands only while the same movement sits at that place in the session. */
export function askStillApplies(ask: LoadAsk | null, items: readonly { exerciseId: string; sets: readonly unknown[] }[]): boolean {
  if (!ask) return false
  const it = items[ask.item]
  return Boolean(it && it.exerciseId === ask.exerciseId && ask.set < it.sets.length)
}

/** A weight read from what the athlete typed: a positive number under 1000, or nothing. */
export function parseTypedLoad(text: string | null | undefined): number | undefined {
  if (!text) return undefined
  const v = Number(text.trim().replace(',', '.'))
  return Number.isFinite(v) && v > 0 && v < 1000 ? v : undefined
}
