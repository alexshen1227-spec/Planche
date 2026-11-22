import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GYM_EXERCISE_BY_ID, type GymExercise } from '../../data/gym/exercises'
import { PATTERN_LABEL } from '../../data/gym/catalog'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import { primeSignal, releaseSignal, signalTone } from '../../lib/audio'
import { alternativesFor, availableAt } from '../../lib/gym/availability'
import { restFor } from '../../lib/gym/builder'
import { conservative, saveDraft, sessionFromDraft, type DraftItem, type GymDraft } from '../../lib/gym/draft'
import { gymRecords, lastPerformance, repPlanFor, suggestLoad } from '../../lib/gym/progression'
import type { GymLocation, Rating } from '../../lib/gym/types'
import { displayLoad, formatLoad, stepKgFor, unitFor } from '../../lib/gym/units'
import { Icon } from '../Icon'

const RPE_CHOICES = [6, 7, 8, 9, 10]

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Not every browser lets a page vibrate; the set is logged either way.
  }
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
): DraftItem {
  const plan = repPlanFor(exercise, 'muscle', youth)
  const suggestion = suggestLoad({ exerciseId: exercise.id, location, sessions, plan, youth })
  const unit = unitFor(exercise, location)
  const last = lastPerformance(sessions, exercise.id, location.id)
  const load = suggestion.kg !== undefined ? displayLoad(suggestion.kg, unit) : undefined
  return {
    exerciseId: exercise.id,
    plan,
    suggestion,
    restSec: restFor(exercise, plan),
    unit,
    sets: Array.from({ length: sets }, (_, i) => ({
      ...(load !== undefined ? { load } : {}),
      reps: last?.sets[i]?.reps && suggestion.kind === 'repeat' ? Math.min(plan.range[1], last.sets[i].reps + 1) : plan.range[1],
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
  const [draft, setDraft] = useState<GymDraft>(initial)
  const [now, setNow] = useState(() => Date.now())
  const [rest, setRest] = useState<{ until: number; total: number } | null>(null)
  const [askRpe, setAskRpe] = useState<{ item: number; set: number } | null>(null)
  const [sheet, setSheet] = useState<{ kind: 'swap' | 'add' | 'menu'; item?: number } | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [query, setQuery] = useState('')
  const restEndedRef = useRef(false)

  // Every change is mirrored, so a closed tab or a crash resumes here.
  useEffect(() => saveDraft(draft), [draft])
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => {
      window.clearInterval(id)
      releaseSignal()
    }
  }, [])
  useEffect(() => {
    if (!rest || now < rest.until || restEndedRef.current) return
    restEndedRef.current = true
    buzz([120, 80, 120])
    signalTone()
    setRest(null)
  }, [now, rest])

  const update = (fn: (d: GymDraft) => GymDraft) => setDraft((d) => fn(structuredClone(d)))
  const records = useMemo(() => gymRecords(gym.sessions), [gym.sessions])

  const completeSet = (i: number, j: number) => {
    primeSignal()
    const wasDone = draft.items[i].sets[j].done
    update((d) => {
      const s = d.items[i].sets[j]
      s.done = !s.done
      s.at = Date.now()
      return d
    })
    if (wasDone) return
    buzz(25)
    setAskRpe({ item: i, set: j })
    const secs = draft.items[i].restSec
    restEndedRef.current = false
    setRest({ until: Date.now() + secs * 1000, total: secs })
  }

  const swapTo = (i: number, exerciseId: string) => {
    const ex = GYM_EXERCISE_BY_ID[exerciseId]
    update((d) => {
      const old = d.items[i]
      const fresh = draftItemFor(ex, location, gym.sessions, youth, old.sets.length)
      d.items[i] = { ...fresh, swappedFrom: old.swappedFrom ?? old.exerciseId }
      return d
    })
    setSheet(null)
    pushToast(`Swapped to ${ex.name}.`, 'info')
  }

  const addExercise = (exerciseId: string) => {
    update((d) => {
      d.items.push(draftItemFor(GYM_EXERCISE_BY_ID[exerciseId], location, gym.sessions, youth))
      return d
    })
    setSheet(null)
    setQuery('')
  }

  const save = () => {
    const session = sessionFromDraft(draft, Date.now())
    if (!session.exercises.length) {
      saveDraft(null)
      onClose()
      return
    }
    dispatch({ type: 'GYM', op: { op: 'saveSession', session } })
    saveDraft(null)
    const after = gymRecords([...gym.sessions, session])
    const prs = Object.values(after).filter((r) => {
      const before = records[r.exerciseId]?.bestE1rm?.kg ?? 0
      return (r.bestE1rm?.kg ?? 0) > before + 0.01 && before > 0
    }).length
    pushToast(prs ? `Saved — ${prs} new estimated max${prs > 1 ? 'es' : ''}.` : 'Gym session saved.', 'success')
    onClose()
  }

  const discard = () => {
    saveDraft(null)
    onClose()
  }

  const doneSets = draft.items.reduce((n, it) => n + it.sets.filter((s) => s.done).length, 0)
  const plannedSets = draft.items.reduce((n, it) => n + it.sets.length, 0)
  const elapsed = (now - draft.startedAt) / 1000
  const restLeft = rest ? (rest.until - now) / 1000 : 0
  const rating = (id: string): Rating | undefined => gym.ratings[id]

  const body = (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg text-ink" role="dialog" aria-label="Gym session">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold">{draft.name}</p>
          <p className="text-[12px] text-ink3">
            {location.name} · {mmss(elapsed)} · {doneSets}/{plannedSets} sets
          </p>
        </div>
        <button
          onClick={() => setFinishing(true)}
          className="min-h-11 rounded-xl bg-accent px-4 text-[15px] font-semibold text-on-accent active:scale-[0.97]"
        >
          Finish
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-40 pt-3">
        <div className="mx-auto max-w-xl space-y-4">
          {draft.items.map((item, i) => {
            const ex = GYM_EXERCISE_BY_ID[item.exerciseId]
            const step = stepKgFor(ex, location)
            const stepDisplay = step > 0 ? Math.max(0.5, displayLoad(step, item.unit)) : 0
            const best = records[item.exerciseId]?.bestE1rm
            return (
              <section key={`${item.exerciseId}-${i}`} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[16px] font-semibold leading-tight">
                      {ex.name}
                      {rating(ex.id) === 'love' ? <span className="ml-2 text-[12px] font-medium text-accent-text">Favourite</span> : null}
                    </h3>
                    <p className="mt-0.5 text-[13px] text-ink2">
                      {item.sets.length} × {item.plan.range[0]}–{item.plan.range[1]} reps · stop about RPE {item.plan.targetRpe}
                      {best ? ` · est. max ${formatLoad(best.kg, item.unit)}` : ''}
                    </p>
                    {item.suggestion ? <p className="mt-1 text-[12px] text-ink3">{item.suggestion.why}</p> : null}
                    {item.swappedFrom ? (
                      <p className="mt-1 text-[12px] text-ink3">In place of {GYM_EXERCISE_BY_ID[item.swappedFrom]?.name}.</p>
                    ) : null}
                  </div>
                  <button
                    onClick={() => setSheet({ kind: 'menu', item: i })}
                    className="min-h-11 rounded-xl border border-line px-3 text-[13px] font-medium text-ink2"
                    aria-label={`Options for ${ex.name}`}
                  >
                    More
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {item.sets.map((s, j) => (
                    <div key={j}>
                      <div
                        className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${s.done ? 'bg-ok-soft' : 'bg-raised'}`}
                      >
                        <span className="w-6 text-center text-[13px] font-semibold text-ink3">{s.warmup ? 'W' : j + 1}</span>
                        {ex.load !== 'bodyweight' || s.load !== undefined ? (
                          <Stepper
                            value={s.load ?? 0}
                            unit={item.unit}
                            step={stepDisplay || 1}
                            label={`Set ${j + 1} load`}
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
                          <span className="flex-1 text-center text-[13px] text-ink3">Bodyweight</span>
                        )}
                        <Stepper
                          value={s.reps}
                          unit="reps"
                          step={1}
                          label={`Set ${j + 1} reps`}
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
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition active:scale-90 ${
                            s.done ? 'bg-ok text-white' : 'border border-line-strong bg-surface text-ink3'
                          }`}
                        >
                          <Icon name="check" />
                        </button>
                      </div>
                      {s.done && s.rpe !== undefined ? (
                        <p className="mt-0.5 pl-9 text-[11px] text-ink3">RPE {s.rpe}</p>
                      ) : null}
                      {askRpe && askRpe.item === i && askRpe.set === j ? (
                        <div className="mt-1.5 flex items-center gap-1.5 pl-8" role="group" aria-label="How hard was that set?">
                          <span className="mr-1 text-[12px] text-ink3">Effort</span>
                          {RPE_CHOICES.map((r) => (
                            <button
                              key={r}
                              onClick={() => {
                                update((d) => {
                                  d.items[i].sets[j].rpe = r
                                  return d
                                })
                                setAskRpe(null)
                              }}
                              className="h-10 min-w-10 rounded-lg border border-line bg-surface px-2 text-[14px] font-semibold active:scale-95"
                            >
                              {r}
                            </button>
                          ))}
                          <button onClick={() => setAskRpe(null)} className="h-10 px-2 text-[12px] text-ink3">
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
                        d.items[i].sets.push({ ...(last?.load !== undefined ? { load: last.load } : {}), reps: last?.reps ?? item.plan.range[1], done: false })
                        return d
                      })
                    }
                    className="min-h-11 flex-1 rounded-xl border border-dashed border-line-strong text-[13px] font-medium text-ink2"
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
                      className="min-h-11 rounded-xl border border-line px-3 text-[13px] text-ink3"
                    >
                      Remove set
                    </button>
                  ) : null}
                </div>
              </section>
            )
          })}
          <button
            onClick={() => setSheet({ kind: 'add' })}
            className="min-h-12 w-full rounded-2xl border border-dashed border-line-strong text-[14px] font-medium text-ink2"
          >
            Add an exercise
          </button>
        </div>
      </main>

      {rest ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-ink3">Rest</p>
              <p className="text-[28px] font-semibold tabular-nums leading-none">{mmss(restLeft)}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500 ease-linear motion-reduce:transition-none"
                  style={{ width: `${Math.max(0, Math.min(100, (restLeft / rest.total) * 100))}%` }}
                />
              </div>
            </div>
            <button onClick={() => setRest((r) => (r ? { ...r, until: r.until - 15_000 } : r))} className="h-11 rounded-xl border border-line px-3 text-[14px] font-medium">
              −15
            </button>
            <button onClick={() => setRest((r) => (r ? { ...r, until: r.until + 15_000, total: r.total + 15 } : r))} className="h-11 rounded-xl border border-line px-3 text-[14px] font-medium">
              +15
            </button>
            <button onClick={() => setRest(null)} className="h-11 rounded-xl bg-raised px-3 text-[14px] font-medium">
              Skip
            </button>
          </div>
        </div>
      ) : null}

      {sheet ? (
        <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={() => setSheet(null)}>
          <div
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl bg-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto max-w-xl">
              {sheet.kind === 'menu' && sheet.item !== undefined ? (
                <MenuSheet
                  exercise={GYM_EXERCISE_BY_ID[draft.items[sheet.item].exerciseId]}
                  rating={rating(draft.items[sheet.item].exerciseId)}
                  hardHere={location.hardHere?.includes(draft.items[sheet.item].exerciseId) ?? false}
                  favoriteHere={gym.favoriteAt[draft.items[sheet.item].exerciseId] === location.id}
                  locationName={location.name}
                  onRate={(r) => dispatch({ type: 'GYM', op: { op: 'rate', exerciseId: draft.items[sheet.item!].exerciseId, rating: r } })}
                  onHard={() => dispatch({ type: 'GYM', op: { op: 'toggleHardHere', locationId: location.id, exerciseId: draft.items[sheet.item!].exerciseId } })}
                  onFavorite={(on) =>
                    dispatch({ type: 'GYM', op: { op: 'setFavorite', exerciseId: draft.items[sheet.item!].exerciseId, locationId: on ? location.id : null } })
                  }
                  onSwap={() => setSheet({ kind: 'swap', item: sheet.item })}
                  onRemove={() => {
                    update((d) => {
                      d.items.splice(sheet.item!, 1)
                      return d
                    })
                    setSheet(null)
                  }}
                />
              ) : null}
              {sheet.kind === 'swap' && sheet.item !== undefined ? (
                <>
                  <h2 className="text-[17px] font-semibold">Swap {GYM_EXERCISE_BY_ID[draft.items[sheet.item].exerciseId].name}</h2>
                  <p className="mt-1 text-[13px] text-ink3">Same movement first, then the same muscles — everything here can be done at {location.name}.</p>
                  <ul className="mt-3 space-y-2">
                    {alternativesFor(draft.items[sheet.item].exerciseId, location, gym.ratings, draft.items.map((d) => d.exerciseId))
                      .slice(0, 10)
                      .map((alt) => (
                        <li key={alt.id}>
                          <button
                            onClick={() => swapTo(sheet.item!, alt.id)}
                            className="flex min-h-12 w-full items-center justify-between rounded-xl border border-line px-3 text-left"
                          >
                            <span className="text-[15px] font-medium">{alt.name}</span>
                            <span className="text-[12px] text-ink3">
                              {gym.ratings[alt.id] === 'love' ? 'Favourite · ' : ''}
                              {PATTERN_LABEL[alt.pattern]}
                            </span>
                          </button>
                        </li>
                      ))}
                  </ul>
                </>
              ) : null}
              {sheet.kind === 'add' ? (
                <>
                  <h2 className="text-[17px] font-semibold">Add an exercise</h2>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search"
                    className="mt-3 min-h-11 w-full rounded-xl border border-line bg-raised px-3 text-[15px]"
                    aria-label="Search exercises"
                  />
                  <ul className="mt-3 space-y-2">
                    {availableAt(location)
                      .filter((e) => gym.ratings[e.id] !== 'avoid')
                      .filter((e) => !query || e.name.toLowerCase().includes(query.toLowerCase()) || PATTERN_LABEL[e.pattern].toLowerCase().includes(query.toLowerCase()))
                      .slice(0, 40)
                      .map((e) => (
                        <li key={e.id}>
                          <button
                            onClick={() => addExercise(e.id)}
                            className="flex min-h-12 w-full items-center justify-between rounded-xl border border-line px-3 text-left"
                          >
                            <span className="text-[15px] font-medium">{e.name}</span>
                            <span className="text-[12px] text-ink3">{PATTERN_LABEL[e.pattern]}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {finishing ? (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40 sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-t-3xl bg-surface p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:rounded-3xl">
            <h2 className="text-[19px] font-semibold">Finish this session?</h2>
            <p className="mt-1 text-[14px] text-ink2">
              {doneSets} of {plannedSets} sets done in {mmss(elapsed)}. Only finished sets are saved.
            </p>
            <div className="mt-4 grid gap-2">
              <button onClick={save} className="min-h-12 rounded-xl bg-accent text-[15px] font-semibold text-on-accent">
                {doneSets ? 'Save session' : 'Close — nothing to save'}
              </button>
              <button onClick={() => setFinishing(false)} className="min-h-12 rounded-xl border border-line text-[15px] font-medium">
                Keep training
              </button>
              <button onClick={discard} className="min-h-11 text-[14px] font-medium text-danger-text">
                Discard session
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1)
  return (
    <div className="flex flex-1 items-center justify-center gap-1" role="group" aria-label={label}>
      <button
        onClick={() => onChange(Math.max(0, Math.round((value - step) * 2) / 2))}
        className="flex h-11 w-10 items-center justify-center rounded-lg text-ink2 active:scale-90 active:bg-surface"
        aria-label={`Less ${unit}`}
      >
        <Icon name="minus" />
      </button>
      <input
        inputMode="decimal"
        value={shown}
        onChange={(e) => {
          const v = Number(e.target.value.replace(',', '.'))
          if (Number.isFinite(v) && v >= 0 && v < 1000) onChange(v)
        }}
        className="h-11 w-14 rounded-lg bg-surface text-center text-[17px] font-semibold tabular-nums"
        aria-label={label}
      />
      <button
        onClick={() => onChange(Math.round((value + step) * 2) / 2)}
        className="flex h-11 w-10 items-center justify-center rounded-lg text-ink2 active:scale-90 active:bg-surface"
        aria-label={`More ${unit}`}
      >
        <Icon name="plus" />
      </button>
      <span className="w-7 text-[11px] text-ink3">{unit}</span>
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
      className={`min-h-11 flex-1 rounded-xl border text-[14px] font-medium ${rating === r ? 'border-transparent bg-accent text-on-accent' : 'border-line'}`}
    >
      {label}
    </button>
  )
  return (
    <>
      <h2 className="text-[17px] font-semibold">{exercise.name}</h2>
      <p className="mt-1 text-[13px] text-ink2">{exercise.cue}</p>
      <p className="mt-3 text-[12px] font-medium text-ink3">How do you like it? The planner picks favourites and leaves out avoided ones.</p>
      <div className="mt-2 flex gap-2">
        {choice('love', 'Love')}
        {choice('fine', 'Fine')}
        {choice('avoid', 'Avoid')}
      </div>
      <div className="mt-3 grid gap-2">
        <button onClick={onSwap} className="min-h-12 rounded-xl border border-line text-[15px] font-medium">
          Swap — machine taken or not today
        </button>
        <button onClick={onHard} aria-pressed={hardHere} className="min-h-12 rounded-xl border border-line text-[15px] font-medium">
          {hardHere ? `Marked hard to do at ${locationName} — undo` : `Hard to do at ${locationName}`}
        </button>
        <button onClick={() => onFavorite(!favoriteHere)} aria-pressed={favoriteHere} className="min-h-12 rounded-xl border border-line text-[15px] font-medium">
          {favoriteHere ? `Your favourite place for this — undo` : `Favourite place for this: ${locationName}`}
        </button>
        <button onClick={onRemove} className="min-h-11 text-[14px] font-medium text-danger-text">
          Remove from today
        </button>
      </div>
    </>
  )
}

