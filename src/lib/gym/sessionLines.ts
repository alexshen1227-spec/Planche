import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import type { Joint } from '../../data/gym/catalog'
import type { GymDraft } from './draft'
import { countUnit, estimateOneRepMax, repPlanFor, suggestLoad } from './progression'
import type { GymExerciseLog, GymLocation, GymSession } from './types'
import { formatLoad, unitFor, unloadedLabel } from './units'

/* Pure lines the gym screens print, so each decision can be pinned without a DOM. */

/** A movement as the athlete sees it: its name, or its id marked as gone from the catalogue. */
export function exerciseLabel(exerciseId: string): { name: string; retired: boolean } {
  const ex = GYM_EXERCISE_BY_ID[exerciseId]
  return ex ? { name: ex.name, retired: false } : { name: exerciseId, retired: true }
}

export const RETIRED_NOTE = 'no longer in the catalogue'

/** "Hands-elevated push-up", or "old-lift (no longer in the catalogue)". */
export function exerciseTitle(exerciseId: string): string {
  const l = exerciseLabel(exerciseId)
  return l.retired ? `${l.name} (${RETIRED_NOTE})` : l.name
}

/** One set's effort as saved ("effort 8"), or nothing when none was given. */
export function effortLabel(rpe: number | undefined): string | null {
  return rpe === undefined ? null : `effort ${rpe}`
}

/* ---------- an open draft: resume it, never become it ---------- */

/** The draft the Gym tab should offer to resume: none while the player runs, else whatever storage holds now. */
export function openDraftFor(stored: GymDraft | null, running: GymDraft | null): GymDraft | null {
  return running ? null : stored
}

/** What an open draft holds, one line per lift: "Hands-elevated push-up — 1 of 3 sets done". */
export function draftContents(draft: GymDraft): string[] {
  return draft.items.map((it) => {
    const done = it.sets.filter((s) => s.done).length
    return `${exerciseTitle(it.exerciseId)} — ${done} of ${it.sets.length} ${it.sets.length === 1 ? 'set' : 'sets'} done`
  })
}

/** The lifts in an open draft that load a joint the athlete has just reported. */
export function draftJointConflicts(draft: GymDraft, joints: Joint[]): { exerciseId: string; joints: Joint[] }[] {
  if (!joints.length) return []
  return draft.items.flatMap((it) => {
    const hit = (GYM_EXERCISE_BY_ID[it.exerciseId]?.stress ?? []).filter((j) => joints.includes(j))
    return hit.length ? [{ exerciseId: it.exerciseId, joints: hit }] : []
  })
}

const jointWords = (js: Joint[]) => [...new Set(js)].map((j) => j.replace('-', ' ')).join(' and ')

/** The warning to show before resuming a draft that holds work for a joint just reported, or null. */
export function draftConflictLine(draft: GymDraft, joints: Joint[]): string | null {
  const hits = draftJointConflicts(draft, joints)
  if (!hits.length) return null
  const names = hits.map((h) => exerciseTitle(h.exerciseId)).join(', ')
  return `This open session holds work that loads your ${jointWords(hits.flatMap((h) => h.joints))}, which you just reported: ${names}. Discard it and start today’s plan, which keeps that joint out, or remove those lifts before you resume. Never train through pain.`
}

/** What starting does while a draft is open: it resumes that draft, so the screen says so. */
export function resumeLine(draft: GymDraft): string {
  return `“${draft.name}” is still open, so it resumes first — starting does not begin the plan above. Resume it, or discard it to start the plan.`
}

/* ---------- finishing ---------- */

/** What stops Finish: a question about a weight that has not been answered or closed. */
export function finishBlocker(pending: { needLoad: boolean; doubt: boolean }): string | null {
  if (pending.needLoad) return 'Answer the weight question first, or close it — a set waiting on it is not saved.'
  if (pending.doubt) return 'Check the load first: confirm it, change it, or close the question — a set waiting on it is not saved.'
  return null
}

/** Sets the draft holds that are not done, per lift: they are not saved, and the finish sheet says so. */
export function unfinishedSets(draft: GymDraft): { exerciseId: string; count: number }[] {
  return draft.items.flatMap((it) => {
    const count = it.sets.filter((s) => !s.done).length
    return count ? [{ exerciseId: it.exerciseId, count }] : []
  })
}

export function unfinishedLine(draft: GymDraft): string | null {
  const left = unfinishedSets(draft)
  if (!left.length) return null
  const total = left.reduce((n, x) => n + x.count, 0)
  return `${total} ${total === 1 ? 'set' : 'sets'} not done will not be saved: ${left.map((x) => `${exerciseTitle(x.exerciseId)} (${x.count})`).join(', ')}. Keep training to do ${total === 1 ? 'it' : 'them'}.`
}

/* ---------- copy ---------- */

