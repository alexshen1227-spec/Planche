import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GYM_EXERCISE_BY_ID, type GymExercise } from '../../data/gym/exercises'
import { PATTERN_LABEL } from '../../data/gym/catalog'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import { primeSignal, releaseSignal, signalTone } from '../../lib/audio'
import { alternativesFor, availableAt } from '../../lib/gym/availability'
import { bodyweightCapacity } from '../../lib/gym/bodyweight'
import { GymExerciseGuide } from './ExerciseGuide'
import { goalEmphasisFor, restFor, setsForFactor, type Emphasis } from '../../lib/gym/builder'
import { addedSetReps, conservative, dayOfItem, prefillReps, previousSets, saveDraft, sessionFromDraft, type DraftItem, type GymDraft } from '../../lib/gym/draft'
import { allowsUnloaded, countUnit, countWord, estimatedMaxGains, FIRST_ESTIMATE_NOTE, gymRecords, isFirstEstimate, isUnloadedSet, lastPerformance, plyoGate, repPlanFor, suggestLoad } from '../../lib/gym/progression'
import type { GoalWeights, GymLocation, Rating } from '../../lib/gym/types'
import { displayLoad, entryLoad, formatLoad, stepKgFor, takesAddedLoad, toKg, unitFor, unloadedLabel } from '../../lib/gym/units'
import { continueGymSession, doubtedLoad, newGymSessionId } from '../../lib/gym/state'
import { gymBadges, type GymBadge } from '../../lib/plan/weekly'
import { Icon } from '../Icon'
import { finishBlocker, nextTimeLines, unfinishedLine } from '../../lib/gym/sessionLines'
import { askStillApplies, parseTypedLoad, type LoadAsk } from '../../lib/gym/loadAsk'
import { BadgeGlyph, Button, CountUp, RingTimer, Sheet, SwipeRow } from '../ds'

