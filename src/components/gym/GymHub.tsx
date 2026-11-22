import { useEffect, useMemo, useState } from 'react'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import { buildGymSession, FOCUS_LABEL, nextFocus, type GymFocus, type PlannedExercise } from '../../lib/gym/builder'
import type { Joint } from '../../data/gym/catalog'
import type { BodyRegion } from '../../types'
import { activeLocation, conservative, loadDraft, prefillReps, previousSets, type GymDraft } from '../../lib/gym/draft'
import { gymRecords, lastPerformance } from '../../lib/gym/progression'
import { defaultGym, newGymSessionId, newLocation } from '../../lib/gym/state'
import { displayLoad, formatLoad, unitFor } from '../../lib/gym/units'
import { Icon } from '../Icon'
import { Button, Card, CardTitle, EmptyState, Sheet, ToggleChip } from '../ds'
import { GymPlayer } from './GymPlayer'
import { WeekVolume } from '../plan/WeekVolume'
import type { GymPreset } from '../plan/TodayPlanCard'
import { LocationEditor } from './LocationEditor'
import { ExerciseHistory } from './ExerciseHistory'

const MINUTES = [20, 30, 45, 60, 75, 90]
const FOCI: (GymFocus | 'auto')[] = ['auto', 'full', 'upper', 'lower', 'push', 'pull', 'athletic']

