import type { Section, SetLog } from '../types'
import { stopLatencySecondsFor } from './sessionTiming'
import { fmtHold } from './time'

/**
 * Decisions behind the session player's set lines, kept pure so they can be
 * tested: which set the summary reports, which holds lose a stop allowance,
 * and how a deduction is named.
 *
 * Review round four found the summary closing on "Last set: 2.1s Shoulder
 * Extension Stretch (4.4s − 2.3s to stop it)" above "How did your 2.1s
 * planche lean look?" — a cool-down stretch reported as the session's last
 * set, with a stop delay taken off a stretch, beside a question about a
 * different set.
 */

/**
 * Warm-up and cool-down holds are done at their prescribed counts: no record,
 * no target, no coach decision reads them. Their number is what was done, so
 * nothing comes off it for the moment it takes to stop the timer.
 */
export function isPrescribedSection(section: Section | undefined): boolean {
  return section === 'warmup' || section === 'cooldown'
}

/** Seconds taken off a stopwatch hold in this section: none for warm-up and cool-down. */
export function stopAllowanceFor(
  section: Section | undefined,
  exerciseId: string | undefined,
  calibratedLatencySec: number,
  phoneWithinReach: boolean,
  walkBackSec?: number,
): number {
  if (isPrescribedSection(section)) return 0
  return stopLatencySecondsFor(exerciseId, calibratedLatencySec, phoneWithinReach, walkBackSec)
}

/** The set the summary reports as the last one: the last training set, never a warm-up drill or a stretch. */
export function summaryLastSet(logs: readonly SetLog[]): SetLog | undefined {
  for (let i = logs.length - 1; i >= 0; i -= 1) if (!isPrescribedSection(logs[i].section)) return logs[i]
  return undefined
}

export type AllowanceKind = 'walk-back' | 'reaction'

/**
 * Which allowance a deduction is, and why it applies to this set, in the
 * words Settings uses. Two allowances exist and the screens once showed both
 * as bare numbers — "10.2s − 2.3s to stop it" on one set, a "5s walk-back
 * allowance" on another — with nothing to say which was which.
 */
export function allowanceName(kind: AllowanceKind | 'interruption' | undefined, walkMeasured = false): string {
  if (kind === 'walk-back') {
    return walkMeasured ? 'your measured walk back (phone across the room)' : 'walk-back allowance (phone across the room)'
  }
  if (kind === 'reaction') return 'stop reaction delay (phone in reach)'
  if (kind === 'interruption') return 'held back for the interruption'
  return 'stop allowance'
}

/** The note beside a logged stopwatch hold whose value is less than the timer read. */
export function deductionNote(log: Pick<SetLog, 'kind' | 'raw' | 'value' | 'timing'>): string | null {
  if (log.kind !== 'hold' || log.raw === undefined || log.raw - log.value <= 0.05) return null
  const timing = log.timing
  if (timing && timing.method !== 'stopwatch') return null
  const off = log.raw - log.value
  return `(${log.raw.toFixed(1)}s on the timer − ${off.toFixed(1)}s ${allowanceName(timing?.allowance, timing?.walkMeasured === true)})`
}

/** The line under the running hold: what it counts as, and which allowance comes off. */
export function creditedWhileHolding(creditedSec: number, allowanceSec: number, kind: AllowanceKind, walkMeasured = false): string {
  const name = kind === 'walk-back' ? (walkMeasured ? 'your measured walk back' : 'walk-back allowance') : 'stop reaction delay'
  return `counts as ${creditedSec.toFixed(1)}s (${allowanceSec.toFixed(1)}s off: ${name})`
}

/**
 * The words a rating question uses for the set it rates. With several sets of
 * one movement, "your 2.1s planche lean" could be any of them — and read as
 * the line just above it — so the set's place among them is named.
 */
export function ratedSetLabel(log: SetLog, logs: readonly SetLog[], name: string): string {
  const same = logs.filter((other) => other.exerciseId === log.exerciseId && other.section === log.section)
  const value = log.kind === 'hold' ? fmtHold(log.value) : `${log.value} reps`
  if (same.length <= 1) return log.kind === 'hold' ? `your ${value} ${name}` : `your ${name} (${value})`
  const index = same.findIndex((other) => other.at === log.at)
  return `your ${name}, set ${index + 1} of ${same.length} (${value}),`
}
