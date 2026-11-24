/** Time reserved for a short skill practice before lifting. */
export const OPENER_MINUTES = 18

/**
 * How much a session of a given length has room for.
 *
 * A function of the time available and nothing cleverer: one skill under 25
 * minutes, two in full from there, plus one short dose from 30 minutes and two
 * beyond 50. These are this app's planning rules (ledger §13.2), not findings.
 * They live apart from the line-up so the week plan can count with the same
 * numbers the sessions are built from.
 */

/** Skills that get a full part of a session this long: their holds and the strength work behind them. */
export function fullParts(minutes: number): number {
  return minutes < 25 ? 1 : 2
}

/** Short doses a session this long carries beside its full parts: two sets, or a few minutes of balance practice. */
export function shortDoses(minutes: number): number {
  return minutes < 30 ? 0 : minutes <= 50 ? 1 : 2
}

/** What a session of this length has room for, in words. */
export function roomIn(minutes: number): string {
  if (fullParts(minutes) === 1) return 'one skill'
  const doses = shortDoses(minutes)
  return `two skills in full${doses === 0 ? '' : doses === 1 ? ' and one short dose' : ' and two short doses'}`
}