function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export function GymHub({ preset, onPresetUsed }: { preset?: GymPreset | null; onPresetUsed?: () => void } = {}) {
  const { state, dispatch } = useStore()
  const gym = state.gym
  const youth = conservative(state.profile)
  const [minutes, setMinutes] = useState(45)
  const [focus, setFocus] = useState<GymFocus | 'auto'>('auto')
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [historyOf, setHistoryOf] = useState<string | null>(null)
  const [running, setRunning] = useState<GymDraft | null>(null)
  const [resumable, setResumable] = useState<GymDraft | null>(() => loadDraft())
  const location = activeLocation(gym)

  const plan = useMemo(
    () =>
      gym && location
        ? buildGymSession({
            location,
            minutes,
            ...(focus === 'auto' ? {} : { focus }),
            sessions: gym.sessions,
            ratings: gym.ratings,
            youth,
            ...(gym.prefs ? { goals: gym.prefs.goals, priority: gym.prefs.musclesPriority, musclesOff: gym.prefs.musclesOff } : {}),
          })
        : null,
    [gym, location, minutes, focus, youth],
  )
  const records = useMemo(() => (gym ? gymRecords(gym.sessions) : {}), [gym])

  const [pending, setPending] = useState<{ empty: boolean; preset?: GymPreset } | null>(null)

  // A session planned on the Today card asks the pain check, then starts.
  useEffect(() => {
    if (!preset || !gym || !location) return
    onPresetUsed?.()
    setPending({ empty: false, preset })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  if (!gym || !location) {
    return (
      <Card>
        <EmptyState
          icon="dumbbell"
          title="Gym training"
          action="Set up my places"
          onAction={() => {
            dispatch({ type: 'GYM', op: { op: 'init', gym: defaultGym(state.profile.equipment) } })
            setEditing('home')
          }}
        >
          Log weights, reps and effort next to your skill work, and get sessions built from what each place has. Start
          with where you train — your calisthenics kit is already listed for Home.
        </EmptyState>
      </Card>
    )
  }

  const toDraftItem = (it: PlannedExercise) => {
    const ex = GYM_EXERCISE_BY_ID[it.exerciseId]
    const unit = unitFor(ex, location)
    const load = it.suggestion.kg !== undefined ? displayLoad(it.suggestion.kg, unit) : undefined
    return {
      exerciseId: it.exerciseId,
      plan: it.plan,
      suggestion: it.suggestion,
      restSec: it.restSec,
      unit,
      ...(() => {
        const previous = previousSets(gym.sessions, it.exerciseId, location.id, unit)
        return previous ? { previous } : {}
      })(),
      sets: Array.from({ length: it.sets }, (_, i) => ({
        ...(load !== undefined ? { load } : {}),
        reps: prefillReps(it.plan, it.suggestion, lastPerformance(gym.sessions, it.exerciseId, location.id)?.sets[i]?.reps),
        done: false,
      })),
    }
  }

  /** After the pain check: record what hurts, steer round it, and start. */
  const launch = (joints: Joint[], kind: 'none' | 'niggle' | 'pain') => {
    if (!pending) return
    // An open session is never overwritten by a new one: resume or discard it first.
    if (loadDraft()) {
      setPending(null)
      setResumable(loadDraft())
      pushToast('A gym session is still open — resume it or discard it first.', 'info')
      return
    }
    const regions = joints.map((j) => JOINT_REGION[j]).filter((r): r is BodyRegion => Boolean(r))
    if (kind !== 'none' && joints.length) {
      dispatch({ type: 'RECORD_SYMPTOM', event: { at: Date.now(), joints: kind, regions: regions.length ? regions : ['other'], source: 'check-in' } })
    }
    const p = pending.preset
    const avoidJoints = [...new Set([...(p?.avoidJoints ?? []), ...joints])]
    const musclesOff = p?.musclesOff ?? gym.prefs?.musclesOff ?? []
    const planned = pending.empty
      ? null
      : buildGymSession({
          location,
          minutes: p?.minutes ?? minutes,
          ...(p ? { focus: p.focus } : focus === 'auto' ? {} : { focus }),
          sessions: gym.sessions,
          ratings: gym.ratings,
          youth,
          avoidJoints,
          volumeFactor: Math.min(p?.volumeFactor ?? 1, kind === 'pain' ? 0.6 : 1),
          musclesOff,
          ...(gym.prefs ? { goals: gym.prefs.goals, priority: gym.prefs.musclesPriority } : {}),
        })
    setPending(null)
    setRunning({
      id: newGymSessionId(),
      startedAt: Date.now(),
      locationId: location.id,
      name: planned?.name ?? 'Gym session',
      items: (planned?.items ?? []).map(toDraftItem),
      ...(avoidJoints.length ? { avoidJoints } : {}),
      ...(musclesOff.length ? { musclesOff } : {}),
    })
  }

  const editingLocation =
    editing === 'new' ? newLocation('New gym', location.unit) : gym.locations.find((l) => l.id === editing) ?? null
  const recent = [...gym.sessions].reverse().slice(0, 5)
  const topRecords = Object.values(records)
    .filter((r) => r.bestE1rm)
    .sort((a, b) => b.bestE1rm!.kg - a.bestE1rm!.kg)
    .slice(0, 6)
  const autoFocus = nextFocus(gym.sessions)

  return (
    <div className="space-y-5">
      {resumable && !running ? (
        <Card tone="accent">
          <p className="text-body font-semibold">A gym session is still open</p>
          <p className="mt-1 text-footnote text-ink2">
            {resumable.name}, started {dayLabel(resumable.startedAt)} — nothing logged in it was lost.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              className="flex-1"
              onClick={() => {
                setRunning(resumable)
                setResumable(null)
              }}
            >
              Resume
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setResumable(null)
                try {
                  localStorage.removeItem('planchelab.gymDraft')
                } catch {
                  // Nothing to clear.
                }
              }}
            >
              Discard
            </Button>
          </div>
        </Card>
      ) : null}

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-footnote font-semibold uppercase tracking-wide text-ink3">Where are you training?</h2>
          <button onClick={() => setEditing(location.id)} className="min-h-11 px-2 text-footnote font-medium text-accent-text">
            Edit {location.name}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {gym.locations.map((l) => (
            <ToggleChip
              key={l.id}
              active={l.id === location.id}
              onClick={() => dispatch({ type: 'GYM', op: { op: 'setActiveLocation', id: l.id } })}
            >
              {l.name}
            </ToggleChip>
          ))}
          <button
            onClick={() => setEditing('new')}
            className="ds-press inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-line-strong px-4 text-footnote font-medium text-ink2"
          >
            <Icon name="plus" size={14} />
            Add a place
          </button>
        </div>
      </section>

      <Card>
        <CardTitle>Today’s gym session</CardTitle>
        <p className="-mt-2 text-footnote text-ink3">Built from what {location.name} has, your likes and your last sessions.</p>
        <p className="mt-3 text-caption font-medium text-ink3">Time</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {MINUTES.map((m) => (
            <ToggleChip key={m} active={minutes === m} onClick={() => setMinutes(m)}>
              {m} min
            </ToggleChip>
          ))}
        </div>
        <p className="mt-3 text-caption font-medium text-ink3">Focus</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {FOCI.map((f) => (
            <ToggleChip key={f} active={focus === f} onClick={() => setFocus(f)}>
              {f === 'auto' ? `Auto (${FOCUS_LABEL[autoFocus]})` : FOCUS_LABEL[f]}
            </ToggleChip>
          ))}
        </div>
        {plan && plan.items.length ? (
          <ol className="mt-4 divide-y divide-line">
            {plan.items.map((it) => {
              const ex = GYM_EXERCISE_BY_ID[it.exerciseId]
              return (
                <li key={it.exerciseId} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-body font-medium">{ex.name}</span>
                    <span className="block text-caption text-ink3">{it.suggestion.why}</span>
                  </span>
                  <span className="shrink-0 text-right text-footnote tnum text-ink2">
                    {it.sets} × {it.plan.range[0]}–{it.plan.range[1]}
                    <br />
                    {it.suggestion.kg !== undefined ? formatLoad(it.suggestion.kg, unitFor(ex, location)) : ex.load === 'bodyweight' ? 'Bodyweight' : 'Pick a weight'}
                  </span>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="mt-4 rounded-control bg-raised p-3 text-footnote text-ink2">
            Nothing to program for this focus with what {location.name} has. Add equipment, pick another focus, or start an
            empty session.
          </p>
        )}
        {plan?.dropped.length ? (
          <p className="mt-2 text-caption text-ink3">Left out to fit {minutes} minutes: {plan.dropped.join(', ')}.</p>
        ) : null}
        {plan && plan.items.length ? <p className="mt-1 text-caption text-ink3">About {plan.estimatedMin} minutes with warm-up and rests.</p> : null}
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <Button size="lg" disabled={!plan?.items.length || Boolean(resumable)} onClick={() => setPending({ empty: false })}>
            Start session
          </Button>
          <Button size="lg" variant="secondary" disabled={Boolean(resumable)} onClick={() => setPending({ empty: true })}>
            Empty
          </Button>
        </div>
        {youth ? (
          <p className="mt-3 text-caption leading-relaxed text-ink3">
            Careful mode (under 18, or no age set): rep ranges stay at 6 or more, loads go up one step at a time, and lifts
            that need coaching are not picked unless you mark them a favourite.
          </p>
        ) : null}
      </Card>

      <section>
        <h2 className="text-footnote font-semibold uppercase tracking-wide text-ink3">Recent</h2>
        {recent.length ? (
          <ul className="mt-2 space-y-2">
            {recent.map((s) => {
              const sets = s.exercises.reduce((n, e) => n + e.sets.filter((x) => !x.warmup).length, 0)
              const place = gym.locations.find((l) => l.id === s.locationId)?.name ?? 'A deleted place'
              return (
                <li key={s.id} className="rounded-card border border-line bg-surface p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-body font-semibold">{s.name}</span>
                    <span className="text-caption text-ink3">{dayLabel(s.startedAt)}</span>
                  </div>
                  <p className="mt-0.5 text-footnote text-ink2">
                    {place} · {s.exercises.length} {s.exercises.length === 1 ? 'exercise' : 'exercises'} · {sets} {sets === 1 ? 'set' : 'sets'}
                    {s.completion === 'partial' ? ' · ended early' : ''}
                  </p>
                </li>
              )
            })}
          </ul>
        ) : (
          <Card className="mt-2 border-dashed">
            <EmptyState icon="calendar" title="No gym sessions yet">
              Your first one sets the starting weights for the next.
            </EmptyState>
          </Card>
        )}
      </section>

      {topRecords.length ? (
        <section>
          <h2 className="text-footnote font-semibold uppercase tracking-wide text-ink3">Estimated maxes</h2>
          <p className="mt-1 text-caption text-ink3">From your best set of 12 reps or fewer, adjusted for effort — an estimate, never a test.</p>
          <ul className="mt-2 grid grid-cols-2 gap-2">
            {topRecords.map((r) => {
              const ex = GYM_EXERCISE_BY_ID[r.exerciseId]
              return (
                <li key={r.exerciseId}>
                  <button
                    onClick={() => setHistoryOf(r.exerciseId)}
                    className="ds-press w-full rounded-card border border-line bg-surface p-4 text-left"
                    aria-label={`${ex?.name}: estimated max ${formatLoad(r.bestE1rm!.kg, ex ? unitFor(ex, location) : location.unit)} — open its history`}
                  >
                    <p className="truncate text-footnote text-ink3">{ex?.name}</p>
                    <p className="mt-0.5 font-display text-title1 font-semibold tnum">{formatLoad(r.bestE1rm!.kg, ex ? unitFor(ex, location) : location.unit)}</p>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      <WeekVolume />

      <Sheet open={historyOf !== null} onClose={() => setHistoryOf(null)} label="Exercise history">
        {historyOf ? <ExerciseHistory exerciseId={historyOf} /> : null}
      </Sheet>

      <Sheet open={pending !== null} onClose={() => setPending(null)} label="Before you start">
        {pending ? <PainCheck onAnswer={launch} /> : null}
      </Sheet>

      <Sheet open={editingLocation !== null} onClose={() => setEditing(null)} label={editing === 'new' ? 'Add a place' : 'Edit place'}>
        {editingLocation ? (
          <LocationEditor
            location={editingLocation}
            canDelete={editing !== 'new' && gym.locations.length > 1}
            onSave={(l) => {
              dispatch({ type: 'GYM', op: { op: 'saveLocation', location: l } })
              dispatch({ type: 'GYM', op: { op: 'setActiveLocation', id: l.id } })
              setEditing(null)
            }}
            onDelete={() => {
              dispatch({ type: 'GYM', op: { op: 'deleteLocation', id: editingLocation.id } })
              setEditing(null)
            }}
          />
        ) : null}
      </Sheet>

      {running ? (
        <GymPlayer
          draft={running}
          location={gym.locations.find((l) => l.id === running.locationId) ?? location}
          onClose={() => setRunning(null)}
        />
      ) : null}
    </div>
  )
}

const JOINT_REGION: Partial<Record<Joint, BodyRegion>> = {
  wrists: 'wrist',
  elbows: 'elbow',
  shoulders: 'shoulder',
  'lower-back': 'lower-back',
  knees: 'knee',
}
const CHECK_JOINTS: { id: Joint; label: string }[] = [
  { id: 'wrists', label: 'Wrists' },
  { id: 'elbows', label: 'Elbows' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'lower-back', label: 'Lower back' },
  { id: 'knees', label: 'Knees' },
]

/** One tap before the gym: anything hurting? The answer steers today and is kept for the coach. */
function PainCheck({ onAnswer }: { onAnswer: (joints: Joint[], kind: 'none' | 'niggle' | 'pain') => void }) {
  const [picked, setPicked] = useState<Joint[]>([])
  return (
    <div className="space-y-4">
      <h2 className="font-display text-title2 font-semibold">Anything hurting today?</h2>
      <div className="flex flex-wrap gap-2">
        {CHECK_JOINTS.map((j) => {
          const on = picked.includes(j.id)
          return (
            <ToggleChip key={j.id} active={on} onClick={() => setPicked(on ? picked.filter((x) => x !== j.id) : [...picked, j.id])}>
              {j.label}
            </ToggleChip>
          )
        })}
      </div>
      {picked.length ? (
        <div className="grid gap-2">
          <Button size="lg" variant="secondary" full onClick={() => onAnswer(picked, 'niggle')}>
            Just a niggle — work around it
          </Button>
          <Button size="lg" full onClick={() => onAnswer(picked, 'pain')}>
            It hurts — keep off it and go light
          </Button>
          <p className="text-caption leading-relaxed text-ink3">
            Nothing that loads {picked.length > 1 ? 'those areas' : 'that area'} goes in today. Never train through pain; if it keeps
            coming back, tell a parent, coach or physio.
          </p>
        </div>
      ) : (
        <Button size="lg" full onClick={() => onAnswer([], 'none')}>
          Nothing hurts — start
        </Button>
      )}
    </div>
  )
}
