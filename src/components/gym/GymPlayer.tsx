import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GYM_EXERCISE_BY_ID, jointsToRest, type GymExercise } from '../../data/gym/exercises'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import { primeSignal, releaseSignal, signalTone } from '../../lib/audio'
import { alternativesFor, canDoHere } from '../../lib/gym/availability'
import { fitsGymFocus, focusFromName } from '../../lib/gym/focus'
import { bodyweightCapacity } from '../../lib/gym/bodyweight'
import { partnerIndex, restAfterSet, restoreSetRest, useStraightSets } from '../../lib/gym/pairedSets'
import { addRecommendations } from '../../lib/gym/picker'
import { GymExerciseGuide } from './ExerciseGuide'
import { ExercisePicker } from './ExercisePicker'
import { ExerciseRating } from './ExerciseRating'
import { goalEmphasisFor, restFor, setsForFactor, type Emphasis } from '../../lib/gym/builder'
import { addedSetReps, conservative, dayOfItem, FINISHER_LABEL, prefillReps, previousSets, saveDraft, sessionFromDraft, type DraftItem, type GymDraft } from '../../lib/gym/draft'
import { allowsUnloaded, countUnit, countWord, estimatedMaxGains, FIRST_ESTIMATE_NOTE, gymRecords, isFirstEstimate, isUnloadedSet, comparablePerformance, plyoGate, prescribedCount, repPlanFor, suggestLoad } from '../../lib/gym/progression'
import type { GoalWeights, GymLocation, Rating } from '../../lib/gym/types'
import { displayLoad, entryLoad, formatLoad, minKgFor, recordsZeroLoad, stepKgFor, takesAddedLoad, toKg, unitFor, unloadedLabel } from '../../lib/gym/units'
import { easierDragonFlag } from '../../lib/gym/bodyweightSteps'
import { continueGymSession, doubtedLoad, newGymSessionId } from '../../lib/gym/state'
import { gymBadges, type GymBadge } from '../../lib/plan/weekly'
import { Icon } from '../Icon'
import { holdInert, LAYER } from '../layers'
import { finishBlocker, nextTimeLines, unfinishedLine } from '../../lib/gym/sessionLines'
import { askStillApplies, parseTypedLoad, type LoadAsk } from '../../lib/gym/loadAsk'
import { BadgeGlyph, Button, CountUp, RingTimer, Sheet, SwipeRow } from '../ds'
import { JointReportFields, JointReportNotice, type AttemptSymptom } from '../AttemptEnd'

const RPE_CHOICES = [6, 7, 8, 9, 10]

/** The one sheet over the workout: an exercise's options, its guide, a swap, or an addition. */
type SheetKind = 'menu' | 'guide' | 'swap' | 'add'

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Not every browser lets a page vibrate; the set is logged either way.
  }
}

/**
 * While the player is open the page beneath it is out of reach: inert (no focus, no taps) and hidden from
 * screen readers. The player and its sheets are portalled to <body>, outside #root, so they stay live.
 */