const RPE_CHOICES = [6, 7, 8, 9, 10]

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
  useEffect(() => {
    if (!root) return
    const wasInert = root.hasAttribute('inert')
    const wasHidden = root.getAttribute('aria-hidden')
    root.setAttribute('inert', '')
    root.setAttribute('aria-hidden', 'true')
    return () => {
      if (!wasInert) root.removeAttribute('inert')
      if (wasHidden === null) root.removeAttribute('aria-hidden')
      else root.setAttribute('aria-hidden', wasHidden)
    }
  }, [root])
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
  sets = 3,
  now = Date.now(),
  day: { emphasis?: Emphasis; rpeShift?: number; factor?: number; goals?: GoalWeights } = {},
): DraftItem {
  const base = repPlanFor(exercise, day.emphasis ?? goalEmphasisFor(day.goals, exercise), youth)
  const shift = day.rpeShift ?? ((day.factor ?? 1) < 1 ? -1 : 0)
  const plan = shift ? { ...base, targetRpe: Math.max(6, base.targetRpe + shift) } : base
  const suggestion = suggestLoad({ exerciseId: exercise.id, location, sessions, plan, youth, now })
  const unit = unitFor(exercise, location)
  const last = lastPerformance(sessions, exercise.id, location.id, now)
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
    sets: Array.from({ length: sets }, (_, i) => ({
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
}: {
  draft: GymDraft
  location: GymLocation
  onClose: () => void
}) {
  const { state, dispatch } = useStore()
  const gym = state.gym!
  const youth = conservative(state.profile)
  useInertBackground()
  const [draft, setDraft] = useState<GymDraft>(initial)
  const previous = draft.resumeFrom === undefined ? undefined : gym.sessions.find((s) => s.id === draft.id)
  const stale = draft.resumeFrom !== undefined && (previous?.completion !== 'partial' || previous.endedAt !== draft.resumeFrom)
  const [now, setNow] = useState(() => Date.now())
  const rest = draft.rest
  const askRpe = draft.effortFor
  const [sheet, setSheet] = useState<{ kind: 'swap' | 'add' | 'menu'; item?: number } | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [query, setQuery] = useState('')
  const restEndedRef = useRef((initial.rest?.until ?? Infinity) <= Date.now())
  const [unlocked, setUnlocked] = useState<GymBadge[] | null>(null)
  const lastSheet = useRef(sheet)
  if (sheet) lastSheet.current = sheet
  const sh = sheet ?? lastSheet.current

  // Every change is mirrored, so a closed tab or a crash resumes here.
  const closedRef = useRef(false)
  useEffect(() => {
    if (!closedRef.current) saveDraft(draft)
  }, [draft])
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

  const update = (fn: (d: GymDraft) => GymDraft) => setDraft((d) => fn(structuredClone(d)))
  const records = useMemo(() => gymRecords(gym.sessions, location.id), [gym.sessions, location.id])

  /** A load far above this lift's best, asked about before the set is logged: a slipped decimal once set records for good. */
  const [doubt, setDoubt] = useState<{ item: number; set: number; probably?: number; best: number } | null>(null)

  /** A loaded lift completed with no weight on it: ask for the weight (or bodyweight, where the movement allows it). */
  const [needLoadAsk, setNeedLoad] = useState<LoadAsk | null>(null)
  // The question is about one movement: a swap or an edit that moves it away ends the question.
  const needLoad = askStillApplies(needLoadAsk, draft.items) ? needLoadAsk : null
  const asksAssistance = needLoad && GYM_EXERCISE_BY_ID[needLoad.exerciseId]?.assisted
  const [needValue, setNeedValue] = useState('')
  /** One sheet at a time: opening any of them closes the others' questions. */
  const openSheet = (next: { kind: 'swap' | 'add' | 'menu'; item?: number } | null) => {
    if (next) {
      setNeedLoad(null)
      setDoubt(null)
    }
    setSheet(next)
  }

  const completeSet = (i: number, j: number, checked = false, unloadedOk = false, withLoad?: number) => {
    const item = draft.items[i]
    if (!fitsToday(GYM_EXERCISE_BY_ID[item.exerciseId])) return
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
    if (!set.done && !unloadedOk && ((exercise.assisted && set.load === undefined) || isUnloadedSet(exercise, { kg: set.load }))) {
      setNeedValue('')
      setNeedLoad({ item: i, set: j, exerciseId: item.exerciseId })
      return
    }
    if (!checked && !set.done && set.load !== undefined && set.load > 0 && !GYM_EXERCISE_BY_ID[item.exerciseId]?.assisted) {
      const odd = doubtedLoad(gym.sessions, item.exerciseId, toKg(set.load, item.unit))
      if (odd) {
        setDoubt({
          item: i,
          set: j,
          best: displayLoad(odd.bestKg, item.unit),
          ...(odd.probablyKg !== undefined ? { probably: displayLoad(odd.probablyKg, item.unit) } : {}),
        })
        return
      }
    }
    primeSignal()
    const wasDone = draft.items[i].sets[j].done
    const at = Date.now()
    const secs = item.restSec
    update((d) => {
      const s = d.items[i].sets[j]
      s.done = !wasDone
      if (wasDone) {
        delete s.at
        delete s.rpe
        if (d.effortFor?.item === i && d.effortFor.set === j) delete d.effortFor
      } else {
        if (exercise.assisted && (withLoad !== undefined || unloadedOk)) {
          const help = withLoad ?? 0
          s.load = help
          for (const later of d.items[i].sets.slice(j + 1)) if (!later.done && later.load === undefined) later.load = help
        }
        s.at = at
        d.effortFor = { item: i, set: j }
        d.rest = { until: at + secs * 1000, total: secs }
      }
      return d
    })
    if (wasDone) return
    buzz(25)
    restEndedRef.current = false
    // The completed button is replaced under the finger, which dropped focus to the page: it goes on to the next
    // set's input, or back to this set's own button when it was the last.
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLElement>(`[data-set="${i}-${j + 1}"] input`) ?? document.querySelector<HTMLElement>(`[data-set="${i}-${j}"] button[aria-label^="Set"]`)
      next?.focus()
    })
  }

  const swapTo = (i: number, exerciseId: string) => {
    const ex = GYM_EXERCISE_BY_ID[exerciseId]
    if (!fitsToday(ex)) return
    update((d) => {
      const old = d.items[i]
      const done = old.sets.filter((s) => s.done)
      const left = Math.max(1, old.sets.length - done.length)
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
      if (done.length) d.items.splice(i, 1, { ...old, sets: done }, fresh)
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

  /** What today's plan kept out stays out of swaps and additions too. */
  const fitsToday = (e: GymExercise) =>
    !e.stress.some((j) => draft.avoidJoints?.includes(j)) && !e.primary.some((m) => draft.musclesOff?.includes(m))

  const addExercise = (exerciseId: string) => {
    if (!fitsToday(GYM_EXERCISE_BY_ID[exerciseId])) return
    update((d) => {
      const ex = GYM_EXERCISE_BY_ID[exerciseId]
      const factor = d.volumeFactor ?? 1
      d.items.push(
        draftItemFor(ex, location, gym.sessions, youth, setsForFactor(factor), Date.now(), { factor, goals: d.goals ?? gym.prefs?.goals }),
      )
      return d
    })
    setSheet(null)
    setQuery('')
  }

  /** Estimated maxes this session would beat, for the summary and the toast. */
  const newMaxes = (session: ReturnType<typeof sessionFromDraft>) => {
    // Beating an earlier session's estimate on the same lift (the same place for a machine), load and reps alone.
    const mine = new Map<string, number>()
    const alreadyEarned = new Map(previous ? estimatedMaxGains(gym.sessions).filter((g) => g.sessionId === previous.id).map((g) => [g.exerciseId, g.kg]) : [])
    for (const g of estimatedMaxGains([...gym.sessions.filter((x) => x.id !== session.id), session])) {
      if (g.sessionId === session.id && g.kg > (alreadyEarned.get(g.exerciseId) ?? 0)) mine.set(g.exerciseId, g.kg)
    }
    return [...mine].map(([id, kg]) => {
      const unit = draft.items.find((it) => it.exerciseId === id)?.unit ?? 'kg'
      return { id, name: GYM_EXERCISE_BY_ID[id]?.name ?? 'Lift', value: displayLoad(kg, unit), unit }
    })
  }

  const summary = useMemo(() => {
    if (!finishing) return null
    const segment = sessionFromDraft(draft, Date.now())
    if (!segment.exercises.length || stale) return null
    const session = previous ? continueGymSession(previous, segment) : segment
    return {
      maxes: session.exercises.length ? newMaxes(session) : [],
      // What to aim for next time, lift by lift, from the rule the builder uses.
      next: nextTimeLines(session, [...gym.sessions.filter((s) => s.id !== session.id), session], location, youth),
    }
    // Computed when the sheet opens; the draft cannot change underneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishing, stale, previous])

  const blocker = finishBlocker({ needLoad: !!needLoad, doubt: !!doubt })
  const save = (separate = false) => {
    if (closedRef.current) return
    // A question still waiting on an answer holds a set that is not saved: it is answered or closed first.
    if (blocker) {
      setFinishing(false)
      pushToast(blocker, 'info')
      return
    }
    const segment = sessionFromDraft(draft, Date.now())
    if (!segment.exercises.length) {
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
    dispatch({ type: 'GYM', op: { op: 'saveSession', session: segment, resumeFrom: separate ? undefined : draft.resumeFrom } })
    saveDraft(null)
    const prs = newMaxes(session).length
    const fresh = gymBadges({ sessions: state.sessions, gym: { ...gym, sessions: [...gym.sessions.filter((s) => s.id !== session.id), session] } }).filter(
      (b) => b.at !== undefined && !earnedBefore.has(b.id),
    )
    pushToast(prs ? `Saved — ${prs} new estimated max${prs > 1 ? 'es' : ''}.` : 'Gym session saved.', 'success')
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
    closedRef.current = true
    saveDraft(null)
    onClose()
  }

  const doneSets = draft.items.reduce((n, it) => n + it.sets.filter((s) => s.done).length, 0)
  const plannedSets = draft.items.reduce((n, it) => n + it.sets.length, 0)
  const elapsed = (now - (draft.resumedAt ?? draft.startedAt)) / 1000
  const earlierSets = previous?.exercises.reduce((n, log) => n + log.sets.length, 0) ?? 0
  const restLeft = rest ? (rest.until - now) / 1000 : 0
  const rating = (id: string): Rating | undefined => gym.ratings[id]

  const body = (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg text-ink" role="dialog" aria-label="Gym session">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-title3 font-semibold">{draft.name}</p>
          <p className="text-caption text-ink3">
            {location.name} · {mmss(elapsed)} · {doneSets}/{plannedSets} sets
          </p>
        </div>
        <Button
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
          {draft.items.map((item, i) => {
            const ex = GYM_EXERCISE_BY_ID[item.exerciseId]
            if (!fitsToday(ex)) return (
              <section key={`${item.exerciseId}-${i}`} className="rounded-card border border-line bg-surface p-4">
                <h3 className="text-title3 font-semibold">{ex.name}</h3>
                <p className="mt-1 text-footnote text-ink2">Completed before this check-in</p>
                <ul className="mt-2 space-y-1 text-footnote text-ink2">
                  {item.sets.filter((s) => s.done).map((s, j) => <li key={j}>
                    Set {j + 1} · {s.reps} {countUnit(ex) === 'seconds' ? 'sec' : 'reps'}{s.load !== undefined ? ` · ${s.load} ${item.unit}` : ''}{s.rpe ? ` · RPE ${s.rpe}` : ''}
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
                    <h3 className="text-title3 font-semibold leading-tight">
                      {ex.name}
                      {rating(ex.id) === 'love' ? <span className="ml-2 text-caption font-medium text-accent-text">Favourite</span> : null}
                    </h3>
                    <p className="mt-0.5 text-footnote text-ink2">
                      {item.sets.length} ×{' '}
                      {item.suggestion?.repsToMoveUp !== undefined
                        ? `${item.suggestion.repsToMoveUp} reps to move up · ${item.plan.range[0]}–${item.plan.range[1]} is the range`
                        : `${item.plan.range[0]}–${item.plan.range[1]} ${countUnit(ex) === 'seconds' ? 'seconds' : 'reps'}`}{' '}
                      · stop about RPE {item.plan.targetRpe}
                      {best ? ` · est. max ${formatLoad(best.kg, item.unit)}${isFirstEstimate(rec) ? ` (${FIRST_ESTIMATE_NOTE})` : ''}` : ''}
                    </p>
                    {item.suggestion ? <p className="mt-1 text-caption text-ink3">{item.suggestion.why}</p> : null}
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
                    <div key={j} data-set={`${i}-${j}`}>
                      <SwipeRow
                        onComplete={s.done ? undefined : () => completeSet(i, j)}
                        onEdit={() => document.querySelector<HTMLInputElement>(`[data-set="${i}-${j}"] input`)?.focus()}
                        onDelete={() =>
                          update((d) => {
                            d.items[i].sets.splice(j, 1)
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
                                if (prev.load !== undefined) set.load = prev.load
                                set.reps = prev.reps
                                return d
                              })
                            }
                            className="order-last basis-full text-left text-caption text-ink3 hover:text-ink2"
                            aria-label={`Previous: ${item.previous[j].load !== undefined ? `${item.previous[j].load} ${item.unit} × ` : ''}${countWord(ex, item.previous[j].reps)} — tap to use`}
                          >
                            Previous: {item.previous[j].load !== undefined ? `${item.previous[j].load} ${item.unit} × ` : ''}
                            {countUnit(ex) === 'seconds' ? countWord(ex, item.previous[j].reps) : item.previous[j].reps}
                            {item.previous[j].rpe !== undefined ? ` @${item.previous[j].rpe}` : ''} · tap to use
                          </button>
                        ) : null}
                        {ex.load !== 'bodyweight' || addedLoad || s.load !== undefined ? (
                          <Stepper
                            value={s.load ?? 0}
                            unit={item.unit}
                            step={stepDisplay || 1}
                            label={`${ex.name}, set ${j + 1} ${ex.assisted ? 'assistance' : addedLoad ? 'added load' : 'load'}`}
                            onChange={(v) =>
                              update((d) => {
                                const sets = d.items[i].sets
                                const was = sets[j].load
                                sets[j].load = v
                                // Later sets not yet done follow the new load
                                // unless they were given their own.
                                for (let k = j + 1; k < sets.length; k++) {
                                  if (!sets[k].done && (sets[k].load === undefined || sets[k].load === 0 || sets[k].load === was)) sets[k].load = v
                                }
                                return d
                              })
                            }
                          />
                        ) : (
                          <span className="flex-1 text-center text-footnote text-ink3">{unloadedLabel(ex)}</span>
                        )}
                        <Stepper
                          value={s.reps}
                          unit={countUnit(ex) === 'seconds' ? 'sec' : 'reps'}
                          step={countUnit(ex) === 'seconds' ? 5 : 1}
                          label={`${ex.name}, set ${j + 1} ${countUnit(ex) === 'seconds' ? 'seconds' : 'reps'}`}
                          onChange={(v) =>
                            update((d) => {
                              d.items[i].sets[j].reps = Math.max(0, Math.round(v))
                              return d
                            })
                          }
                        />
                        <button
                          onClick={() => completeSet(i, j)}
                          aria-pressed={s.done}
                          aria-label={s.done ? `Set ${j + 1} done — tap to undo` : `Complete set ${j + 1}`}
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
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-1 sm:pl-8" role="group" aria-label="How hard was that set?">
                          <span className="mr-1 text-caption text-ink3">Effort</span>
                          {RPE_CHOICES.map((r) => (
                            <button
                              key={r}
                              onClick={() => {
                                update((d) => {
                                  d.items[i].sets[j].rpe = r
                                  delete d.effortFor
                                  return d
                                })
                              }}
                              className="h-11 min-w-11 rounded-lg border border-line bg-surface px-2 text-body font-semibold ds-press"
                            >
                              {r}
                            </button>
                          ))}
                          <button onClick={() => setDraft((d) => ({ ...d, effortFor: undefined }))} className="h-11 px-2 text-caption text-ink3">
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
            <Button variant="secondary" aria-label="15 seconds more" onClick={() => setDraft((d) => d.rest ? { ...d, rest: { until: d.rest.until + 15_000, total: d.rest.total + 15 } } : d)}>
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
              {asksAssistance ? 'Enter the help shown on the machine, or confirm you did the set without help.' :
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
                  {asksAssistance ? 'Log with no assistance' : 'Log as bodyweight'}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet open={!!doubt} onClose={() => setDoubt(null)} label="Check this load">
        {doubt && draft.items[doubt.item] ? (
          <div className="space-y-3">
            <h2 className="text-title3 font-semibold">Is {draft.items[doubt.item].sets[doubt.set].load} {draft.items[doubt.item].unit} right?</h2>
            <p className="text-footnote text-ink2">
              That is well above your best on {GYM_EXERCISE_BY_ID[draft.items[doubt.item].exerciseId]?.name.toLowerCase()} ({doubt.best}{' '}
              {draft.items[doubt.item].unit}). A typo here would set your records and your next loads, so it is worth a check.
            </p>
            <div className="grid gap-2">
              {doubt.probably !== undefined ? (
                <Button
                  size="lg"
                  onClick={() => {
                    const { item, set, probably } = doubt
                    update((d) => {
                      d.items[item].sets[set].load = probably
                      return d
                    })
                    setDoubt(null)
                    completeSet(item, set, true)
                  }}
                >
                  I meant {doubt.probably} {draft.items[doubt.item].unit}
                </Button>
              ) : null}
              <Button
                size="lg"
                variant={doubt.probably !== undefined ? 'secondary' : 'primary'}
                onClick={() => {
                  const { item, set } = doubt
                  setDoubt(null)
                  completeSet(item, set, true)
                }}
              >
                Yes, {draft.items[doubt.item].sets[doubt.set].load} {draft.items[doubt.item].unit} is right
              </Button>
              <Button variant="ghost" onClick={() => setDoubt(null)}>
                Let me change it
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet open={!!sheet} onClose={() => setSheet(null)} label="Exercise options">
        <div>
              {sh?.kind === 'menu' && sh.item !== undefined && draft.items[sh.item] ? (
                <MenuSheet
                  exercise={GYM_EXERCISE_BY_ID[draft.items[sh.item].exerciseId]}
                  rating={rating(draft.items[sh.item].exerciseId)}
                  hardHere={location.hardHere?.includes(draft.items[sh.item].exerciseId) ?? false}
                  favoriteHere={gym.favoriteAt[draft.items[sh.item].exerciseId] === location.id}
                  locationName={location.name}
                  onRate={(r) => dispatch({ type: 'GYM', op: { op: 'rate', exerciseId: draft.items[sh.item!].exerciseId, rating: r } })}
                  onHard={() => dispatch({ type: 'GYM', op: { op: 'toggleHardHere', locationId: location.id, exerciseId: draft.items[sh.item!].exerciseId } })}
                  onFavorite={(on) =>
                    dispatch({ type: 'GYM', op: { op: 'setFavorite', exerciseId: draft.items[sh.item!].exerciseId, locationId: on ? location.id : null } })
                  }
                  onSwap={() => setSheet({ kind: 'swap', item: sh.item })}
                  onRemove={() => {
                    update((d) => {
                      d.items.splice(sh.item!, 1)
                      return d
                    })
                    setSheet(null)
                  }}
                />
              ) : null}
              {sh?.kind === 'swap' && sh.item !== undefined && draft.items[sh.item] ? (
                <SwapList
                  name={GYM_EXERCISE_BY_ID[draft.items[sh.item].exerciseId].name}
                  locationName={location.name}
                  all={alternativesFor(draft.items[sh.item].exerciseId, location, gym.ratings, draft.items.map((d) => d.exerciseId), {
                    youth,
                    capacity: bodyweightCapacity(state, Date.now()),
                    sessions: gym.sessions,
                    now: Date.now(),
                  })}
                  fitsToday={fitsToday}
                  keptOut={[
                    ...(draft.avoidJoints?.length ? [`load your ${joinWords(draft.avoidJoints.map((j) => j.replace('-', ' ')))}`] : []),
                    ...(draft.musclesOff?.length ? ['work a muscle switched off'] : []),
                  ]}
                  onRemove={() => {
                    update((d) => {
                      d.items.splice(sh.item!, 1)
                      return d
                    })
                    setSheet(null)
                  }}
                  onBack={() => setSheet(null)}
                >
                  {(alts) =>
                    alts.map((alt) => (
                        <li key={alt.id}>
                          <button
                            onClick={() => swapTo(sh.item!, alt.id)}
                            className="flex min-h-12 w-full items-center justify-between rounded-control border border-line px-3 text-left"
                          >
                            <span className="text-body font-medium">{alt.name}</span>
                            <span className="text-caption text-ink3">
                              {gym.ratings[alt.id] === 'love' ? 'Favourite · ' : ''}
                              {PATTERN_LABEL[alt.pattern]}
                            </span>
                          </button>
                        </li>
                      ))
                  }
                </SwapList>
              ) : null}
              {sh?.kind === 'add' ? (
                <>
                  <h2 className="text-title3 font-semibold">Add an exercise</h2>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search"
                    className="mt-3 min-h-11 w-full rounded-control border border-line bg-raised px-3 text-body"
                    aria-label="Search exercises"
                  />
                  <ul className="mt-3 space-y-2">
                    {availableAt(location)
                      .filter((e) => gym.ratings[e.id] !== 'avoid')
                      .filter(fitsToday)
                      .filter((e) => plyoGate(e, gym.sessions, youth, Date.now()).allowed)
                      .filter((e) => !query || e.name.toLowerCase().includes(query.toLowerCase()) || PATTERN_LABEL[e.pattern].toLowerCase().includes(query.toLowerCase()))
                      .slice(0, 40)
                      .map((e) => (
                        <li key={e.id}>
                          <button
                            onClick={() => addExercise(e.id)}
                            className="flex min-h-12 w-full items-center justify-between rounded-control border border-line px-3 text-left"
                          >
                            <span className="text-body font-medium">{e.name}</span>
                            <span className="text-caption text-ink3">{PATTERN_LABEL[e.pattern]}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                </>
              ) : null}
        </div>
      </Sheet>

      <Sheet open={finishing} onClose={() => setFinishing(false)} title="Finish this session?">
        <p className="text-body text-ink2">{stale ? 'The original workout changed. Save the new sets as a separate workout, or discard this continuation.' : 'Finished sets go into your workout history. You can return to unfinished sets from Home today.'}</p>
        {unfinishedLine(draft) ? (
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
            <div className="text-footnote font-semibold text-accent-text">New estimated max</div>
            <ul className="mt-2 space-y-1.5">
              {summary.maxes.map((m) => (
                <li key={m.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-body text-ink">{m.name}</span>
                  <span className="shrink-0 font-display text-title3 font-semibold text-ink">
                    <CountUp value={m.value} decimals={Number.isInteger(m.value) ? 0 : 1} />
                    <span className="ml-1 text-footnote font-normal text-ink3">{m.unit}</span>
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
          <Button variant="secondary" full onClick={() => setFinishing(false)}>
            Keep training
          </Button>
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
  unit,
  step,
  label,
  onChange,
}: {
  value: number
  unit: string
  step: number
  label: string
  onChange: (v: number) => void
}) {
  const [typed, setTyped] = useState<string | null>(null)
  const isCount = unit === 'reps' || unit === 'sec'
  const nudge = (by: number) => onChange(Math.max(0, Number((value + by).toFixed(3))))
  return (
    <div className="flex flex-1 items-center justify-center gap-1" role="group" aria-label={label}>
      <button
        onClick={() => nudge(-step)}
        className="ds-press flex h-11 w-11 items-center justify-center rounded-control text-ink2 hover:bg-surface"
        aria-label={`Less ${unit}, ${label}`}
      >
        <Icon name="minus" />
      </button>
      <input
        inputMode={isCount ? 'numeric' : 'decimal'}
        value={typed ?? String(value)}
        onFocus={(e) => {
          setTyped(String(value))
          e.target.select()
        }}
        onBlur={() => setTyped(null)}
        onChange={(e) => {
          const raw = e.target.value
          if (!(isCount ? /^\d*$/ : /^\d*(?:[.,]\d{0,3})?$/).test(raw)) return
          const v = Number(raw.replace(',', '.'))
          if (v >= 1000) return
          setTyped(raw)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="h-11 w-14 rounded-lg bg-surface text-center text-title3 font-semibold tnum"
        aria-label={label}
      />
      <button
        onClick={() => nudge(step)}
        disabled={value + step >= 1000}
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
  rating,
  hardHere,
  favoriteHere,
  locationName,
  onRate,
  onHard,
  onFavorite,
  onSwap,
  onRemove,
}: {
  exercise: GymExercise
  rating?: Rating
  hardHere: boolean
  favoriteHere: boolean
  locationName: string
  onRate: (r: Rating | null) => void
  onHard: () => void
  onFavorite: (on: boolean) => void
  onSwap: () => void
  onRemove: () => void
}) {
  const choice = (r: Rating, label: string) => (
    <button
      onClick={() => onRate(rating === r ? null : r)}
      aria-pressed={rating === r}
      className={`min-h-11 flex-1 rounded-control border text-body font-medium ${rating === r ? 'border-transparent bg-accent text-on-accent' : 'border-line'}`}
    >
      {label}
    </button>
  )
  return (
    <>
      <h2 className="text-title3 font-semibold">{exercise.name}</h2>
      <div className="mt-2"><GymExerciseGuide exercise={exercise} /></div>
      <p className="mt-3 text-caption font-medium text-ink3">How do you like it? The planner picks favourites and leaves out avoided ones.</p>
      <div className="mt-2 flex gap-2">
        {choice('love', 'Love')}
        {choice('fine', 'Fine')}
        {choice('avoid', 'Avoid')}
      </div>
      <div className="mt-3 grid gap-2">
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


function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** Swaps that fit today, or — when none do — why, and what to do instead. */
function SwapList({
  name,
  locationName,
  all,
  fitsToday,
  keptOut,
  onRemove,
  onBack,
  children,
}: {
  name: string
  locationName: string
  all: GymExercise[]
  fitsToday: (e: GymExercise) => boolean
  keptOut: string[]
  onRemove: () => void
  onBack: () => void
  children: (alts: GymExercise[]) => ReactNode
}) {
  const alts = all.filter(fitsToday).slice(0, 10)
  return (
    <>
      <h2 className="text-title3 font-semibold">Swap {name}</h2>
      {alts.length ? (
        <>
          <p className="mt-1 text-footnote text-ink3">Same movement first, then the same muscles — everything here can be done at {locationName}.</p>
          <ul className="mt-3 space-y-2">{children(alts)}</ul>
        </>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-footnote text-ink2">
            {all.length && keptOut.length
              ? `Nothing else here fits today: the other options ${joinWords(keptOut)}, which today’s plan keeps out.`
              : `Nothing else at ${locationName} does this job. Adding equipment to ${locationName} opens more swaps.`}{' '}
            You can leave it out of today instead.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onRemove}>
              Leave it out today
            </Button>
            <Button variant="ghost" onClick={onBack}>
              Keep it
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
