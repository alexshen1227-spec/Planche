import { useEffect, useMemo, useRef, useState } from 'react'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import { buildGymSession, FOCUS_LABEL, type GymFocus, type PlannedExercise } from '../../lib/gym/builder'
import type { Joint } from '../../data/gym/catalog'
import type { BodyRegion } from '../../types'
import { draftConflictLine, draftContents, EXTRA_SESSION_LINE, leftOutLine, openDraftFor, resumeLine } from '../../lib/gym/sessionLines'
import { adaptOpenDraft, conservative, latestPartialToday, loadDraft, prefillReps, previousSets, resumePartial, type GymDraft } from '../../lib/gym/draft'
import { AFTER_OPENER_WARM_UP_MIN, gymToday, MIN_GYM_MINUTES, skillFamily, skillRequest, soreJoints } from '../../lib/plan/planner'
import { weekForChoice } from '../../lib/plan/currentWeek'
import { dayStage, gymPlaceLine, gymPreset, openerLine, resolveGymPlace, steerInput, type GymEntry, type GymPreset } from '../../lib/plan/screens'
import { usePlanClock } from '../../lib/plan/usePlanClock'
import { useDayMarks, useNextBlock } from '../../lib/plan/nextBlock'
import { useTodayChoice } from '../../lib/plan/todayChoice'
import { useToday } from '../../lib/useToday'
import type { AppState, SkillId, WorkoutRequest } from '../../types'
import { countUnit, FIRST_ESTIMATE_NOTE, gymRecords, isFirstEstimate, lastPerformance } from '../../lib/gym/progression'
import { defaultGym, newGymSessionId, newLocation } from '../../lib/gym/state'
import { entryLoad, formatLoad, unitFor } from '../../lib/gym/units'
import { Icon } from '../Icon'
import { Button, Card, CardTitle, EmptyState, Sheet, ToggleChip } from '../ds'
import { GymPlayer } from './GymPlayer'
import { PartialWorkout } from './PartialWorkout'
import { WeekVolume } from '../plan/WeekVolume'
import { LocationEditor } from './LocationEditor'
import { ExerciseHistory } from './ExerciseHistory'
import { bodyweightCapacity } from '../../lib/gym/bodyweight'
import { GymHistory } from './GymHistory'
import { GymExerciseGuide } from './ExerciseGuide'

const MINUTES = [20, 30, 45, 60, 75, 90]
const SKILL_NAME: Record<SkillId, string> = { planche: 'planche', frontlever: 'front lever', handstand: 'handstand', ninety: '90° hold', flag: 'human flag' }
const FOCI: (GymFocus | 'auto')[] = ['auto', 'full', 'upper', 'lower', 'push', 'pull', 'athletic']