export function useInertBackground(root: HTMLElement | null = typeof document === 'undefined' ? null : document.getElementById('root')) {
  useEffect(() => (root ? holdInert(root) : undefined), [root])
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** A new exercise block, prefilled from history at this location. */
export function draftItemFor(
  exercise: GymExercise,
  location: GymLocation,
  sessions: Parameters<typeof suggestLoad>[0]['sessions'],
  youth: boolean,
  sets: number | undefined = undefined,
  now = Date.now(),
  day: { emphasis?: Emphasis; rpeShift?: number; factor?: number; goals?: GoalWeights } = {},
): DraftItem {
  const base = repPlanFor(exercise, day.emphasis ?? goalEmphasisFor(day.goals, exercise), youth)
  const shift = day.rpeShift ?? ((day.factor ?? 1) < 1 ? -1 : 0)
  const plan = shift ? { ...base, targetRpe: Math.max(6, base.targetRpe + shift) } : base
  const suggestion = suggestLoad({ exerciseId: exercise.id, location, sessions, plan, youth, now })
  const unit = unitFor(exercise, location)
  const last = comparablePerformance(sessions, exercise.id, location.id, now)
  const load = suggestion.kg !== undefined ? entryLoad(suggestion.kg, unit) : undefined
  return {
    exerciseId: exercise.id,
    plan,
    suggestion,
    restSec: restFor(exercise, plan),
    unit,
    ...(() => {
      const previous = previousSets(sessions, exercise.id, location.id, unit, now)
      return previous ? { previous } : {}
    })(),
    sets: Array.from({ length: sets ?? setsForFactor(day.factor ?? 1, false, exercise.dose?.sets) }, (_, i) => ({
      ...(load !== undefined ? { load } : {}),
      reps: prefillReps(plan, suggestion, last?.sets[i]?.reps),
      done: false,
    })),
  }
}

export function GymPlayer({
  draft: initial,
  location,
  onClose,
  canEdit = () => true,
}: {
  draft: GymDraft
  location: GymLocation
  onClose: () => void
  canEdit?: () => boolean
}) {
  const { state, dispatch } = useStore()
  const gym = state.gym!
  const youth = conservative(state.profile)
  useInertBackground()
  const [draft, setDraft] = useState<GymDraft>(initial)
  const previous = draft.resumeFrom === undefined ? undefined : gym.sessions.find((s) => s.id === draft.id)
  const stale = draft.resumeFrom !== undefined && (previous?.completion !== 'partial' || previous.endedAt !== draft.resumeFrom)
  const [now, setNow] = useState(() => Date.now())
  const rest = draft.stopReport ? undefined : draft.rest
  const askRpe = draft.stopReport ? undefined : draft.effortFor
  // A quick log starts empty: the exercise list opens straight away, and each pick is logged like any planned lift.
  const [sheet, setSheet] = useState<{ kind: SheetKind; item?: number } | null>(() =>
    !initial.items.length && !initial.stopReport && initial.resumeFrom === undefined ? { kind: 'add' } : null)
  const [finishOpen, setFinishing] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [trialFor, setTrialFor] = useState<number | null>(null)
  const finishing = finishOpen || Boolean(draft.stopReport)
  const split = focusFromName(draft.name)
  const playerRef = useRef<HTMLDivElement | null>(null)
  const restEndedRef = useRef((initial.rest?.until ?? Infinity) <= Date.now())
  const [unlocked, setUnlocked] = useState<GymBadge[] | null>(null)
  const lastSheet = useRef(sheet)
  if (sheet) lastSheet.current = sheet
  const sh = sheet ?? lastSheet.current

  // Every change is mirrored, so a closed tab or a crash resumes here.
  const closedRef = useRef(false)
  useLayoutEffect(() => {
    if (!closedRef.current && canEdit()) saveDraft(draft)
  }, [draft, canEdit])
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => {
      window.clearInterval(id)
      releaseSignal()
    }
  }, [])
  useEffect(() => {
    if (!rest || now < rest.until || closedRef.current) return
    if (!restEndedRef.current) {
      buzz([120, 80, 120])
      signalTone()
    }
    restEndedRef.current = true
    setDraft((d) => ({ ...d, rest: undefined }))
  }, [now, rest])

  const update = (fn: (d: GymDraft) => GymDraft) => setDraft((d) => fn({ ...structuredClone(d), edited: true }))
  useEffect(() => {
    if (askRpe) playerRef.current?.querySelector<HTMLButtonElement>(`[data-set="${askRpe.item}-${askRpe.set}"] [data-effort] button`)?.focus()
  }, [askRpe?.item, askRpe?.set])
  const finishEffort = (i: number, j: number, rpe?: number) => {
    const item = draft.items[i]
    const partner = partnerIndex(draft.items, i)
    const stay = rpe !== undefined && rpe >= 9
    const nextPair = !stay && partner >= 0 ? restAfterSet(draft, i, j, item.sets[j].at ?? Date.now(), previous)?.nextExerciseId : undefined
    update((d) => {
      if (rpe !== undefined) d.items[i].sets[j].rpe = rpe
      if (stay) useStraightSets(d, i, Date.now())
      delete d.effortFor
      return d
    })
    requestAnimationFrame(() => {
      const rows = [...(playerRef.current?.querySelectorAll<HTMLElement>('[data-set]') ?? [])]
      const current = rows.findIndex((row) => row.dataset.set === `${i}-${j}`)
      const paired = nextPair && rows.find((row) => row.dataset.set?.startsWith(`${partner}-`) && row.hasAttribute('data-pending-set'))
      const next = paired || [...rows.slice(current + 1), ...rows.slice(0, current)].find((row) => row.hasAttribute('data-pending-set'))
      const control = next?.querySelector<HTMLElement>('input') ?? playerRef.current?.querySelector<HTMLButtonElement>('[data-finish]')
      control?.focus()
    })
  }
  const records = useMemo(() => gymRecords(gym.sessions, location.id), [gym.sessions, location.id])

  /** A load far above this lift's best, asked about before the set is logged: a slipped decimal once set records for good. */
  const [doubt, setDoubt] = useState<{ item: number; set: number; load: number; probably?: number; best: number } | null>(null)

  /** A loaded lift completed with no weight on it: ask for the weight (or bodyweight, where the movement allows it). */
  const [needLoadAsk, setNeedLoad] = useState<LoadAsk | null>(null)
  // The question is about one movement: a swap or an edit that moves it away ends the question.
  const needLoad = askStillApplies(needLoadAsk, draft.items) ? needLoadAsk : null
  const asksAssistance = needLoad && GYM_EXERCISE_BY_ID[needLoad.exerciseId]?.assisted
  const asksSled = needLoad && GYM_EXERCISE_BY_ID[needLoad.exerciseId]?.stepFrom === 'sled'
  const [needValue, setNeedValue] = useState('')
  /** One sheet at a time: opening any of them closes the others' questions. */
  const openSheet = (next: { kind: SheetKind; item?: number } | null) => {
    if (next) {
      setNeedLoad(null)
      setDoubt(null)
    }
    setSheet(next)
  }

  const checkLoad = (i: number, j: number, load: number | undefined) => {
    const item = draft.items[i]
    if (!load || GYM_EXERCISE_BY_ID[item.exerciseId].assisted ||
        (item.suggestion?.kg !== undefined && load === entryLoad(item.suggestion.kg, item.unit)) ||
        item.sets.some((s, k) => k !== j && s.done && !s.warmup && s.reps > 0 && s.load === load)) return false
    const odd = doubtedLoad(gym.sessions, item.exerciseId, toKg(load, item.unit), undefined, location.id, sessionFromDraft(draft, Date.now()))
    if (!odd) return false
    setDoubt({ item: i, set: j, load, best: displayLoad(odd.bestKg, item.unit),
      ...(odd.probablyKg !== undefined ? { probably: displayLoad(odd.probablyKg, item.unit) } : {}) })
    return true
  }

  const changeLoad = (i: number, j: number, load: number | undefined, checked = false) => {
    const item = draft.items[i]
    if (item.sets[j].done) {
      if (load === item.sets[j].load) return
      const ex = GYM_EXERCISE_BY_ID[item.exerciseId]
      if ((recordsZeroLoad(ex) && load === undefined) || isUnloadedSet(ex, { kg: load })) {
        pushToast('Enter the weight used for this completed set.', 'info')
        return
      }
      if (!checked && checkLoad(i, j, load)) return
    }
    update((d) => {
      const sets = d.items[i].sets
      const was = sets[j].load
      sets[j].load = load
      sets[j].loadEdited = true
      for (const later of sets.slice(j + 1)) {
        if (!sets[j].warmup && !later.warmup && !later.done && !later.loadEdited &&
          (later.load === undefined || later.load === 0 || later.load === was)) later.load = load
      }
      return d
    })
  }

  const completeSet = (i: number, j: number, checked = false, unloadedOk = false, withLoad?: number) => {
    if (draft.stopReport || !canEdit()) return
    const item = draft.items[i]
    if (item.held) return
    let set = item.sets[j]
    // A weight typed in the set's box is the answer: it once could not be logged without the sheet in the way.
    if (!set.done && (set.load === undefined || set.load === 0)) {
      const typed = withLoad ?? parseTypedLoad(document.querySelector<HTMLInputElement>(`[data-set="${i}-${j}"] input[aria-label$="load"], [data-set="${i}-${j}"] input[aria-label$="assistance"]`)?.value)
      if (typed !== undefined) {
        set = { ...set, load: typed }
        update((d) => {
          d.items[i].sets[j].load = typed
          return d
        })
      }
    }
    const exercise = GYM_EXERCISE_BY_ID[item.exerciseId]
    if (!set.done && !unloadedOk && ((recordsZeroLoad(exercise) && set.load === undefined) || isUnloadedSet(exercise, { kg: set.load }))) {
      setNeedValue('')
      setNeedLoad({ item: i, set: j, exerciseId: item.exerciseId })
      return
    }
    if (!checked && !set.done && checkLoad(i, j, set.load)) return
    primeSignal()
    const wasDone = draft.items[i].sets[j].done
    const at = Date.now()
    update((d) => {
      const s = d.items[i].sets[j]
      s.done = !wasDone
      if (wasDone) {
        delete s.at
        delete s.rpe
        delete s.originalTarget
        if (d.effortFor?.item === i && d.effortFor.set === j) delete d.effortFor
        if (item.pairedWith) restoreSetRest(d, at, previous)
      } else {
        if (recordsZeroLoad(exercise) && (set.load !== undefined || unloadedOk)) {
          s.load = set.load ?? 0
        }
        if (!s.warmup) {
          for (const later of d.items[i].sets.slice(j + 1)) {
            if (later.done || later.warmup) continue
            if (!later.repsEdited) later.reps = s.reps
            if (!later.loadEdited) later.load = s.load
          }
        }
        s.at = at
        d.effortFor = { item: i, set: j }
        d.rest = restAfterSet(d, i, j, at, previous)
      }
      return d
    })
    if (wasDone) return
    buzz(25)
    restEndedRef.current = false
  }

  const confirmLoad = (load: number) => {
    if (!doubt) return
    const { item, set } = doubt
    setDoubt(null)
    changeLoad(item, set, load, true)
    if (!draft.items[item].sets[set].done) completeSet(item, set, true, false, load)
  }

  const swapTo = (i: number, exerciseId: string) => {
    const ex = GYM_EXERCISE_BY_ID[exerciseId]
    // A movement the athlete picks may need kit this place does not list; today's safety rails still hold.
    if (!allowedToday(ex)) return
    update((d) => {
      const old = d.items[i]
      useStraightSets(d, i, Date.now())
      const done = old.sets.filter((s) => s.done)
      const left = Math.min(Math.max(1, old.sets.length - done.length), ex.dose?.sets ?? Infinity)
      // The swap keeps what the day gave the movement it replaces: the rep-range kind, the set count
      // and the effort (a light day's easier target stays easier).
      const carried = dayOfItem(old, youth)
      const fresh = {
        ...draftItemFor(ex, location, gym.sessions, youth, left, Date.now(), {
          emphasis: carried.emphasis ?? goalEmphasisFor(draft.goals ?? gym.prefs?.goals, ex),
          rpeShift: carried.rpeShift,
        }),
        swappedFrom: old.swappedFrom ?? old.exerciseId,
      }
      // Sets already finished stay logged under the movement they were done on.
      const matching = d.items.find((it, j) => j !== i && !it.held && it.exerciseId === exerciseId)
      if (matching) {
        matching.sets.push(...Array.from({ length: left }, () => ({ load: matching.sets.at(-1)?.load, done: false,
          reps: prefillReps(matching.plan, matching.suggestion) })))
        if (done.length) old.sets = done
        else d.items.splice(i, 1)
      } else if (done.length) d.items.splice(i, 1, { ...old, sets: done }, fresh)
      else d.items[i] = fresh
      delete d.effortFor
      return d
    })
    // The old movement's questions go with it.
    setNeedLoad(null)
    setDoubt(null)
    setSheet(null)
    pushToast(`Swapped to ${ex.name}.`, 'info')
  }

  // The player re-renders twice a second for its clock, so what the sheets read is kept until its inputs change.
  const avoidKey = (draft.avoidJoints ?? []).join(' ')
  const offKey = (draft.musclesOff ?? []).join(' ')
  /**
   * What today's plan kept out stays out of swaps and additions too: the joints the check-in rested, the muscles
   * switched off, and speed and power work not yet built up to. A pick may still need kit this place does not list.
   */
  const allowedToday = useCallback((e: GymExercise) =>
    !jointsToRest(e.id).some((j) => draft.avoidJoints?.includes(j)) && !e.primary.some((m) => draft.musclesOff?.includes(m)) &&
    plyoGate(e, gym.sessions, youth, Date.now()).allowed,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [avoidKey, offKey, gym.sessions, youth])
  /** ...and what the app offers on its own can also be done here. */
  const fitsToday = useCallback((e: GymExercise) => canDoHere(e.id, location) && allowedToday(e), [location, allowedToday])
  /** What a search found that today keeps out, counted by reason. */
  const keptOutNote = useCallback((hidden: readonly GymExercise[]) => {
    const rested = (e: GymExercise) => jointsToRest(e.id).filter((j) => draft.avoidJoints?.includes(j))
    const byJoint = hidden.filter((e) => rested(e).length > 0)
    const byMuscle = hidden.filter((e) => !rested(e).length && e.primary.some((m) => draft.musclesOff?.includes(m)))
    const byGate = hidden.length - byJoint.length - byMuscle.length
    const joints = [...new Set(byJoint.flatMap(rested))].map((j) => j.replace('-', ' '))
    const parts = [
      ...(byJoint.length ? [`${byJoint.length} that ${byJoint.length === 1 ? 'loads' : 'load'} your ${joinWords(joints)}`] : []),
      ...(byMuscle.length ? [`${byMuscle.length} that ${byMuscle.length === 1 ? 'works' : 'work'} a muscle you switched off`] : []),
      ...(byGate > 0 ? [`${byGate} speed and power ${byGate === 1 ? 'movement' : 'movements'} you have not built up to yet`] : []),
    ]
    return parts.length ? `Kept out today: ${joinWords(parts)}.` : undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avoidKey, offKey])
  const inSessionKey = draft.items.filter((it) => !it.held).map((it) => it.exerciseId).join(' ')
  const inSession = useMemo(() => (inSessionKey ? inSessionKey.split(' ') : []), [inSessionKey])
  const swapId = sh?.kind === 'swap' && sh.item !== undefined ? draft.items[sh.item]?.exerciseId : undefined
  const swapExclude = useMemo(() => (swapId ? [swapId] : []), [swapId])
  const recommendedSwaps = useMemo(() => swapId
    ? alternativesFor(swapId, location, gym.ratings, inSession, {
      youth, capacity: bodyweightCapacity(state, Date.now()), sessions: gym.sessions, now: Date.now(),
    }).filter((e) => fitsToday(e) && (!split || fitsGymFocus(split, e)))
    : [],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [swapId, location, gym.ratings, inSession, gym.sessions, youth, fitsToday, split])
  const adding = sh?.kind === 'add'
  const recommendedAdds = useMemo(() => adding
    ? addRecommendations({ location, ratings: gym.ratings, ...(split ? { day: split } : {}), inSession, sessions: gym.sessions, allowed: fitsToday, now: Date.now() })
    : [], [adding, location, gym.ratings, split, inSession, gym.sessions, fitsToday])

  const availableTrial = (item: DraftItem) => {
    const suggestion = item.suggestion
    const variation = suggestion?.variationTrial
    const id = variation?.id ?? (suggestion?.floorPushupTrial ? 'push-up' : suggestion?.pullupTrial ? 'pull-up' : undefined)
    const target = variation?.reps ?? suggestion?.floorPushupTrial ?? suggestion?.pullupTrial
    const ex = id ? GYM_EXERCISE_BY_ID[id] : undefined
    if (!id || !ex || !target || (draft.volumeFactor ?? 1) < 1 || item.held || draft.stopReport || item.sets.filter((s) => !s.done && !s.warmup).length < 2 ||
        draft.items.some((it) => it.exerciseId === id) || previous?.exercises.some((it) => it.exerciseId === id && it.sets.some((s) => !s.warmup)) ||
        gym.ratings[id] === 'avoid' || !fitsToday(ex)) return undefined
    const name = id === 'push-up' ? 'floor push-up' : id === 'pull-up' ? 'unassisted pull-up' : ex.name.toLowerCase()
    const title = variation ? `Try ${name}` : id === 'push-up' ? 'Try a floor push-up' : 'Try an unassisted pull-up'
    return { id, target, name, title, perSide: ex.unilateral, cue: ex.cue }
  }
  const prep = trialFor === null ? undefined : draft.items[trialFor]
  const trial = prep && availableTrial(prep)
  const recordTrial = (reps: number) => {
    if (trialFor === null || !trial || reps < 0 || reps > trial.target || !canEdit()) return
    const at = Date.now()
    const i = trialFor
    primeSignal()
    update((d) => {
      const fallback = d.items[i]
      const next = fallback.sets.findIndex((s) => !s.done && !s.warmup)
      if (d.stopReport || next < 0 || d.items.some((it) => it.exerciseId === trial.id)) return d
      fallback.sets.splice(next, 1)
      if (fallback.suggestion) fallback.suggestion = { ...fallback.suggestion, floorPushupTrial: undefined, pullupTrial: undefined, variationTrial: undefined, why: 'Continue your remaining working sets here.' }
      // The trial uses one of the programmed sets. A zero records the
      // attempt, and contributes no completed reps or working-set credit.
      d.items.splice(i, 0, { exerciseId: trial.id, swappedFrom: fallback.exerciseId, unit: fallback.unit,
        plan: { range: [1, trial.target], targetRpe: Math.min(7, fallback.plan.targetRpe) }, restSec: fallback.restSec,
        sets: [{ done: true, at, reps }] })
      d.effortFor = reps > 0 ? { item: i, set: 0 } : undefined
      d.rest = { until: at + fallback.restSec * 1000, total: fallback.restSec }
      return d
    })
    restEndedRef.current = false
    setTrialFor(null)
    buzz(25)
  }

  const addExercise = (exerciseId: string) => {
    if (!allowedToday(GYM_EXERCISE_BY_ID[exerciseId])) return
    update((d) => {
      const ex = GYM_EXERCISE_BY_ID[exerciseId]
      const factor = d.volumeFactor ?? 1
      d.items.push(
        draftItemFor(ex, location, gym.sessions, youth, undefined, Date.now(), { factor, goals: d.goals ?? gym.prefs?.goals }),
      )
      return d
    })
    setSheet(null)
  }

  /** Display the weight and reps that earned each new performance record. */
  const newMaxes = (session: ReturnType<typeof sessionFromDraft>) => {
    // Beating an earlier session's estimate on the same lift (the same place for a machine), load and reps alone.
    const alreadyEarned = new Map(previous ? estimatedMaxGains(gym.sessions).filter((g) => g.sessionId === previous.id).map((g) => [g.exerciseId, g.kg]) : [])
    return estimatedMaxGains([...gym.sessions.filter((x) => x.id !== session.id), session]).flatMap((g) => {
      if (g.sessionId !== session.id || g.kg <= (alreadyEarned.get(g.exerciseId) ?? 0) || g.set.kg === undefined) return []
      const unit = g.set.unit ?? draft.items.find((it) => it.exerciseId === g.exerciseId)?.unit ?? 'kg'
      return [{ id: g.exerciseId, name: GYM_EXERCISE_BY_ID[g.exerciseId]?.name ?? 'Lift',
        value: displayLoad(g.set.kg, unit), reps: g.set.reps, unit }]
    })
  }

  const summary = useMemo(() => {
    if (!finishing || draft.stopReport) return null
    const segment = sessionFromDraft(draft, Date.now())
    if (!segment.exercises.length || stale) return null
    const session = previous ? continueGymSession(previous, segment) : segment
    return {
      maxes: session.exercises.length ? newMaxes(session) : [],
      // What to aim for next time, lift by lift, from the rule the builder uses.
      next: nextTimeLines(session, gym.sessions, location, youth, session.endedAt + 60_000,
        { state, avoidJoints: draft.avoidJoints, volumeFactor: draft.volumeFactor }),
    }
    // Computed when the sheet opens; the draft cannot change underneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishing, stale, previous, draft.stopReport])

  const recordSymptom = (symptom: AttemptSymptom) => {
    if (!canEdit() || draft.stopReport) return
    const at = Date.now()
    dispatch({ type: 'RECORD_SYMPTOM', event: { at, ...symptom, source: 'attempt' } })
    setDraft((d) => ({ ...d, stopReport: { ...symptom, at } }))
    setReportOpen(false)
    setFinishing(false)
  }

  const blocker = finishBlocker({ needLoad: !!needLoad, doubt: !!doubt })
  const save = (separate = false) => {
    if (closedRef.current || !canEdit()) return
    // A question still waiting on an answer holds a set that is not saved: it is answered or closed first.
    if (blocker) {
      setFinishing(false)
      pushToast(blocker, 'info')
      return
    }
    const segment = sessionFromDraft(draft, Date.now())
    if (!segment.exercises.length) {
      if (draft.stopReport && draft.resumeFrom !== undefined && !stale) {
        dispatch({ type: 'GYM', expectedEpoch: draft.epoch, op: { op: 'endPartial', id: draft.id, resumeFrom: draft.resumeFrom } })
      }
      closedRef.current = true
      saveDraft(null)
      onClose()
      return
    }
    if (stale && !separate) return
    closedRef.current = true
    if (separate) {
      segment.id = newGymSessionId()
      segment.startedAt = draft.resumedAt ?? segment.startedAt
    }
    const session = previous && !separate ? continueGymSession(previous, segment) : segment
    const earnedBefore = new Set(gymBadges(state).filter((b) => b.at !== undefined).map((b) => b.id))
    dispatch({ type: 'GYM', expectedEpoch: draft.epoch, op: { op: 'saveSession', session: segment, resumeFrom: separate ? undefined : draft.resumeFrom } })
    saveDraft(null)
    if (draft.stopReport) {
      pushToast('Completed sets and joint report saved.', 'success')
      onClose()
      return
    }
    const prs = newMaxes(session).length
    const fresh = gymBadges({ sessions: state.sessions, gym: { ...gym, sessions: [...gym.sessions.filter((s) => s.id !== session.id), session] } }).filter(
      (b) => b.at !== undefined && !earnedBefore.has(b.id),
    )
    pushToast(prs ? `Saved with ${prs} new lifting record${prs > 1 ? 's' : ''}.` : 'Gym session saved.', 'success')
    if (fresh.length) {
      // The player stays up for the moment; closing it waits for the sheet.
      buzz([30, 50, 30])
      setFinishing(false)
      setUnlocked(fresh)
      return
    }
    onClose()
  }

  const discard = () => {
    if (!canEdit()) return
    closedRef.current = true
    saveDraft(null)
    onClose()
  }

  const doneSets = draft.items.reduce((n, it) => n + it.sets.filter((s) => s.done).length, 0)
  const plannedSets = draft.items.reduce((n, it) => n + it.sets.length, 0)
  const elapsed = Math.max(0, (draft.stopReport?.at ?? now) - (draft.resumedAt ?? draft.startedAt)) / 1000
  const earlierSets = previous?.exercises.reduce((n, log) => n + log.sets.length, 0) ?? 0
  const restLeft = rest ? (rest.until - now) / 1000 : 0
  const rating = (id: string): Rating | undefined => gym.ratings[id]
  const sheetItem = sh?.item !== undefined ? draft.items[sh.item] : undefined
  const sheetExercise = sheetItem ? GYM_EXERCISE_BY_ID[sheetItem.exerciseId] : undefined
  const sheetLabel = sh?.kind === 'add' ? 'Add an exercise' : !sheetExercise ? 'Exercise options'
    : sh?.kind === 'swap' ? `Swap ${sheetExercise.name}` : sh?.kind === 'guide' ? `How to do ${sheetExercise.name}` : `Options for ${sheetExercise.name}`
  /** Leave a movement out of today. Sets already logged on it are kept: they happened. */
  const removeItem = (i: number) => {
    const item = draft.items[i]
    if (!item) return
    const logged = item.sets.some((s) => s.done)
    update((d) => {
      useStraightSets(d, i, Date.now())
      if (d.effortFor?.item === i) delete d.effortFor
      if (logged) {
        d.items[i].sets = d.items[i].sets.filter((s) => s.done)
      } else {
        d.items.splice(i, 1)
        if (d.effortFor && d.effortFor.item > i) d.effortFor = { ...d.effortFor, item: d.effortFor.item - 1 }
      }
      return d
    })
    setNeedLoad(null)
    setDoubt(null)
    setSheet(null)
    if (logged) pushToast(`Left out the rest of ${GYM_EXERCISE_BY_ID[item.exerciseId].name.toLowerCase()}. Your logged sets stay.`, 'info')
  }

  const body = (
    <div ref={playerRef} className={`fixed inset-0 ${LAYER.screen} flex flex-col bg-bg text-ink`} role="dialog" aria-label="Gym session">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-title3 font-semibold">{draft.name}</p>
          <p className="text-caption text-ink3">
            {location.name} · {mmss(elapsed)} · {doneSets}/{plannedSets} sets
          </p>
        </div>
        <Button variant="ghost" onClick={() => {
          openSheet(null)
          setNeedLoad(null)
          setDoubt(null)
          setReportOpen(true)
        }}>Something hurts</Button>
        <Button data-finish
          onClick={() => {
            if (blocker) {
              pushToast(blocker, 'info')
              return
            }
            setFinishing(true)
          }}
        >
          Finish
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-40 pt-3">
        <div className="mx-auto max-w-xl space-y-4">
          {draft.resumeFrom !== undefined && <p className="rounded-control bg-raised p-3 text-footnote text-ink2" role="status">
            {stale ? 'Another tab changed the original workout. You can save the sets you do here separately.' :
              `${earlierSets} ${earlierSets === 1 ? 'set was' : 'sets were'} already saved. Continue with the remaining sets below.`}
          </p>}
          {!!draft.deferred?.length && <p className="rounded-control bg-raised p-3 text-footnote text-ink2" role="status">
            Held for this check-in: {[...new Set(draft.deferred.map((it) => GYM_EXERCISE_BY_ID[it.exerciseId]?.name ?? it.exerciseId))].join(', ')}.
            {' '}{doneSets === plannedSets ? 'There are no remaining sets in today’s adjusted plan.' : 'Continue with the remaining movements below.'}
            {doneSets > 0 ? ' You can finish and save the work you already did.' : ''}
          </p>}
          {(draft.volumeFactor ?? 1) <= 0.6 && <p className="text-footnote text-ink2">Light session. Use a comfortable weight and keep several reps in reserve.</p>}
          {draft.avoidJoints?.includes('ankles') && <p className="rounded-control bg-raised p-3 text-footnote text-ink2" role="status">
            {plannedSets ? 'Keep your feet unloaded. Use a seated or lying setup you can get into comfortably. Stop if it hurts.' : 'No planned sets fit while keeping weight off your ankles. You can rest today.'}
          </p>}
          {!plannedSets && !!draft.avoidJoints?.length && !draft.resumeFrom && <Button variant="secondary" onClick={discard}>Rest today and close</Button>}
          {draft.items.map((item, i) => {
            const ex = GYM_EXERCISE_BY_ID[item.exerciseId]
            const partner = draft.items[partnerIndex(draft.items, i)]
            const option = availableTrial(item)
            const easierId = item.suggestion?.easierId ?? easierDragonFlag(item.exerciseId)
            const easier = easierId && GYM_EXERCISE_BY_ID[easierId]
            const target = prescribedCount(item.plan, item.suggestion)
            const measure = countUnit(ex, item.plan)
            if (item.held) return (
              <section key={`${item.exerciseId}-${i}`} className="rounded-card border border-line bg-surface p-4">
                <h3 className="text-title3 font-semibold">{ex.name}</h3>
                <p className="mt-1 text-footnote text-ink2">{item.heldAfterReplan ? 'Completed before rebuilding the workout' : 'Completed before this check-in'}</p>
                <ul className="mt-2 space-y-1 text-footnote text-ink2">
                  {item.sets.filter((s) => s.done).map((s, j) => <li key={j}>
                    Set {j + 1} · {countWord(ex, s.reps, item.plan)}{s.load !== undefined ? ` · ${s.load} ${item.unit}` : ''}{s.rpe ? ` · RPE ${s.rpe}` : ''}
                  </li>)}
                </ul>
              </section>
            )
            const step = stepKgFor(ex, location)
            const stepDisplay = entryLoad(step, item.unit)
            const addedLoad = takesAddedLoad(ex, location)
            const rec = records[item.exerciseId]
            const best = rec?.bestE1rm
            return (
              <section key={`${item.exerciseId}-${i}`} className="rounded-card border border-line bg-surface p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {item.finisherOf ? <p className="text-caption font-semibold uppercase tracking-wide text-accent-text">{FINISHER_LABEL}</p> : null}
                    <h3 className="text-title3 font-semibold leading-tight">
                      {ex.name}
                      {rating(ex.id) === 'love' ? <span className="ml-2 text-caption font-medium text-accent-text">Favourite</span> : null}
                    </h3>
                    <p className="mt-0.5 text-footnote text-ink2">
                      {item.sets.length} ×{' '}
                      {item.suggestion?.repsToMoveUp !== undefined
                        ? `${item.suggestion.repsToMoveUp} reps to move up · ${item.plan.range[0]}–${item.plan.range[1]} is the range`
                        : countWord(ex, target, item.plan)}{ex.unilateral && measure === 'seconds' ? ' each side' : ''}{' '}
                      · stop about RPE {item.plan.targetRpe}
                      {ex.load === 'dumbbell' || ex.load === 'kettlebell' ? ` · weight per ${ex.load}` : ''}
                      {best ? ` · est. max ${formatLoad(best.kg, item.unit)}${isFirstEstimate(rec) ? ` (${FIRST_ESTIMATE_NOTE})` : ''}` : ''}
                    </p>
                    {item.suggestion?.why ? <p className="mt-1 text-caption text-ink3">{item.suggestion.why}</p> : null}
                    <div className="flex flex-wrap gap-x-5">
                      <button type="button" aria-label={`How to do ${ex.name}`} onClick={() => openSheet({ kind: 'guide', item: i })}
                        className="inline-flex min-h-11 items-center gap-1.5 text-footnote font-semibold text-accent-text">
                        <Icon name="info" size={15} /> How to
                      </button>
                      {item.sets.some((s) => !s.done) && <button type="button" aria-label={`Swap ${ex.name}`} onClick={() => openSheet({ kind: 'swap', item: i })}
                        className="inline-flex min-h-11 items-center gap-1.5 text-footnote font-semibold text-accent-text">
                        <Icon name="repeat" size={15} /> Swap
                      </button>}
                    </div>
                    {partner && <div className="mt-2 border-l-2 border-accent pl-2.5 text-footnote">
                      <p>Alternate one set with {GYM_EXERCISE_BY_ID[partner.exerciseId].name.toLowerCase()}. Rest {item.restSec} seconds before repeating this lift.</p>
                      <button className="min-h-11 text-left font-semibold text-accent-text" onClick={() => update((d) => {
                        useStraightSets(d, i, Date.now())
                        return d
                      })}>Use straight sets</button>
                    </div>}
                    {option && <button type="button" className="min-h-11 text-left text-footnote font-semibold text-accent-text"
                      onClick={() => setTrialFor(i)}>{option.title}</button>}
                    {easier && gym.ratings[easier.id] !== 'avoid' && fitsToday(easier) && item.sets.some((s) => !s.done) &&
                      <button type="button" className="min-h-11 text-left text-footnote font-semibold text-accent-text" onClick={() => swapTo(i, easier.id)}>
                        Use {easier.name.toLowerCase()} for remaining sets</button>}
                    {item.suggestion?.chooseAlternative && item.sets.some((s) => !s.done) &&
                      <button type="button" className="block min-h-11 text-left text-footnote font-semibold text-accent-text"
                        onClick={() => openSheet({ kind: 'swap', item: i })}>Choose a different lift</button>}
                    {item.swappedFrom ? (
                      <p className="mt-1 text-caption text-ink3">In place of {GYM_EXERCISE_BY_ID[item.swappedFrom]?.name}.</p>
                    ) : null}
                  </div>
                  <button
                    onClick={() => openSheet({ kind: 'menu', item: i })}
                    className="min-h-11 rounded-control border border-line px-3 text-footnote font-medium text-ink2"
                    aria-label={`Exercise options for ${ex.name}`}
                  >
                    Exercise options
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {item.sets.map((s, j) => (
                    <div key={j} data-set={`${i}-${j}`} data-pending-set={!s.done && !item.held ? true : undefined}>
                      <SwipeRow
                        onComplete={s.done ? undefined : () => completeSet(i, j)}
                        onEdit={() => document.querySelector<HTMLInputElement>(`[data-set="${i}-${j}"] input`)?.focus()}
                        onDelete={() =>
                          update((d) => {
                            const [removed] = d.items[i].sets.splice(j, 1)
                            if (d.effortFor?.item === i) {
                              if (d.effortFor.set === j) delete d.effortFor
                              else if (d.effortFor.set > j) d.effortFor.set--
                            }
                            if (removed.done && item.pairedWith) restoreSetRest(d, Date.now(), previous)
                            return d
                          })
                        }
                        canDelete={item.sets.length > 1}
                      >
                      <div
                        className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-inner px-2 py-1.5 ${s.done ? 'bg-ok-soft' : 'bg-raised'}`}
                      >
                        <span className="w-6 text-center text-footnote font-semibold text-ink3">{s.warmup ? 'W' : j + 1}</span>
                        {item.previous?.[j] && !s.done ? (
                          <button
                            onClick={() =>
                              update((d) => {
                                const prev = d.items[i].previous?.[j]
                                if (!prev) return d
                                const set = d.items[i].sets[j]
                                if (prev.load !== undefined) {
                                  set.load = prev.load
                                  set.loadEdited = true
                                }
                                set.reps = prev.reps
                                set.repsEdited = true
                                return d
                              })
                            }
                            className="order-last basis-full text-left text-caption text-ink3 hover:text-ink2"
                            aria-label={`Previous: ${item.previous[j].load !== undefined ? `${item.previous[j].load} ${item.unit} × ` : ''}${countWord(ex, item.previous[j].reps, item.plan)} — tap to use`}
                          >
                            Previous: {item.previous[j].load !== undefined ? `${item.previous[j].load} ${item.unit} × ` : ''}
                            {measure === 'reps' ? item.previous[j].reps : countWord(ex, item.previous[j].reps, item.plan)}
                            {item.previous[j].rpe !== undefined ? ` @${item.previous[j].rpe}` : ''} · tap to use
                          </button>
                        ) : null}
                        {ex.load !== 'bodyweight' || addedLoad || s.load !== undefined ? (
                          <Stepper
                            value={s.load ?? (addedLoad ? 0 : undefined)}
                            first={entryLoad(minKgFor(ex, location) ?? step, item.unit)}
                            unit={item.unit}
                            step={stepDisplay || 1}
                            label={`${ex.name}, set ${j + 1} ${ex.assisted ? 'assistance' : addedLoad ? 'added load' : 'load'}`}
                            commitOnBlur={s.done}
                            onChange={(v) => changeLoad(i, j, v)}
                          />
                        ) : (
                          <span className="flex-1 text-center text-footnote text-ink3">{unloadedLabel(ex)}</span>
                        )}
                        <Stepper
                          value={s.reps}
                          unit={measure === 'seconds' ? 'sec' : measure}
                          step={measure === 'seconds' ? 5 : 1}
                          label={`${ex.name}, set ${j + 1} ${measure}`}
                          onChange={(v) =>
                            update((d) => {
                              d.items[i].sets[j].reps = Math.max(0, Math.round(v ?? 0))
                              d.items[i].sets[j].repsEdited = true
                              return d
                            })
                          }
                        />
                        <button
                          onClick={() => completeSet(i, j)}
                          aria-pressed={s.done}
                          aria-label={`${s.done ? 'Undo' : 'Complete'} set ${j + 1} of ${ex.name}`}
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control ds-press ${
                            s.done ? 'bg-ok text-white' : 'border border-line-strong bg-surface text-ink3'
                          }`}
                        >
                          <Icon name="check" />
                        </button>
                      </div>
                      </SwipeRow>
                      {s.done && s.rpe !== undefined ? (
                        <p className="mt-0.5 pl-9 text-caption text-ink3">RPE {s.rpe}</p>
                      ) : null}
                      {askRpe && askRpe.item === i && askRpe.set === j ? (
                        <div data-effort className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-1 sm:pl-8" role="group" aria-label={`Effort for ${ex.name}, set ${j + 1}`}>
                          <span className="mr-1 text-caption text-ink3">Effort</span>
                          {RPE_CHOICES.map((r) => (
                            <button
                              key={r}
                              onClick={() => finishEffort(i, j, r)}
                              className="h-11 min-w-11 rounded-lg border border-line bg-surface px-2 text-body font-semibold ds-press"
                            >
                              {r}
                            </button>
                          ))}
                          <button onClick={() => finishEffort(i, j)} className="h-11 px-2 text-caption text-ink3">
                            Skip
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() =>
                      update((d) => {
                        const last = d.items[i].sets[d.items[i].sets.length - 1]
                        d.items[i].sets.push({ ...(last?.load !== undefined ? { load: last.load } : {}), reps: addedSetReps(last?.reps, item.plan, item.suggestion), done: false })
                        return d
                      })
                    }
                    className="min-h-11 flex-1 rounded-control border border-dashed border-line-strong text-footnote font-medium text-ink2"
                  >
                    Add set
                  </button>
                  {item.sets.length > 1 && !item.sets[item.sets.length - 1].done ? (
                    <button
                      onClick={() =>
                        update((d) => {
                          d.items[i].sets.pop()
                          return d
                        })
                      }
                      className="min-h-11 rounded-control border border-line px-3 text-footnote text-ink3"
                    >
                      Remove set
                    </button>
                  ) : null}
                </div>
              </section>
            )
          })}
          <button
            onClick={() => openSheet({ kind: 'add' })}
            className="min-h-12 w-full rounded-card border border-dashed border-line-strong text-body font-medium text-ink2"
          >
            Add an exercise
          </button>
        </div>
      </main>

      {rest && !needLoad && !doubt && !sheet ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
          {rest.nextExerciseId && GYM_EXERCISE_BY_ID[rest.nextExerciseId] && <p className="mx-auto mb-2 max-w-xl text-footnote font-semibold" role="status">Next · {GYM_EXERCISE_BY_ID[rest.nextExerciseId].name}</p>}
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <RingTimer left={restLeft} total={rest.total} label={`Rest, ${mmss(restLeft)} left`}>
              <span className="tnum font-display text-title3 font-semibold">{mmss(restLeft)}</span>
            </RingTimer>
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold">Rest</p>
              {/* On a phone the buttons need the room; the hint shows where there is space. */}
              <p className="hidden text-caption text-ink3 sm:block">Start the next set when you are ready.</p>
            </div>
            <Button variant="secondary" aria-label="15 seconds less" onClick={() => setDraft((d) => d.rest ? { ...d, rest: { ...d.rest, until: d.rest.until - 15_000 } } : d)}>
              −15
            </Button>
            <Button variant="secondary" aria-label="15 seconds more" onClick={() => setDraft((d) => d.rest ? { ...d, rest: { ...d.rest, until: d.rest.until + 15_000, total: d.rest.total + 15 } } : d)}>
              +15
            </Button>
            <Button variant="ghost" className="min-w-12 shrink-0" onClick={() => setDraft((d) => ({ ...d, rest: undefined }))}>
              Skip
            </Button>
          </div>
        </div>
      ) : null}

      <Sheet open={!!needLoad} onClose={() => setNeedLoad(null)} label="Set the weight">
        {needLoad && draft.items[needLoad.item] ? (
          <div className="space-y-3">
            <h2 className="text-title3 font-semibold">{asksAssistance ? 'How much assistance did you use?' : 'What weight was that?'}</h2>
            <p className="text-footnote text-ink2">
              {asksSled ? 'Enter the plates you added, or log the empty sled.' : asksAssistance ? 'Enter the help shown on the machine, or confirm you did the set without help.' :
                `${GYM_EXERCISE_BY_ID[needLoad.exerciseId]?.name} uses an external load. Enter the weight you lifted to set your next target.`}
            </p>
            <label className="flex items-center gap-2 text-footnote text-ink2">
              <span className="shrink-0">{asksAssistance ? 'Assistance' : 'Weight'}</span>
              <input
                inputMode="decimal"
                value={needValue}
                onChange={(e) => setNeedValue(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-lg bg-raised px-3 text-center text-title3 font-semibold tnum"
                aria-label={`${asksAssistance ? 'Assistance' : 'Weight'} in ${draft.items[needLoad.item].unit}`}
              />
              <span className="shrink-0 text-ink3">{draft.items[needLoad.item].unit}</span>
            </label>
            <div className="grid gap-2">
              <Button
                size="lg"
                disabled={parseTypedLoad(needValue) === undefined}
                onClick={() => {
                  const { item, set } = needLoad
                  const typed = parseTypedLoad(needValue)
                  if (typed === undefined) return
                  setNeedLoad(null)
                  // Logged with that weight; the doubt check still runs on it.
                  completeSet(item, set, false, false, typed)
                }}
              >
                Log the set
              </Button>
              {allowsUnloaded(GYM_EXERCISE_BY_ID[draft.items[needLoad.item].exerciseId]) ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const { item, set } = needLoad
                    setNeedLoad(null)
                    completeSet(item, set, true, true)
                  }}
                >
                    {asksSled ? 'Log empty sled' : asksAssistance ? 'Log with no assistance' : 'Log as bodyweight'}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet open={!!doubt} onClose={() => setDoubt(null)} label="Check this load">
        {doubt && draft.items[doubt.item] ? (
          <div className="space-y-3">
            <h2 className="text-title3 font-semibold">Is {doubt.load} {draft.items[doubt.item].unit} right?</h2>
            <p className="text-footnote text-ink2">
              That is well above your best on {GYM_EXERCISE_BY_ID[draft.items[doubt.item].exerciseId]?.name.toLowerCase()} ({doubt.best}{' '}
              {draft.items[doubt.item].unit}). A typo here would set your records and your next loads, so it is worth a check.
            </p>
            <div className="grid gap-2">
              {doubt.probably !== undefined ? (
                <Button
                  size="lg"
                  onClick={() => confirmLoad(doubt.probably!)}
                >
                  I meant {doubt.probably} {draft.items[doubt.item].unit}
                </Button>
              ) : null}
              <Button
                size="lg"
                variant={doubt.probably !== undefined ? 'secondary' : 'primary'}
                onClick={() => confirmLoad(doubt.load)}
              >
                Yes, {doubt.load} {draft.items[doubt.item].unit} is right
              </Button>
              <Button variant="ghost" onClick={() => setDoubt(null)}>
                Let me change it
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet open={!!sheet} onClose={() => setSheet(null)} label={sheetLabel}>
        <div>
          {sh?.kind === 'menu' && sheetItem && sheetExercise ? (
            <MenuSheet
              exercise={sheetExercise}
              hardHere={location.hardHere?.includes(sheetExercise.id) ?? false}
              favoriteHere={gym.favoriteAt[sheetExercise.id] === location.id}
              locationName={location.name}
              onGuide={() => setSheet({ kind: 'guide', item: sh.item })}
              onHard={() => dispatch({ type: 'GYM', op: { op: 'toggleHardHere', locationId: location.id, exerciseId: sheetExercise.id } })}
              onFavorite={(on) => dispatch({ type: 'GYM', op: { op: 'setFavorite', exerciseId: sheetExercise.id, locationId: on ? location.id : null } })}
              onSwap={() => setSheet({ kind: 'swap', item: sh.item })}
              onRemove={() => removeItem(sh.item!)}
            />
          ) : null}
          {sh?.kind === 'guide' && sheetExercise ? (
            <GuideSheet key={`${sh.item}-${sheetExercise.id}`} exercise={sheetExercise} onDone={() => setSheet(null)} />
          ) : null}
          {sh?.kind === 'swap' && sheetItem && sheetExercise ? (
            <>
              <ExercisePicker
                key={`${sh.item}-${sheetExercise.id}`}
                title={`Swap ${sheetExercise.name}`}
                intro="Recommended first: the same movement, then the same muscles. Search to use anything else."
                pickLabel="Swap to this"
                location={location}
                ratings={gym.ratings}
                {...(split ? { day: split } : {})}
                exclude={swapExclude}
                allowed={allowedToday}
                recommended={recommendedSwaps}
                hiddenNote={keptOutNote}
                onPick={(id) => swapTo(sh.item!, id)}
              />
              <div className="mt-4 border-t border-line pt-3">
                {!recommendedSwaps.length && <p className="mb-2 text-footnote text-ink2">
                  Nothing at {location.name} does the same job today. Pick any exercise above, or leave it out of today.
                </p>}
                <Button variant="ghost" full onClick={() => removeItem(sh.item!)}>Leave it out today</Button>
              </div>
            </>
          ) : null}
          {sh?.kind === 'add' ? (
            <ExercisePicker
              key="add"
              title="Add an exercise"
              intro={draft.items.length
                ? 'Recommended first: movements this workout does not have yet, your favourites and lifts you know. Search to add anything else.'
                : 'Quick log: choose an exercise, log its sets, then add the next one. These sets count like any planned workout for your next loads and your weekly volume.'}
              pickLabel="Add to today"
              location={location}
              ratings={gym.ratings}
              {...(split ? { day: split } : {})}
              exclude={inSession}
              allowed={allowedToday}
              recommended={recommendedAdds}
              hiddenNote={keptOutNote}
              onPick={addExercise}
            />
          ) : null}
        </div>
      </Sheet>

      <Sheet open={Boolean(trial)} onClose={() => setTrialFor(null)} title={trial?.title}>
        {prep && trial && <div>
          <p className="text-body text-ink2">Try one set of {trial.name} for up to {trial.target} clean reps{trial.perSide ? ' per side' : ''}. {trial.cue} Stop when a rep loses its shape. Your remaining sets use {GYM_EXERCISE_BY_ID[prep.exerciseId].name.toLowerCase()}.</p>
          <p className="mt-3 text-footnote font-semibold">{trial.perSide ? 'How many clean reps did you complete on your weaker side?' : 'How many clean reps did you complete?'}</p>
          <div className="mt-2 flex flex-wrap gap-2">{Array.from({ length: trial.target + 1 }, (_, n) =>
            <button type="button" key={n} onClick={() => recordTrial(n)}
              aria-label={`Log ${n} ${trial.name} ${n === 1 ? 'rep' : 'reps'}`}
              className="min-h-11 min-w-12 rounded-control border border-line bg-raised px-3 font-semibold tnum">{n}</button>)}</div>
          <button type="button" onClick={() => setTrialFor(null)} className="mt-3 min-h-11 text-footnote font-semibold text-accent-text">Keep my planned sets</button>
          <button type="button" onClick={() => { setTrialFor(null); setReportOpen(true) }} className="ml-4 min-h-11 text-footnote font-semibold text-accent-text">Something hurts</button>
        </div>}
      </Sheet>
      <Sheet open={reportOpen} onClose={() => setReportOpen(false)} title="Report pain or discomfort">
        {reportOpen && <JointReportFields onRecord={recordSymptom} onCancel={() => setReportOpen(false)} />}
      </Sheet>
      <Sheet open={finishing} onClose={() => draft.stopReport ? onClose() : setFinishing(false)} title={draft.stopReport ? 'Training stopped' : 'Finish this session?'}>
        {draft.stopReport && <JointReportNotice recorded={draft.stopReport} onUndo={(report) => {
          if (!canEdit() || !draft.stopReport) return
          dispatch({ type: 'RECORD_SYMPTOM', event: { ...report, at: Math.max(Date.now(), draft.stopReport.at), source: 'attempt', correction: true, correctsAt: draft.stopReport.at } })
          setDraft((d) => ({ ...d, stopReport: undefined }))
        }} />}
        <p className="mt-2 text-body text-ink2">{stale ? 'The original workout changed. Save the new sets as a separate workout, or discard this continuation.'
          : draft.stopReport ? 'Your joint report is saved. The remaining lifts have been dropped for this session.'
          : 'Finished sets go into your workout history. You can return to unfinished sets from Home today.'}</p>
        {!draft.stopReport && unfinishedLine(draft) ? (
          <p className="mt-2 rounded-control bg-raised p-3 text-footnote text-ink2" role="status">
            {unfinishedLine(draft)}
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-4 rounded-inner bg-raised p-4">
          <div>
            <div className="text-footnote font-medium text-ink3">Sets done</div>
            <div className="mt-0.5 font-display text-display font-semibold leading-none">
              {doneSets}
              <span className="ml-1 text-body font-normal text-ink3">of {plannedSets}</span>
            </div>
          </div>
          <div>
            <div className="text-footnote font-medium text-ink3">Time</div>
            <div className="tnum mt-0.5 font-display text-display font-semibold leading-none">{mmss(elapsed)}</div>
          </div>
        </div>
        {summary && summary.maxes.length ? (
          <div className="mt-3 rounded-inner border border-accent/30 bg-accent-soft p-4" aria-live="polite">
            <div className="text-footnote font-semibold text-accent-text">New lifting record{summary.maxes.length > 1 ? 's' : ''}</div>
            <p className="mt-1 text-caption text-ink2">Your strongest set by weight and reps.</p>
            <ul className="mt-2 space-y-1.5">
              {summary.maxes.map((m) => (
                <li key={m.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-body text-ink">{m.name}</span>
                  <span className="shrink-0 font-display text-title3 font-semibold text-ink">
                    <CountUp value={m.value} decimals={Number.isInteger(m.value) ? 0 : 1} />
                    <span className="ml-1 text-footnote font-normal text-ink3">{m.unit} × {m.reps}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {summary && summary.next.length ? (
          <div className="mt-3 rounded-inner bg-raised p-4">
            <div className="text-footnote font-semibold text-ink2">Next time</div>
            <ul className="mt-2 space-y-2">
              {summary.next.map((n) => (
                <li key={n.exerciseId}>
                  <span className="block text-footnote font-medium text-ink">{n.name}</span>
                  <span className="block text-footnote text-ink2">{n.text}</span>
                  <span className="block text-caption text-ink3">{n.why}</span>
                  {n.maxNote ? <span className="block text-caption text-ink3">{n.maxNote}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <label className="mt-4 block">
          <span className="text-footnote font-medium text-ink2">Notes (optional)</span>
          <textarea
            value={draft.notes ?? ''}
            onChange={(e) => {
              const notes = e.target.value
              setDraft((d) => ({ ...d, notes }))
            }}
            rows={2}
            maxLength={2000}
            placeholder="How it felt, a machine setting, anything to remember"
            className="mt-1 w-full rounded-control border border-line bg-raised px-3 py-2 text-body"
          />
        </label>
        <div className="mt-4 grid gap-2">
          <Button size="lg" full onClick={() => save(stale)}>
            {doneSets ? stale ? 'Save new sets as a separate workout' : 'Save session' : 'Close — nothing to save'}
          </Button>
          {!draft.stopReport && <Button variant="secondary" full onClick={() => setFinishing(false)}>
            Keep training
          </Button>}
          <Button variant="ghost" full onClick={discard} className="text-danger-text">
            {draft.resumeFrom !== undefined ? 'Discard this continuation' : 'Discard session'}
          </Button>
        </div>
      </Sheet>

      <Sheet open={!!unlocked} onClose={onClose} label="Badge unlocked">
        <div className="flex flex-col items-center px-2 pb-2 pt-2 text-center">
          {unlocked?.map((b) => (
            <div key={b.id} className="mb-4 flex flex-col items-center">
              <div className="ds-badge-in">
                <BadgeGlyph icon={b.icon} size={88} />
              </div>
              <p className="mt-4 text-footnote font-semibold text-accent-text">Badge unlocked</p>
              <h2 className="mt-1 font-display text-title2 font-semibold text-ink">{b.name}</h2>
              <p className="mt-1 max-w-[34ch] text-body text-ink2">{b.desc}</p>
            </div>
          ))}
          <Button size="lg" full onClick={onClose}>
            Nice
          </Button>
        </div>
      </Sheet>
    </div>
  )
  return createPortal(body, document.body)
}

function Stepper({
  value,
  first,
  unit,
  step,
  label,
  commitOnBlur,
  onChange,
}: {
  value: number | undefined
  first?: number
  unit: string
  step: number
  label: string
  commitOnBlur?: boolean
  onChange: (v: number | undefined) => void
}) {
  const [typed, setTyped] = useState<string | null>(null)
  const isCount = unit === 'reps' || unit === 'sec'
  const display = value === undefined ? '' : String(value)
  const nudge = (by: number) => onChange(value === undefined ? first || step : Math.max(0, Number((value + by).toFixed(3))))
  return (
    <div className="flex flex-1 items-center justify-center gap-1" role="group" aria-label={label}>
      <button
        onClick={() => nudge(-step)}
        disabled={!value}
        className="ds-press flex h-11 w-11 items-center justify-center rounded-control text-ink2 hover:bg-surface"
        aria-label={`Less ${unit}, ${label}`}
      >
        <Icon name="minus" />
      </button>
      <input
        inputMode={isCount ? 'numeric' : 'decimal'}
        value={typed ?? display}
        placeholder={isCount ? undefined : '—'}
        onFocus={(e) => {
          setTyped(display)
          e.target.select()
        }}
        onBlur={() => {
          if (commitOnBlur && typed !== null && typed !== display) {
            const n = Number(typed.replace(',', '.'))
            if (Number.isFinite(n)) onChange(typed === '' ? undefined : n)
          }
          setTyped(null)
        }}
        onKeyDown={(e) => { if (commitOnBlur && e.key === 'Enter') e.currentTarget.blur() }}
        onChange={(e) => {
          const raw = e.target.value
          if (!(isCount ? /^\d*$/ : /^\d*(?:[.,]\d{0,3})?$/).test(raw)) return
          const v = Number(raw.replace(',', '.'))
          if (v >= 1000) return
          setTyped(raw)
          if (commitOnBlur) return
          if (!raw) onChange(undefined)
          else if (Number.isFinite(v)) onChange(v)
        }}
        className="h-11 w-14 rounded-lg bg-surface text-center text-title3 font-semibold tnum"
        aria-label={label}
      />
      <button
        onClick={() => nudge(step)}
        disabled={(value ?? 0) + step >= 1000}
        className="ds-press flex h-11 w-11 items-center justify-center rounded-control text-ink2 hover:bg-surface"
        aria-label={`More ${unit}, ${label}`}
      >
        <Icon name="plus" />
      </button>
      <span className="w-7 text-caption text-ink3">{unit}</span>
    </div>
  )
}

function MenuSheet({
  exercise,
  hardHere,
  favoriteHere,
  locationName,
  onGuide,
  onHard,
  onFavorite,
  onSwap,
  onRemove,
}: {
  exercise: GymExercise
  hardHere: boolean
  favoriteHere: boolean
  locationName: string
  onGuide: () => void
  onHard: () => void
  onFavorite: (on: boolean) => void
  onSwap: () => void
  onRemove: () => void
}) {
  return (
    <>
      <h2 className="text-title3 font-semibold">{exercise.name}</h2>
      <div className="mt-3"><ExerciseRating exerciseId={exercise.id} /></div>
      <div className="mt-3 grid gap-2">
        <button onClick={onGuide} className="min-h-12 rounded-control border border-line text-body font-medium">
          How to do it and a video
        </button>
        <button onClick={onSwap} className="min-h-12 rounded-control border border-line text-body font-medium">
          Swap — machine taken or not today
        </button>
        <button onClick={onHard} aria-pressed={hardHere} className="min-h-12 rounded-control border border-line text-body font-medium">
          {hardHere ? `Marked hard to do at ${locationName} — undo` : `Hard to do at ${locationName}`}
        </button>
        <button onClick={() => onFavorite(!favoriteHere)} aria-pressed={favoriteHere} className="min-h-12 rounded-control border border-line text-body font-medium">
          {favoriteHere ? `Doing this first at ${locationName} — undo` : `Do this here first: ${locationName}`}
        </button>
        <button onClick={onRemove} className="min-h-11 text-body font-medium text-danger-text">
          Remove from today
        </button>
      </div>
    </>
  )
}

/**
 * How to do a movement in today's workout, with a demonstration video and its rating. It only reads and rates:
 * opening it, following an easier or harder version, playing or pinning a video never changes the workout.
 */
function GuideSheet({ exercise, onDone }: { exercise: GymExercise; onDone: () => void }) {
  const [shown, setShown] = useState(exercise)
  const other = shown.id !== exercise.id
  return (
    <>
      {other && <button type="button" onClick={() => setShown(exercise)}
        className="inline-flex min-h-11 items-center gap-1 text-footnote font-semibold text-accent-text">
        <Icon name="chevronL" size={15} /> Back to {exercise.name}
      </button>}
      <h2 className="text-title3 font-semibold">{shown.name}</h2>
      {other && <p className="mt-1 text-caption text-ink3">Reading only: today’s workout still has {exercise.name.toLowerCase()}. Use Swap on the exercise to change it.</p>}
      <div className="mt-2"><GymExerciseGuide exercise={shown} onOpen={setShown} rate /></div>
      <Button variant="secondary" full size="lg" className="mt-4" onClick={onDone}>Back to the workout</Button>
    </>
  )
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}