/** What the planner left out, in the minutes the lifts really had (the opener's are not theirs). */
export function leftOutLine(dropped: string[], liftMinutes: number, openerMinutes?: number): string | null {
  if (!dropped.length) return null
  const own = openerMinutes ? ` (the lifts’ own minutes, after a ${openerMinutes}-minute opener)` : ''
  return `Left out to fit ${Math.round(liftMinutes)} minutes of lifting${own}: ${dropped.join(', ')}.`
}

export const EXTRA_SESSION_LINE = 'Today’s main session is already in, so this one is extra: train it only if you feel fresh, and keep it easy.'

/* ---------- next time ---------- */

export interface NextTimeLine {
  exerciseId: string
  name: string
  /** "Next time: 7 kg × 10–15" or "Repeat 6 kg: every set needs 15 reps". */
  text: string
  /** The reason, from the same rule the builder uses. */
  why: string
  /** Why this lift has no estimated max, when it has none. */
  maxNote?: string
  /** A later session already trained this lift, so its own "next time" is that session's. */
  superseded?: boolean
}

/** Why a logged lift produced no estimated max, or undefined when at least one set did. */
export function noMaxReason(log: GymExerciseLog): string | undefined {
  const ex = GYM_EXERCISE_BY_ID[log.exerciseId]
  const working = log.sets.filter((s) => !s.warmup && s.reps > 0)
  if (!working.length) return undefined
  if (working.some((s) => estimateOneRepMax(s, log.exerciseId) !== null)) return undefined
  if (!ex) return 'No estimated max: this movement is no longer in the catalogue.'
  if (ex.assisted) return 'No estimated max: the weight logged is help, not load.'
  if (unloadedLabel(ex) === 'Band') return 'Compare reps using the same band and starting stretch.'
  if (ex.count === 'seconds') return 'No estimated max for a hold; the longest hold is what is tracked.'
  if (ex.load === 'bodyweight') return 'No estimated max: only added load is known for a bodyweight movement.'
  if (!working.some((s) => s.kg !== undefined && s.kg > 0)) return 'No estimated max: no weight was logged.'
  return 'No estimated max: every set was past 12 reps (counting reps left in reserve), too loose an estimate to show.'
}

/**
 * For each lift in a session, the load and reps to aim for next time and why — from `suggestLoad`, the function the
 * builder uses, run on the history including this session. A lift held back shows the reps every set needs.
 */
export function nextTimeLines(
  session: GymSession,
  sessions: GymSession[],
  location: GymLocation | undefined,
  youth: boolean,
  now: number = session.endedAt + 60_000,
): NextTimeLine[] {
  const all = sessions.some((s) => s.id === session.id) ? sessions : [...sessions, session]
  return session.exercises.flatMap((log) => {
    if (!log.sets.some((s) => !s.warmup && s.reps > 0)) return []
    const ex = GYM_EXERCISE_BY_ID[log.exerciseId]
    const maxNote = noMaxReason(log)
    const base = { exerciseId: log.exerciseId, name: exerciseTitle(log.exerciseId), ...(maxNote ? { maxNote } : {}) }
    if (!ex) return [{ ...base, text: 'No suggestion: this movement is no longer in the catalogue.', why: 'Its sets are kept as logged.' }]
    const later = all.some((s) => s.id !== session.id && s.startedAt > session.startedAt && s.exercises.some((e) => e.exerciseId === log.exerciseId))
    const plan = { range: log.repRange ?? repPlanFor(ex, 'muscle', youth).range, targetRpe: log.targetRpe ?? repPlanFor(ex, 'muscle', youth).targetRpe }
    const s = suggestLoad({ exerciseId: log.exerciseId, location, sessions: [...all].sort((a, b) => a.startedAt - b.startedAt), plan, youth, now })
    const unit = unitFor(ex, location)
    const [lo, hi] = s.reps
    const word = countUnit(ex) === 'seconds' ? ' s' : ''
    const hasLoad = s.kg !== undefined && s.kg > 0
    const text =
      hasLoad && s.repsToMoveUp !== undefined
        ? `Repeat ${formatLoad(s.kg, unit)}: every set needs ${s.repsToMoveUp} ${countUnit(ex) === 'seconds' ? 'seconds' : 'reps'}`
        : hasLoad && s.nearestTo !== undefined
          ? `Nearest load here: ${formatLoad(s.kg, unit)} × ${lo}–${hi}${word} (not a step up; no ${formatLoad(s.nearestTo, unit)} here)`
          : hasLoad
          ? `Next time: ${formatLoad(s.kg, unit)} × ${lo}–${hi}${word}`
          : s.kind === 'bodyweight' || s.kg === 0
            ? `Next time: ${ex.assisted ? 'no help' : unloadedLabel(ex).toLowerCase()} × ${s.targetReps !== undefined ? `${s.targetReps} reps` : `${lo}–${hi}${word}`}`
            : `Next time: no load suggested yet`
    return [{ ...base, text, why: s.why, ...(later ? { superseded: true } : {}) }]
  })
}
