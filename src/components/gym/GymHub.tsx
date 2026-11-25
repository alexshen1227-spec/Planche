import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import { buildGymSession, FOCUS_LABEL, type GymFocus, type PlannedExercise } from '../../lib/gym/builder'
import type { Joint } from '../../data/gym/catalog'
import type { BodyRegion } from '../../types'
import { draftConflictLine, draftContents, EXTRA_SESSION_LINE, leftOutLine, openDraftFor, resumeLine } from '../../lib/gym/sessionLines'
import { adaptOpenDraft, conservative, draftItemFromPlan, FINISHER_LABEL, latestPartialToday, loadDraft, QUICK_LOG_NAME, resumePartial, saveDraft, type GymDraft } from '../../lib/gym/draft'
import { AFTER_OPENER_WARM_UP_MIN, gymToday, MIN_GYM_MINUTES, skillFamily, skillRequest, soreJoints } from '../../lib/plan/planner'
import { weekForChoice } from '../../lib/plan/currentWeek'
import { dayStage, gymPlaceLine, gymPreset, openerLine, remainingLifts, resolveGymPlace, steerInput, type GymEntry, type GymPreset } from '../../lib/plan/screens'
import { usePlanClock } from '../../lib/plan/usePlanClock'
import { useDayMarks, useNextBlock } from '../../lib/plan/nextBlock'
import { useTodayChoice } from '../../lib/plan/todayChoice'
import { useToday } from '../../lib/useToday'
import type { AppState, SkillId, WorkoutRequest } from '../../types'
import { countWord, FIRST_ESTIMATE_NOTE, gymRecords, isFirstEstimate, prescribedCount } from '../../lib/gym/progression'
import { defaultGym, defaultPrefs, newGymSessionId, newLocation } from '../../lib/gym/state'
import { formatLoad, unitFor } from '../../lib/gym/units'
import { focusFromName } from '../../lib/gym/focus'
import { Icon } from '../Icon'
import { Button, Card, CardTitle, EmptyState, Sheet, ToggleChip } from '../ds'
import { GymWorkoutGate } from './GymWorkoutGate'
import { PartialWorkout } from './PartialWorkout'
import { WeekVolume } from '../plan/WeekVolume'
import { LocationEditor } from './LocationEditor'
import { PullupStartingSet } from './PullupStartingSet'
import { ExerciseHistory } from './ExerciseHistory'
import { bodyweightCapacity } from '../../lib/gym/bodyweight'
import { canReplanGym, GYM_PLAN_REVISION, gymWriterBusy, outdatedGymPlan, regeneratedPlan, replanGymDraft, untouchedGymPlan } from '../../lib/gym/replan'
import { GymHistory } from './GymHistory'
import { GymExerciseGuide } from './ExerciseGuide'
import { ExerciseRatings } from './ExerciseRatings'

const MINUTES = [15, 20, 30, 45, 60, 75, 90]
const SKILL_NAME: Record<SkillId, string> = { planche: 'planche', frontlever: 'front lever', handstand: 'handstand', ninety: '90° hold', flag: 'human flag' }
const FOCI: (GymFocus | 'auto')[] = ['auto', 'full', 'upper', 'lower', 'push', 'pull', 'athletic']

