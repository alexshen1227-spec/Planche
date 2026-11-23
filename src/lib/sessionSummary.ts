import type { Section, SetLog } from '../types'
import { countsAsSkillHold } from './progressTotals'
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

const sec1 = (x: number) => `${(Math.round(x * 10) / 10).toFixed(1)} s`
const secWhole = (x: number) => (Number.isInteger(Math.round(x * 10) / 10) ? `${Math.round(x)} s` : sec1(x))

/** A stopwatch hold whose counted value is less than the timer read: what came off, and which allowance it was. */
function stopwatchDeduction(log: Pick<SetLog, 'kind' | 'raw' | 'value' | 'timing'>): { off: number; kind: AllowanceKind | 'interruption' | undefined; measured: boolean } | null {
  if (log.kind !== 'hold' || log.raw === undefined || log.raw - log.value <= 0.05) return null
  if (log.timing && log.timing.method !== 'stopwatch') return null
  return { off: log.raw - log.value, kind: log.timing?.allowance, measured: log.timing?.walkMeasured === true }
}

/**
 * Both numbers of a hold, and why they differ: "6.2 s on the timer · 1.2 s
 * counted: a 5 s walk back to the phone is assumed until you measure yours".
 * The credited value is the rule (it is what records, targets and the road
 * read); the timer is what the athlete saw — showing only the first once read
 * as a record of "1.2s" beside a 6-second hold. After the walk is measured the
 * line names the measured walk instead.
 */
export function countedNote(log: Pick<SetLog, 'kind' | 'raw' | 'value' | 'timing'>, walkBackSec?: number): string | null {
  const cut = stopwatchDeduction(log)
  if (!cut || log.raw === undefined) return null
  const head = `${sec1(log.raw)} on the timer · ${sec1(log.value)} counted`
  if (cut.kind === 'walk-back') {
    if (cut.measured) return `${head}: your measured ${sec1(cut.off)} walk back to the phone is taken off`
    return walkBackSec !== undefined
      ? `${head}: a ${secWhole(cut.off)} walk back to the phone was assumed when this was logged; you have measured yours since`
      : `${head}: a ${secWhole(cut.off)} walk back to the phone is assumed until you measure yours`
  }
  if (cut.kind === 'reaction') return `${head}: the ${sec1(cut.off)} it takes to reach the stop button is taken off (phone in reach)`
  if (cut.kind === 'interruption') return `${head}: ${sec1(cut.off)} held back for the interruption`
  return `${head}: a stop allowance of ${sec1(cut.off)} is taken off`
}

/** The seconds the timer read for the holds a total counts, against what counted — for a caption under a total. */
export function timerAgainstCounted(sets: readonly SetLog[]): { timerSec: number; countedSec: number; assumedWalk: boolean } | null {
  let timer = 0
  let counted = 0
  let assumed = false
  let any = false
  for (const set of sets) {
    if (!countsAsSkillHold(set)) continue
    counted += set.value
    const cut = stopwatchDeduction(set)
    if (cut && set.raw !== undefined) {
      any = true
      timer += set.raw
      if (cut.kind === 'walk-back' && !cut.measured) assumed = true
    } else timer += set.value
  }
  return any ? { timerSec: timer, countedSec: counted, assumedWalk: assumed } : null
}

/** The caption under a hold-time total when allowances came off it: the timer's seconds beside the counted ones. */
export function holdTotalCaption(sets: readonly SetLog[]): string | null {
  const t = timerAgainstCounted(sets)
  if (!t) return null
  return `${Math.round(t.timerSec)} s on the timer; ${Math.round(t.countedSec)} s counted after the stop allowance${t.assumedWalk ? ' (an assumed walk back until you measure yours)' : ''}`
}

/** The note under a record: the best hold's timer reading beside what it counted, when they differ. */
export function recordNote(sets: readonly SetLog[], exerciseId: string, valueSec: number, walkBackSec?: number): string | null {
  const hit = sets
    .filter((set) => set.exerciseId === exerciseId && set.kind === 'hold' && Math.abs(set.value - valueSec) < 0.06)
    .map((set) => countedNote(set, walkBackSec))
    .find((note) => note !== null)
  return hit ?? null
}

/**
 * Whether to offer measuring the walk, from a session's logs: the first time
 * an assumed walk back took off more than half a hold's timer reading, for an
 * athlete who has not measured it nor said the phone is in reach. `seen` is
 * "already offered once" — the offer is made one time, then lives in Settings.
 */
export function offerWalkMeasure(logs: readonly SetLog[], opts: { walkBackSec?: number; phoneWithinReach?: boolean; seen?: boolean }): SetLog | null {
  if (opts.seen || opts.walkBackSec !== undefined || opts.phoneWithinReach) return null
  return (
    logs.find((log) => {
      const cut = stopwatchDeduction(log)
      return Boolean(cut && cut.kind === 'walk-back' && !cut.measured && log.raw !== undefined && cut.off > log.raw / 2)
    }) ?? null
  )
}

/**
 * What a saved session's "records" list really holds. A record needs something
 * to beat: the first hold ever logged at a step has no `previous`, and showing
 * it as a beaten record put "NEW RECORDS Advanced Tuck Planche 0.8s" on the
 * summary of four 5.8s timer holds. Those are the first hold logged, said so.
 * The engine's records are untouched: this is how they are presented.
 */
export function splitRecords<T extends { previous?: number }>(prs: readonly T[]): { records: T[]; firsts: T[] } {
  const records: T[] = []
  const firsts: T[] = []
  for (const p of prs) (p.previous === undefined ? firsts : records).push(p)
  return { records, firsts }
}

export const FIRST_HOLD_HEADING = 'First hold logged'
export const FIRST_HOLD_NOTE = 'Nothing to beat yet — this is the first one on record, not a record.'