function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export function GymHub({
  preset: entry,
  onPresetUsed,
  startWorkout,
}: { preset?: GymEntry | null; onPresetUsed?: () => void; startWorkout?: (request: WorkoutRequest) => void } = {}) {
  const { state, dispatch } = useStore()
  const gym = state.gym
  const preset = entry && !('resumeSessionId' in entry) ? entry : null
  const youth = conservative(state.profile)
  // Today as every screen plans it (today's choice included), keyed on the
  // calendar day so a screen left open past midnight plans the new day.
  const todayKey = useToday()
  // The coarse clock re-plans a screen left open: the pain, joint and rest rules run in hours.
  const clock = usePlanClock()
  const capacity = useMemo(() => bodyweightCapacity(state, Date.now()), [state, todayKey, clock])
  const [choice, setChoice] = useTodayChoice(todayKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const today = weekForChoice(state, choice).days[0].plan
  // The pain memory applies whoever picks the focus: it once applied only to a
  // session started from the Today card, so an elbow report still got
  // barbell presses from an Upper body pick here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sore = useMemo(() => soreJoints(state, Date.now()), [state, todayKey, clock])
  // The whole session's minutes, an opener included (a gym day's total).
  const [minutes, setMinutes] = useState(() => Math.max(MIN_GYM_MINUTES, choice.minutes ?? (today.minutes > 0 ? today.minutes : 45)))
  // A later "I have X minutes" on any screen moves them too: they were read once, when the tab opened.
  useEffect(() => {
    if (choice.minutes !== undefined) setMinutes(Math.max(MIN_GYM_MINUTES, choice.minutes))
  }, [choice.minutes])
  // A tab left open past midnight starts the new day at that day's minutes, not yesterday's pick.
  const minutesDay = useRef(todayKey)
  useEffect(() => {
    if (minutesDay.current === todayKey) return
    minutesDay.current = todayKey
    setMinutes(Math.max(MIN_GYM_MINUTES, choice.minutes ?? (today.minutes > 0 ? today.minutes : 45)))
    setAgain(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey])
  // Today's main session done: nothing more is recommended here, only a quiet way to train again.
  const [again, setAgain] = useState(false)
  const marks = useDayMarks(todayKey)
  const remembered = useNextBlock<GymPreset>(todayKey)
  const stage = dayStage(state, today, Date.now(), marks)
  const finished = stage === 'done'
  const partial = finished ? latestPartialToday(gym?.sessions) : undefined
  // The opener is saved and the lifts are what is left: no second opener, and the lifts keep the minutes the day planned.
  const liftsNext = stage === 'lifts-next'
  const [editingLifts, setEditingLifts] = useState(false)
  const [pending, setPending] = useState<{ empty: boolean; preset?: GymPreset; resumeSessionId?: string } | null>(null)
  const remaining = liftsNext && !editingLifts ? remembered : null
  const block = pending?.preset ?? preset ?? remaining
  const [skipOpener, setSkipOpener] = useState(false)
  const [focus, setFocus] = useState<GymFocus | 'auto'>('auto')
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [historyOf, setHistoryOf] = useState<string | null>(null)
  const [guideId, setGuideId] = useState<string | null>(null)
  const [running, setRunning] = useState<GymDraft | null>(null)
  const [resumable, setResumable] = useState<GymDraft | null>(() => loadDraft())
  // What is open is whatever storage holds now: read again when the player closes (a saved session clears it) and when
  // another tab changes it. It was read once at mount, so a finished session was still "open" beside "today: done".
  useEffect(() => {
    setResumable(openDraftFor(loadDraft(), running))
  }, [running])
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === 'planchelab.gymDraft') setResumable(openDraftFor(loadDraft(), running))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [running])
  // Where the lifts are built: where the plan has them (the gym, even with Home set as the place now) unless the
  // athlete said today that they are somewhere else. Home being active is not a pick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const source = pending?.resumeSessionId ? gym?.sessions.find((s) => s.id === pending.resumeSessionId) : undefined
  const fixedPlace = source?.locationId ?? pending?.preset?.placeId ?? preset?.placeId
  const where = useMemo(() => (gym ? resolveGymPlace(state, Date.now(), { plannedId: block?.placeId, pickedId: fixedPlace ?? choice.placeId }) : undefined), [state, gym, block?.placeId, fixedPlace, choice.placeId, todayKey, clock])
  const location = where?.place

  // The coach's gym session for now, as if today were a gym day: the focus, the
  // day's limits (season, sport, deload, joints) and the opener all come from
  // the plan, and a picked focus keeps every limit. Auto once followed a
  // rotation by session name on any day the plan had not made a gym day.
  const auto = useMemo(
    () => (gym && location ? gymToday(state, { now: Date.now(), minutes, focus: 'auto', location }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, gym, location, minutes, todayKey, clock],
  )
  const coach = useMemo(
    () => (focus === 'auto' ? auto : gym && location ? gymToday(state, { now: Date.now(), minutes, focus, location }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auto, state, gym, location, minutes, focus, todayKey, clock],
  )
  const resolvedFocus: GymFocus | undefined = block?.focus ?? coach?.focus
  const limits = block ?? coach
  const offeredOpener = startWorkout && !liftsNext && !block ? coach?.opener : undefined
  const opener = skipOpener ? undefined : offeredOpener
  const liftMinutes = block?.minutes ?? minutes - (opener?.minutes ?? 0)
  const warmUpMin = block?.warmUpMin ?? (opener || liftsNext ? AFTER_OPENER_WARM_UP_MIN : undefined)
  const plan = useMemo(
    () =>
      gym && location && limits && resolvedFocus
        ? buildGymSession({
            location,
            capacity,
            minutes: liftMinutes,
            focus: resolvedFocus,
            musclesOff: limits.musclesOff,
            avoidJoints: [...new Set([...limits.avoidJoints, ...sore.joints])],
            volumeFactor: limits.volumeFactor,
            // Straight after the opener, the lifts need only a short warm-up of their own.
            warmUpMin,
            favoriteAt: gym.favoriteAt,
            sessions: gym.sessions,
            ratings: gym.ratings,
            youth,
            ...(gym.prefs ? { goals: gym.prefs.goals } : {}),
            // The athlete's priorities and the week's: the muscles it leaves furthest under target, and the ones it has far past it.
            ...steerInput(limits, gym.prefs?.musclesPriority),
            now: Date.now(),
          })
        : null,
    [gym, location, liftMinutes, resolvedFocus, youth, limits, warmUpMin, capacity, sore],
  )
  const records = useMemo(() => (gym ? gymRecords(gym.sessions, location?.id) : {}), [gym, location?.id])

  // A session planned on the Today card asks the pain check, then starts.
  useEffect(() => {
    if (!entry || !gym || !location) return
    onPresetUsed?.()
    setPending('resumeSessionId' in entry ? { empty: false, resumeSessionId: entry.resumeSessionId } : { empty: false, preset: entry })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry])

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
    const load = it.suggestion.kg !== undefined ? entryLoad(it.suggestion.kg, unit) : undefined
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
    const regions = joints.map((j) => JOINT_REGION[j]).filter((r): r is BodyRegion => Boolean(r))
    if (kind !== 'none' && joints.length) {
      dispatch({ type: 'RECORD_SYMPTOM', event: { at: Date.now(), joints: kind, regions: regions.length ? regions : ['other'], source: 'check-in' } })
    } else if (kind === 'none' && sore.joints.length) {
      // "Nothing hurts" while a joint is still being kept out is the athlete saying it is fine now: recorded as an
      // all-good check-in, so the report that kept it out stops standing for the lifts and the skills alike. The
      // 72-hour union still holds (`soreJoints`). Without it a report days old stayed out of the lifts with no way
      // to clear it from the gym.
      dispatch({ type: 'RECORD_SYMPTOM', event: { at: Date.now(), joints: 'good', source: 'check-in' } })
    }
    const open = loadDraft()
    const avoid = [...new Set([...sore.joints, ...joints])]
    const light = kind === 'pain' || sore.pain
    if (open) {
      setRunning(adaptOpenDraft(open, avoid, light))
      setPending(null)
      setResumable(null)
      return
    }
    if (pending.resumeSessionId) {
      setPending(null)
      if (!source?.remaining || source.completion !== 'partial') {
        pushToast('The saved workout has changed. Open its latest entry in workout history.', 'info')
        return
      }
      const originalPlace = gym.locations.find((l) => l.id === source.locationId)
      const next = originalPlace && resumePartial(source, avoid, originalPlace)
      if (next) setRunning(adaptOpenDraft(next, avoid, light))
      else pushToast(originalPlace ? 'None of the remaining lifts fit this joint check and equipment. Your completed sets are in history.' : 'The original training place was removed. Your completed sets are in history.', 'info')
      return
    }
    const p = pending.preset
    // The opener runs first as its own skill session; the lifts follow on when
    // it is saved (the same hand-off a mixed day uses). Pain, or a sore joint the
    // skill loads, named just now leaves it out.
    const famJoints: Joint[] = opener ? (skillFamily(opener.skills[0]) === 'push' ? ['wrists', 'elbows', 'shoulders'] : ['elbows', 'shoulders']) : []
    if (!p && !pending.empty && opener && startWorkout && kind !== 'pain' && !joints.some((j) => famJoints.includes(j))) {
      const gymAfter = gymPreset(
          {
            focus: resolvedFocus ?? 'full',
            minutes: liftMinutes,
            avoidJoints: [...new Set([...(coach?.avoidJoints ?? []), ...joints])],
            volumeFactor: coach?.volumeFactor ?? 1,
            musclesOff: coach?.musclesOff ?? gym.prefs?.musclesOff ?? [],
            priority: coach?.priority,
            spare: coach?.spare,
          },
          { placeId: location.id, warmUpMin: AFTER_OPENER_WARM_UP_MIN },
      )
      setPending(null)
      // The place's kit goes with it: a lever with no bar at home trains on the gym's.
      startWorkout({ ...skillRequest(opener), gymAfter })
      return
    }
    // A joint named now that the planned lifts did not steer round (the lifts after an opener were planned before
    // it): the coach plans them again with it — the same focus while it still builds two movements, else the coach's
    // pick for the day — or there are none, and the reason is said. A shoulder named after a planche opener once
    // left a 35-minute push block of one triceps pushdown.
    let replanned: ReturnType<typeof gymToday> | null = null
    if (p && !pending.empty && kind !== 'none' && joints.some((j) => !(p.avoidJoints ?? []).includes(j))) {
      const now = Date.now()
      const event = { id: `check-${now}`, at: now, joints: kind, regions: regions.length ? regions : ['other'], source: 'check-in' } as NonNullable<AppState['symptoms']>[number]
      const reported: AppState = { ...state, symptoms: [...(state.symptoms ?? []), event] }
      const builds = (g: ReturnType<typeof gymToday>) => {
        if (!g.focus) return false
        const b = buildGymSession({
          location,
          capacity,
          minutes: p.minutes,
          focus: g.focus,
          musclesOff: g.musclesOff,
          avoidJoints: [...new Set([...g.avoidJoints, ...joints])],
          volumeFactor: kind === 'pain' ? Math.min(g.volumeFactor, 0.6) : g.volumeFactor,
          ...steerInput(g),
          sessions: gym.sessions,
          ratings: gym.ratings,
          youth,
          ...(p.warmUpMin !== undefined ? { warmUpMin: p.warmUpMin } : {}),
          now,
        })
        return b.fits && b.items.length >= 2
      }
      const same = gymToday(reported, { now, minutes: p.minutes, focus: p.focus, location })
      replanned = builds(same) ? same : gymToday(reported, { now, minutes: p.minutes, focus: 'auto', location })
      if (!builds(replanned)) {
        setPending(null)
        pushToast(
          `No lifts today: with your ${joints.map((j) => j.replace('-', ' ')).join(' and ')} kept out, nothing at ${location.name} builds two movements in ${p.minutes} minutes. Your skill work is saved; the lifts rest today.`,
          'info',
        )
        return
      }
    }
    const base = replanned?.focus
      ? { focus: replanned.focus, musclesOff: replanned.musclesOff, avoidJoints: replanned.avoidJoints, volumeFactor: replanned.volumeFactor }
      : p
      ? { focus: p.focus, musclesOff: p.musclesOff ?? gym.prefs?.musclesOff ?? [], avoidJoints: p.avoidJoints ?? [], volumeFactor: p.volumeFactor ?? 1 }
      : {
          ...(resolvedFocus ? { focus: resolvedFocus } : {}),
          musclesOff: coach?.musclesOff ?? gym.prefs?.musclesOff ?? [],
          avoidJoints: coach?.avoidJoints ?? [],
          volumeFactor: coach?.volumeFactor ?? 1,
        }
    const avoidJoints = [...new Set([...base.avoidJoints, ...sore.joints, ...joints])]
    const musclesOff = base.musclesOff
    // Pain named now caps the day; otherwise the plan's own factor stands — a push
    // day's extra set was once clamped away here, so it never reached the lifts.
    const volumeFactor = kind === 'pain' ? Math.min(base.volumeFactor, 0.6) : base.volumeFactor
    const built = pending.empty
      ? null
      : buildGymSession({
          location,
          capacity,
          minutes: p?.minutes ?? minutes,
          favoriteAt: gym.favoriteAt,
          ...(base.focus ? { focus: base.focus } : {}),
          sessions: gym.sessions,
          ratings: gym.ratings,
          youth,
          avoidJoints,
          volumeFactor,
          warmUpMin,
          musclesOff,
          ...(gym.prefs ? { goals: gym.prefs.goals } : {}),
          ...steerInput(replanned ?? (p ? p : (coach ?? {})), gym.prefs?.musclesPriority),
          now: Date.now(),
        })
    setPending(null)
    setRunning({
      id: newGymSessionId(),
      startedAt: Date.now(),
      locationId: location.id,
      name: built?.name ?? 'Gym session',
      items: (built?.items ?? []).map(toDraftItem),
      ...(avoidJoints.length ? { avoidJoints } : {}),
      ...(musclesOff.length ? { musclesOff } : {}),
      // A movement added or swapped in mid-session keeps the day's dose and the athlete's goals.
      volumeFactor,
      ...(gym.prefs ? { goals: gym.prefs.goals } : {}),
    })
  }

  const editingLocation =
    editing === 'new' ? newLocation('New gym', location.unit) : gym.locations.find((l) => l.id === editing) ?? null
  const topRecords = Object.values(records)
    .filter((r) => r.bestE1rm)
    .sort((a, b) => b.bestE1rm!.kg - a.bestE1rm!.kg)
    .slice(0, 6)
  const autoFocus = auto?.focus
  // Said plainly where the lifts are built, and where the plan had them when the athlete moved them.
  const placeNote = gymPlaceLine(where)

  return (
    <div className="space-y-5">
      {resumable && !running ? (
        <Card tone="accent">
          <p className="text-body font-semibold">A gym session is still open</p>
          <p className="mt-1 text-footnote text-ink2">
            {resumable.name}, started {dayLabel(resumable.startedAt)} — nothing logged in it was lost.
          </p>
          <ul className="mt-2 list-disc pl-5 text-footnote text-ink2">
            {draftContents(resumable).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {draftConflictLine(resumable, sore.joints) ? (
            <p className="mt-2 rounded-control bg-raised p-3 text-footnote text-ink" role="alert">
              {draftConflictLine(resumable, sore.joints)}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button
              className="flex-1"
              onClick={() => setPending({ empty: false })}
            >
              Resume {resumable.name}
            </Button>
            <Button
              variant="secondary"
              aria-label={`Discard the open ${resumable.name} session`}
              onClick={() => {
                setResumable(null)
                try {
                  localStorage.removeItem('planchelab.gymDraft')
                } catch {
                  // Nothing to clear.
                }
              }}
            >
              Discard it
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
              onClick={() => {
                dispatch({ type: 'GYM', op: { op: 'setActiveLocation', id: l.id } })
                // Saying where you are today is a pick; going back to where the plan has it clears the pick.
                setChoice({ ...choice, placeId: where?.planned && l.id === where.planned.id ? undefined : l.id })
              }}
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
        {placeNote ? <p className="mt-2 text-caption text-ink3">{placeNote}</p> : null}
      </section>

      <Card>
        <CardTitle>Today’s gym session</CardTitle>
        <p className="-mt-2 text-footnote text-ink3">
          Built from what {location.name} has, your likes and your last sessions. Auto is today planned as a gym day; any focus keeps today’s limits.
        </p>
        {finished && !again ? (
          <div className="mt-3 rounded-inner border border-line bg-raised p-3">
            {partial ? <PartialWorkout session={partial} onContinue={() => setPending({ empty: false, resumeSessionId: partial.id })} /> : <p className="text-footnote text-ink2">
              <span className="font-semibold text-ink">Today: done</span> — today’s main session is in, and nothing more is planned.
            </p>}
            <button onClick={() => setAgain(true)} aria-label="Train again: an extra gym session today" className="mt-1 min-h-11 text-footnote font-medium text-accent-text">
              Train again
            </button>
          </div>
        ) : (
        <>
        {finished && again ? <p className="mt-3 rounded-control bg-raised p-3 text-footnote text-ink2">{EXTRA_SESSION_LINE}</p> : null}
        {sore.joints.length ? (
          <p className="mt-3 rounded-control bg-raised p-3 text-footnote text-ink2">
            Keeping load off your {sore.joints.map((j) => j.replace('-', ' ')).join(' and ')} — you reported {sore.joints.length > 1 ? 'them' : 'it'}{' '}
            {sore.lastAt ? dayLabel(sore.lastAt) : 'lately'}. Anything that loads {sore.joints.length > 1 ? 'them' : 'it'} stays out for three days after a
            report, and after that until you answer “Nothing hurts” at the check before you start — whichever focus you pick.
            {sore.pain ? ' Never train through pain.' : ''}
          </p>
        ) : null}
        {remaining ? (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-inner bg-raised px-3">
            <span className="text-footnote font-semibold">{FOCUS_LABEL[remaining.focus]} · {remaining.minutes} min</span>
            <Button variant="ghost" onClick={() => {
              setMinutes(remaining.minutes)
              setFocus(remaining.focus)
              setEditingLifts(true)
            }}>Change lifts</Button>
          </div>
        ) : <>
        <p className="mt-3 text-caption font-medium text-ink3">Time</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {[...new Set([...MINUTES, minutes])].sort((a, b) => a - b).map((m) => (
            <ToggleChip key={m} active={minutes === m} onClick={() => setMinutes(m)}>
              {m} min
            </ToggleChip>
          ))}
        </div>
        <p className="mt-3 text-caption font-medium text-ink3">Focus</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {FOCI.map((f) => (
            <ToggleChip key={f} active={focus === f} onClick={() => setFocus(f)}>
              {f === 'auto' ? (autoFocus ? `Auto (${FOCUS_LABEL[autoFocus]})` : 'Auto') : FOCUS_LABEL[f]}
            </ToggleChip>
          ))}
        </div>
        </>}
        {offeredOpener ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-inner bg-accent-soft p-3">
            <span className="min-w-0">
              <span className="block text-body font-semibold">
                {opener ? openerLine(offeredOpener) : `Could open with ${SKILL_NAME[offeredOpener.skills[0]]} holds · ${offeredOpener.minutes} min`}
              </span>
              <span className="block text-caption text-ink2">Skill work first, while you are fresh; the lifts follow on when it is saved.</span>
            </span>
            <Button
              variant="ghost"
              aria-label={`${skipOpener ? 'Add' : 'Skip'} the ${SKILL_NAME[offeredOpener.skills[0]]} skill opener`}
              onClick={() => setSkipOpener(!skipOpener)}
            >
              {skipOpener ? 'Add it' : 'Skip it'}
            </Button>
          </div>
        ) : liftsNext ? (
          <p className="mt-3 rounded-control bg-accent-soft p-3 text-footnote text-ink2">
            Your skill opener is saved. These lifts finish the session.
          </p>
        ) : coach?.noOpener ? (
          <p className="mt-3 text-caption text-ink3">No skill work first: {coach.noOpener}</p>
        ) : null}
        {coach?.limits.length ? <p className="mt-3 text-caption text-ink2">Today: {coach.limits.join(' ')}</p> : null}
        {!resolvedFocus && coach?.noFocus ? <p className="mt-3 rounded-control bg-raised p-3 text-footnote text-ink2">{coach.noFocus}</p> : null}
        {plan && plan.items.length ? (
          <ol className="mt-4 divide-y divide-line">
            {plan.items.map((it) => {
              const ex = GYM_EXERCISE_BY_ID[it.exerciseId]
              return (
                <li key={it.exerciseId}>
                  <button onClick={() => setGuideId(ex.id)} aria-label={`Exercise guide for ${ex.name}`} className="flex min-h-11 w-full items-baseline justify-between gap-3 rounded-control py-2.5 text-left hover:bg-raised">
                  <span className="min-w-0">
                    <span className="block text-body font-medium">{ex.name}</span>
                    <span className="block text-caption text-ink3">{it.suggestion.why}</span>
                  </span>
                  <span className="shrink-0 text-right text-footnote tnum text-ink2">
                    {it.sets} × {it.plan.range[0]}–{it.plan.range[1]}{countUnit(ex) === 'seconds' ? ' s' : ''}
                    <br />
                    {it.suggestion.kg !== undefined || ex.load === 'bodyweight' ? formatLoad(it.suggestion.kg, unitFor(ex, location), ex) : 'Pick a weight'}
                  </span>
                  </button>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="mt-4 rounded-control bg-raised p-3 text-footnote text-ink2">
            {sore.joints.length
              ? `Nothing for this focus at ${location.name} leaves your ${sore.joints.map((j) => j.replace('-', ' ')).join(' and ')} alone today. Pick another focus, or start an empty session.`
              : plan && !plan.fits
                ? `${minutes} minutes is not enough for a block of this focus with its warm-up and rests. Pick more time, or start an empty session.`
                : `Nothing to program for this focus with what ${location.name} has. Add equipment, pick another focus, or start an empty session.`}
          </p>
        )}
        {plan?.dropped.length ? <p className="mt-2 text-caption text-ink3">{leftOutLine(plan.dropped, liftMinutes, opener?.minutes)}</p> : null}
        {plan?.notes.map((n) => (
          <p key={n} className="mt-2 text-caption text-ink2">
            {n}
          </p>
        ))}
        {plan && plan.items.length ? <p className="mt-1 text-caption text-ink3">About {plan.estimatedMin} minutes with warm-up and rests.</p> : null}
        {resumable ? (
          <div className="mt-4 space-y-2">
            <p className="rounded-control bg-raised p-3 text-footnote text-ink2">{resumeLine(resumable)}</p>
            <ul className="list-disc pl-5 text-footnote text-ink2">
              {draftContents(resumable).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <Button
              size="lg"
              full
              aria-label={`Resume the open ${resumable.name} session, not the plan above`}
              onClick={() => setPending({ empty: false })}
            >
              Resume {resumable.name}
            </Button>
          </div>
        ) : (
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <Button size="lg" disabled={!plan?.items.length} onClick={() => setPending({ empty: false, ...(remaining ? { preset: { ...remaining, placeId: location.id } } : {}) })}>
            Start session
          </Button>
          <Button size="lg" variant="secondary" onClick={() => setPending({ empty: true })}>
            Empty
          </Button>
        </div>
        )}
        </>
        )}
        {youth ? (
          <p className="mt-3 text-caption leading-relaxed text-ink3">
            Careful mode is on. Most lifts start at six or more reps and weights increase one step at a time.
          </p>
        ) : null}
      </Card>

      <GymHistory limit={5} />

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
                    aria-label={`${ex?.name}: estimated max ${formatLoad(r.bestE1rm!.kg, ex ? unitFor(ex, location) : location.unit)}${isFirstEstimate(r) ? ` (${FIRST_ESTIMATE_NOTE})` : ''} — open its history`}
                  >
                    <p className="truncate text-footnote text-ink3">{ex?.name}</p>
                    <p className="mt-0.5 font-display text-title1 font-semibold tnum">{formatLoad(r.bestE1rm!.kg, ex ? unitFor(ex, location) : location.unit)}</p>
                    {isFirstEstimate(r) ? <p className="text-caption text-ink3">{FIRST_ESTIMATE_NOTE}</p> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      <WeekVolume />

      <Sheet open={guideId !== null} onClose={() => setGuideId(null)} label="Exercise guide">
        {guideId && <><h2 className="mb-3 text-title2 font-semibold">{GYM_EXERCISE_BY_ID[guideId].name}</h2><GymExerciseGuide exercise={GYM_EXERCISE_BY_ID[guideId]} /></>}
      </Sheet>
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
  hips: 'hip',
  ankles: 'ankle',
}
const CHECK_JOINTS: { id: Joint; label: string }[] = [
  { id: 'wrists', label: 'Wrists' },
  { id: 'elbows', label: 'Elbows' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'lower-back', label: 'Lower back' },
  { id: 'knees', label: 'Knees' },
  { id: 'hips', label: 'Hips' },
  { id: 'ankles', label: 'Ankles' },
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