function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export function GymHub({
  preset: entry,
  onPresetUsed,
  startWorkout,
  onWorkoutChange,
}: { preset?: GymEntry | null; onPresetUsed?: () => void; startWorkout?: (request: WorkoutRequest) => void; onWorkoutChange?: (open: boolean) => void } = {}) {
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
  const minutes = Math.max(MIN_GYM_MINUTES, choice.minutes ?? (today.minutes > 0 ? today.minutes : 45))
  // A tab left open past midnight starts the new day at that day's minutes, not yesterday's pick.
  const minutesDay = useRef(todayKey)
  useEffect(() => {
    if (minutesDay.current === todayKey) return
    minutesDay.current = todayKey
    setAgain(false)
    setEditingLifts(false)
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
  const [pending, setPending] = useState<{ empty: boolean; preset?: GymPreset; resumeSessionId?: string; keepOpen?: boolean; replanId?: string } | null>(null)
  const remaining = liftsNext && !editingLifts ? remainingLifts(today, remembered, choice.placeId) : null
  const block = pending?.preset ?? preset ?? remaining
  const skipOpener = choice.skipOpener
  const focus = choice.gymFocus ?? 'auto'
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [historyOf, setHistoryOf] = useState<string | null>(null)
  const [guideId, setGuideId] = useState<string | null>(null)
  const [ratingsOpen, setRatingsOpen] = useState(false)
  const [running, setRunning] = useState<GymDraft | null>(null)
  useLayoutEffect(() => {
    onWorkoutChange?.(Boolean(running))
    return () => onWorkoutChange?.(false)
  }, [running, onWorkoutChange])
  const [replacing, setReplacing] = useState<GymDraft | null>(null)
  const [resumable, setResumable] = useState<GymDraft | null>(() => loadDraft(state.epoch))
  // What is open is whatever storage holds now: read again when the player closes (a saved session clears it) and when
  // another tab changes it. It was read once at mount, so a finished session was still "open" beside "today: done".
  useEffect(() => {
    setResumable(openDraftFor(loadDraft(state.epoch), running))
  }, [running, state.epoch])
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === 'planchelab.gymDraft') setResumable(openDraftFor(loadDraft(state.epoch), running))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [running, state.epoch])
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
  const withOpener = useMemo(
    () => (focus === 'auto' ? auto : gym && location ? gymToday(state, { now: Date.now(), minutes, focus, location }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auto, state, gym, location, minutes, focus, todayKey, clock],
  )
  const coach = useMemo(() => skipOpener && gym && location
    ? gymToday(state, { now: Date.now(), minutes, focus, location, skipOpener: true }) : withOpener,
    [withOpener, skipOpener, state, gym, minutes, focus, location])
  const resolvedFocus: GymFocus | undefined = block?.focus ?? coach?.focus
  const limits = block ?? coach
  const offeredOpener = startWorkout && !liftsNext && !block ? withOpener?.opener : undefined
  const opener = skipOpener ? undefined : offeredOpener
  const liftMinutes = block?.minutes ?? minutes - (opener?.minutes ?? 0)
  const warmUpMin = block?.warmUpMin ?? (opener || liftsNext ? AFTER_OPENER_WARM_UP_MIN : undefined)
  // "Regenerate today's plan" builds the plan again from scratch, whatever was computed before.
  const [regenerated, setRegenerated] = useState(0)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gym, location, liftMinutes, resolvedFocus, youth, limits, warmUpMin, capacity, sore, regenerated],
  )
  const records = useMemo(() => (gym ? gymRecords(gym.sessions, location?.id) : {}), [gym, location?.id])
  const ratedCount = gym ? Object.keys(gym.ratings).filter((id) => GYM_EXERCISE_BY_ID[id]).length : 0

  /**
   * An open plan nothing has been done in, built again by the current generator for its own day: the same day
   * type and place, the minutes it was built for and the limits its check-in set. Null when anything is logged.
   */
  const rebuildUntouched = (open: GymDraft): GymDraft | null => {
    const place = gym?.locations.find((l) => l.id === open.locationId)
    const day = focusFromName(open.name)
    if (!gym || !place || !day || !untouchedGymPlan(open)) return null
    const now = Date.now()
    const budget = open.planMinutes ?? liftMinutes
    const warm = open.planMinutes !== undefined ? open.warmUpMin : warmUpMin
    const goals = open.goals ?? gym.prefs?.goals
    const built = buildGymSession({
      location: place,
      capacity,
      minutes: budget,
      focus: day,
      musclesOff: open.musclesOff ?? limits?.musclesOff ?? gym.prefs?.musclesOff ?? [],
      avoidJoints: [...new Set([...(open.avoidJoints ?? []), ...sore.joints])],
      volumeFactor: open.volumeFactor ?? 1,
      ...(warm !== undefined ? { warmUpMin: warm } : {}),
      favoriteAt: gym.favoriteAt,
      sessions: gym.sessions,
      ratings: gym.ratings,
      youth,
      ...(goals ? { goals } : {}),
      ...steerInput(limits ?? {}, gym.prefs?.musclesPriority),
      now,
    })
    if (!built.fits) return null
    return regeneratedPlan(open, { name: built.name, items: built.items.map((it) => draftItemFromPlan(it, place, gym.sessions)),
      planMinutes: budget, ...(warm !== undefined ? { warmUpMin: warm } : {}) }, now)
  }
  /** Replace the stored plan only if it is still the one read: a set logged in another tab always wins. */
  const replaceUntouched = (open: GymDraft, next: GymDraft): boolean => {
    const stored = loadDraft(state.epoch)
    if (gymWriterBusy() || !stored || JSON.stringify(stored) !== JSON.stringify(open)) return false
    saveDraft(next)
    setResumable(next)
    return true
  }
  // A plan an older generator built, with nothing done in it, is rebuilt with the current logic as soon as it is
  // seen; a workout with any logged set is left exactly as it is.
  useEffect(() => {
    if (!resumable || running || pending || !outdatedGymPlan(resumable)) return
    const next = rebuildUntouched(resumable)
    if (next && replaceUntouched(resumable, next)) {
      pushToast(`Your open ${next.name} plan was rebuilt with the updated workout builder. Nothing you logged has changed.`, 'info')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumable, running, pending])
  const regenerateToday = () => {
    const open = loadDraft(state.epoch)
    if (open && untouchedGymPlan(open)) {
      const next = rebuildUntouched(open)
      if (next && replaceUntouched(open, next)) {
        pushToast(`Today’s ${next.name} plan was regenerated. Nothing you logged has changed.`, 'info')
        return
      }
      if (gymWriterBusy()) {
        pushToast('Your workout is open in another tab. Regenerate it from there.', 'info')
        return
      }
    }
    setRegenerated((n) => n + 1)
    pushToast(open && !untouchedGymPlan(open)
      ? 'Today’s plan was regenerated. Your open workout keeps its logged sets as they are.'
      : 'Today’s plan was regenerated with the current workout builder.', 'info')
  }

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

  const toDraftItem = (it: PlannedExercise) => draftItemFromPlan(it, location, gym.sessions)

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
    const open = loadDraft(state.epoch)
    const refreshOpen = open && !pending.keepOpen && !pending.resumeSessionId && !pending.empty &&
      (pending.replanId === open.id || (!pending.replanId && outdatedGymPlan(open))) &&
      canReplanGym(open, location.id, Date.now())
    if (pending.replanId && (!open || open.id !== pending.replanId)) {
      setPending(null)
      pushToast('The open workout changed. Check the latest workout before rebuilding it.', 'info')
      return
    }
    const avoid = [...new Set([...sore.joints, ...joints])]
    const light = kind === 'pain' || sore.pain
    if (open && !refreshOpen) {
      setRunning(adaptOpenDraft(open, avoid, light, gym.locations.find((l) => l.id === open.locationId) ?? location))
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
    if ((!open || untouchedGymPlan(open)) && !p && !pending.empty && opener && startWorkout && kind !== 'pain' && !joints.some((j) => famJoints.includes(j))) {
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
      startWorkout({ ...skillRequest(opener), placeId: opener.placeId ?? gymAfter.placeId, gymAfter })
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
          ...steerInput(g, gym.prefs?.musclesPriority),
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
    const previous = open && refreshOpen && !untouchedGymPlan(open) ? open : undefined
    const avoidJoints = [...new Set([...base.avoidJoints, ...sore.joints, ...joints, ...(previous?.avoidJoints ?? [])])]
    const musclesOff = [...new Set([...base.musclesOff, ...(previous?.musclesOff ?? [])])]
    // Pain named now caps the day; otherwise the plan's own factor stands — a push
    // day's extra set was once clamped away here, so it never reached the lifts.
    const volumeFactor = Math.min(base.volumeFactor, previous?.volumeFactor ?? Infinity, kind === 'pain' ? 0.6 : Infinity)
    const planMinutes = p?.minutes ?? (previous ? liftMinutes : minutes)
    const built = pending.empty
      ? null
      : buildGymSession({
          location,
          capacity,
          minutes: planMinutes,
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
    if (refreshOpen && !built?.items.length) {
      pushToast('No exercises fit the updated plan here. Your open workout is still available.', 'info')
      return
    }
    const fresh: GymDraft = {
      id: newGymSessionId(),
      ...(built ? { planRevision: GYM_PLAN_REVISION, planMinutes, ...(warmUpMin !== undefined ? { warmUpMin } : {}) } : {}),
      startedAt: Date.now(),
      locationId: location.id,
      // An empty start is a quick log: the athlete picks each exercise as they go.
      name: built?.name ?? QUICK_LOG_NAME,
      items: (built?.items ?? []).map(toDraftItem),
      ...(avoidJoints.length ? { avoidJoints } : {}),
      ...(musclesOff.length ? { musclesOff } : {}),
      // A movement added or swapped in mid-session keeps the day's dose and the athlete's goals.
      volumeFactor,
      ...(gym.prefs ? { goals: gym.prefs.goals } : {}),
    }
    setReplacing(refreshOpen ? open : null)
    setRunning(open && refreshOpen ? replanGymDraft(open, fresh, Date.now()) : fresh)
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
              onClick={() => resumable.stopReport ? setRunning(resumable) : setPending({ empty: false, keepOpen: true })}
            >
              {resumable.stopReport ? 'Review stopped workout' : `Resume ${resumable.name}`}
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
          {canReplanGym(resumable, location.id, Date.now()) && !!plan?.items.length && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-footnote text-ink2">{outdatedGymPlan(resumable)
                ? 'This workout was picked by an earlier version. Use today’s plan to get the current exercises.'
                : 'Use the focus, time and equipment shown below to rebuild the remaining work. Completed sets keep their original weights and reps.'}</p>
              <Button variant="secondary" className="mt-2" onClick={() => setPending({ empty: false, replanId: resumable.id, ...(remaining ? { preset: remaining } : {}) })}>
                {outdatedGymPlan(resumable) ? 'Use today’s updated workout' : 'Rebuild remaining exercises'}
              </Button>
            </div>
          )}
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
        {(location.equipment.includes('pullup-bar') || location.equipment.includes('rings')) &&
          <PullupStartingSet saved={gym.prefs?.pullupStartingSet} onSave={(pullupStartingSet) =>
            dispatch({ type: 'GYM', op: { op: 'setPrefs', prefs: { ...(gym.prefs ?? defaultPrefs()), pullupStartingSet } } })} />}
        {remaining ? (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-inner bg-raised px-3">
            <span className="text-footnote font-semibold">{FOCUS_LABEL[remaining.focus]} · {remaining.minutes} min</span>
            <Button variant="ghost" onClick={() => {
              setChoice({ ...choice, kind: 'gym', minutes: remaining.minutes, gymFocus: remaining.focus, skipOpener: true })
              setEditingLifts(true)
            }}>Change lifts</Button>
          </div>
        ) : <>
        <p className="mt-3 text-caption font-medium text-ink3">Time</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {[...new Set([...MINUTES, minutes])].sort((a, b) => a - b).map((m) => (
            <ToggleChip key={m} active={minutes === m} onClick={() => setChoice({ ...choice, kind: 'gym', minutes: m })}>
              {m} min
            </ToggleChip>
          ))}
        </div>
        <p className="mt-3 text-caption font-medium text-ink3">Focus</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {FOCI.map((f) => (
            <ToggleChip key={f} active={focus === f} onClick={() => setChoice({ ...choice, kind: 'gym', gymFocus: f === 'auto' ? undefined : f })}>
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
              onClick={() => setChoice({ ...choice, kind: 'gym', skipOpener: skipOpener ? undefined : true })}
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
                    {it.finisher ? <span className="block text-caption font-semibold uppercase tracking-wide text-accent-text">{FINISHER_LABEL}</span> : null}
                    <span className="block text-body font-medium">{ex.name}</span>
                    <span className="block text-caption text-ink3">{it.suggestion.why}</span>
                  </span>
                  <span className="shrink-0 text-right text-footnote tnum text-ink2">
                    {it.sets} × {countWord(ex, prescribedCount(it.plan, it.suggestion))}
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
              ? `Nothing for this focus at ${location.name} leaves your ${sore.joints.map((j) => j.replace('-', ' ')).join(' and ')} alone today. Pick another focus, or use Quick log to choose your own exercises.`
              : plan && !plan.fits
                ? `${minutes} minutes is not enough for a block of this focus with its warm-up and rests. Pick more time, or use Quick log to choose your own exercises.`
                : `Nothing to program for this focus with what ${location.name} has. Add equipment, pick another focus, or use Quick log to choose your own exercises.`}
          </p>
        )}
        {plan?.dropped.length ? <p className="mt-2 text-caption text-ink3">{leftOutLine(plan.dropped, plan.cappedAt ?? liftMinutes, opener?.minutes)}</p> : null}
        {plan?.notes.map((n) => (
          <p key={n} className="mt-2 text-caption text-ink2">
            {n}
          </p>
        ))}
        {plan && plan.items.length ? <p className="mt-1 text-caption text-ink3">About {plan.estimatedMin} minutes with warm-up and rests.</p> : null}
        <Button variant="ghost" className="mt-2" onClick={regenerateToday}
          aria-label="Regenerate today’s plan with the current workout builder. Logged sets are never changed.">
          Regenerate today’s plan
        </Button>
        {resumable && !outdatedGymPlan(resumable) ? (
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
              aria-label={resumable.stopReport ? 'Review stopped workout' : `Resume the open ${resumable.name} session, not the plan above`}
              onClick={() => resumable.stopReport ? setRunning(resumable) : setPending({ empty: false, keepOpen: true })}
            >
              {resumable.stopReport ? 'Review stopped workout' : `Resume ${resumable.name}`}
            </Button>
          </div>
        ) : (
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <Button size="lg" disabled={!plan?.items.length} onClick={() => setPending({ empty: false, ...(remaining ? { preset: { ...remaining, placeId: location.id } } : {}) })}>
            Start session
          </Button>
          {!resumable && <Button size="lg" variant="secondary" onClick={() => setPending({ empty: true })}
            aria-label="Quick log: start an empty workout and add each exercise as you go">
            Quick log
          </Button>}
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

      <Card>
        <CardTitle>Exercise ratings</CardTitle>
        <p className="text-footnote text-ink2">
          {ratedCount ? `${ratedCount} ${ratedCount === 1 ? 'exercise' : 'exercises'} rated. ` : ''}Tell the plan which exercises you
          love and which you would rather skip: it picks loved ones more often, disliked ones rarely and avoided ones never.
        </p>
        <Button variant="secondary" className="mt-3" onClick={() => setRatingsOpen(true)}>Rate exercises</Button>
      </Card>

      <Sheet open={guideId !== null} onClose={() => setGuideId(null)} label="Exercise guide">
        {guideId && <><h2 className="mb-3 text-title2 font-semibold">{GYM_EXERCISE_BY_ID[guideId].name}</h2><GymExerciseGuide exercise={GYM_EXERCISE_BY_ID[guideId]} onOpen={(ex) => setGuideId(ex.id)} rate /></>}
      </Sheet>
      <Sheet open={ratingsOpen} onClose={() => setRatingsOpen(false)} label="Exercise ratings">
        {ratingsOpen && <ExerciseRatings location={location} />}
      </Sheet>
      <Sheet open={historyOf !== null} onClose={() => setHistoryOf(null)} label="Exercise history">
        {historyOf ? <ExerciseHistory exerciseId={historyOf} /> : null}
      </Sheet>


      <Sheet open={pending !== null} onClose={() => setPending(null)} label="Before you start">
        {pending && !pending.keepOpen && !pending.resumeSessionId && resumable && outdatedGymPlan(resumable) && (
          <p className="mb-3 text-footnote text-ink2">Starting uses today’s updated exercises. You can close this check and resume the earlier workout if you prefer.</p>
        )}
        {pending?.preset && !pending.keepOpen && !pending.replanId && resumable && !outdatedGymPlan(resumable) &&
          canReplanGym(resumable, location.id, Date.now()) && (
            <div className="mb-3 rounded-inner border border-line p-3">
              <p className="text-footnote text-ink2">You have an open {resumable.name} workout. Continue it as saved, or use the current plan for the remaining exercises.</p>
              <Button variant="secondary" className="mt-2" onClick={() => setPending({ ...pending, replanId: resumable.id })}>Use current plan for remaining exercises</Button>
            </div>
          )}
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
        <GymWorkoutGate
          draft={running}
          replacing={replacing}
          location={gym.locations.find((l) => l.id === running.locationId) ?? location}
          onClose={() => { setRunning(null); setReplacing(null) }}
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
