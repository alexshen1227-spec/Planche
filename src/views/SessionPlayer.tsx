import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CheckIn,
  Exercise,
  FormCheck,
  FormIssue,
  FormRating,
  Section,
  Session,
  SessionEvents,
  SetLog,
  Workout,
} from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID } from '../data/progressions'
import { describeBlock, adaptiveTarget } from '../data/workouts'
import { debriefSession, type CoachDecision } from '../lib/coach'
import { ACHIEVEMENT_BY_ID } from '../data/achievements'
import { useStore } from '../lib/store'
import { applySession } from '../lib/engine'
import { sfx, speak, buzz } from '../lib/audio'
import { confetti } from '../lib/confetti'
import { useWakeLock } from '../lib/wakeLock'
import { clearDraft, saveDraft, type SessionDraft } from '../lib/draft'
import { useFormRecorder } from '../lib/recorder'
import { saveClip, getClipBlob } from '../lib/clips'
import {
  analyseClip,
  emptyResult,
  friendlyResult,
  isFilmable,
  warmDetector,
  type PoseFormResult,
} from '../lib/poseForm'
import { pushToast } from '../lib/toast'
import { fmtClock, fmtHold } from '../lib/time'
import { demoSearchUrl, youtubeId, embedUrl } from '../lib/video'
import { Icon } from '../components/Icon'
import { Figure } from '../components/Figure'
import { ProgressRing, Modal } from '../components/ui'
import { ClipPlayer } from '../components/ClipPlayer'
import {
  passesProgressionFormCheck,
  setNeedsProgressionFormEvidence,
} from '../lib/progression'

type Phase = 'intro' | 'ready' | 'lead' | 'hold' | 'reps' | 'rest' | 'summary' | 'celebrate'

const SECTION_LABEL: Record<Section, string> = {
  warmup: 'Warm-up',
  main: 'Main work',
  strength: 'Strength',
  core: 'Core',
  cooldown: 'Cooldown',
}

const LEAD_SEC = 5

export function SessionPlayer({
  workout,
  onExit,
  resumeFrom,
  askCheckIn = false,
  onCheckInAnswered,
}: {
  workout: Workout
  onExit: () => void
  resumeFrom?: SessionDraft | null
  askCheckIn?: boolean
  onCheckInAnswered?: (c: CheckIn) => void
}) {
  const { state, dispatch } = useStore()
  const [phase, setPhase] = useState<Phase>(
    resumeFrom
      ? resumeFrom.phase === 'summary'
        ? 'summary'
        : resumeFrom.phase === 'rest' && (resumeFrom.restEndsAt ?? 0) > Date.now()
          ? 'rest'
          : 'ready'
      : 'intro',
  )
  const [bi, setBi] = useState(resumeFrom?.blockIndex ?? 0)
  const [si, setSi] = useState(resumeFrom?.setIndex ?? 0)
  const [logs, setLogs] = useState<SetLog[]>(resumeFrom?.logs ?? [])
  const [now, setNow] = useState(() => Date.now())
  const [leadEnd, setLeadEnd] = useState(0)
  const [holdStart, setHoldStart] = useState(0)
  const [restEnd, setRestEnd] = useState(resumeFrom?.restEndsAt ?? 0)
  /** Duration the current rest was started with — the ring's denominator. */
  const [restTotal, setRestTotal] = useState(resumeFrom?.restTotal ?? 0)
  const [pendingReps, setPendingReps] = useState(0)
  const [rpe, setRpe] = useState<number | undefined>(resumeFrom?.rpe)
  const [notes, setNotes] = useState(resumeFrom?.notes ?? '')
  /** Seconds from a hold that was cut short by the page being discarded. */
  const [interrupted, setInterrupted] = useState<number | null>(
    resumeFrom?.interrupted !== undefined
      ? resumeFrom.interrupted
      : resumeFrom?.wasHolding && resumeFrom.holdElapsed > 1
      ? Math.max(0, Math.round((resumeFrom.holdElapsed - state.settings.stopLatencySec) * 10) / 10)
      : null,
  )
  const [events, setEvents] = useState<SessionEvents | null>(null)
  const [savedSession, setSavedSession] = useState<Session | null>(null)
  const [confirmExit, setConfirmExit] = useState(false)
  const [showDemo, setShowDemo] = useState(false)
  const [showRpeHelp, setShowRpeHelp] = useState(false)
  const [checkIn, setCheckIn] = useState<CheckIn | null>(resumeFrom?.checkIn ?? null)
  const [cameraOn, setCameraOn] = useState(state.settings.recordForm)
  const [pendingClip, setPendingClip] = useState<{ key: string; logAt: number } | null>(null)
  const [clipFinalizing, setClipFinalizing] = useState(false)
  const [analysingSets, setAnalysingSets] = useState<Set<number>>(() => new Set())
  const recorder = useFormRecorder()
  const [showCheckIn, setShowCheckIn] = useState(askCheckIn && !resumeFrom)
  const [insight, setInsight] = useState<{ delta: number; label: string } | null>(null)
  const [debrief, setDebrief] = useState<CoachDecision[]>([])
  const startedAtRef = useRef(resumeFrom?.startedAt ?? Date.now())
  const lastBeepRef = useRef(-1)
  const targetHitRef = useRef(false)
  const lastCountRef = useRef(-1)
  const prBuzzedRef = useRef(false)
  /** Hold elapsed frozen at the moment the page was hidden. */
  const frozenElapsedRef = useRef<number | null>(null)
  /** Current phase, readable from async callbacks without going stale. */
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  /**
   * The exact set the interrupted hold belongs to. Without this the recovery
   * card would follow you to later exercises and could log a planche hold as
   * reps of whatever came next.
   */
  const interruptedAt = useRef(
    resumeFrom?.interruptedAt ?? (resumeFrom ? { bi: resumeFrom.blockIndex, si: resumeFrom.setIndex } : null),
  )

  useWakeLock(phase !== 'summary' && phase !== 'celebrate')

  const block = workout.blocks[bi]
  const exercise = block ? EXERCISE_BY_ID[block.exerciseId] : undefined
  /** Raw rounds, which is what the progress bar and the "n/N sets" counter track. */
  const totalSets = useMemo(() => workout.blocks.reduce((n, b) => n + b.sets, 0), [workout])
  const doneSets = logs.length
  /**
   * Unilateral work runs twice per set — left then right — so both sides get
   * the same dose. The set counter still shows the real number of rounds.
   */
  const perSide = Boolean(exercise?.perSide)
  const side: 'left' | 'right' = si % 2 === 0 ? 'left' : 'right'
  const roundsPerSet = perSide ? 2 : 1
  const displaySet = Math.floor(si / roundsPerSet) + 1
  const displayTotal = block ? Math.ceil(block.sets / roundsPerSet) : 0
  // The record to beat includes anything already set earlier in this session,
  // otherwise a second, weaker set would celebrate as a PR too.
  const bestBefore = useMemo(() => {
    if (!exercise) return undefined
    const stored = state.prs[exercise.id]?.value
    const thisSession = logs.reduce((b, l) => (l.exerciseId === exercise.id && l.value > b ? l.value : b), 0)
    if (stored === undefined && thisSession === 0) return undefined
    return Math.max(stored ?? 0, thisSession)
  }, [exercise, state.prs, logs])
  const latency = exercise?.type === 'hold' ? Math.max(0, state.settings.stopLatencySec) : 0
  // Film every key hold on the road. Most use pose geometry; Frog Stand keeps
  // the replay for an explicit checklist review instead.
  const filmable = Boolean(block?.section === 'main' && exercise && isFilmable(exercise.id))
  const filming = Boolean(filmable && cameraOn && recorder.supported)

  // Spin the pose model up while the athlete is still getting into position,
  // so an automatic check lands right after the clip instead of stalling on
  // the model load.
  useEffect(() => {
    if (filming && state.settings.autoAnalyze && exercise?.id !== 'frog-stand') warmDetector()
  }, [filming, state.settings.autoAnalyze, exercise?.id])

  // Shared 100ms clock (also keeps the header session-elapsed ticking).
  useEffect(() => {
    if (phase === 'summary' || phase === 'celebrate') return
    const t = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(t)
  }, [phase])

  const leadRemaining = Math.max(0, (leadEnd - now) / 1000)
  const holdElapsed = phase === 'hold' ? Math.max(0, (now - holdStart) / 1000) : 0
  /**
   * What the hold will actually be logged as. Cues fire on this rather than
   * the raw stopwatch, so a PR or a target can never be earned by the gap
   * between coming out of the position and reaching the button.
   */
  const holdCredited = Math.max(0, holdElapsed - latency)
  const restRemaining = Math.max(0, (restEnd - now) / 1000)

  // Mirror the live session to storage on every meaningful change, and again
  // the instant the page is hidden — a backgrounded tab can be discarded by
  // the OS without warning, and this is what makes that survivable.
  useEffect(() => {
    if (phase === 'celebrate') return
    const snapshot = () => {
      // Once the screen is off the athlete is no longer holding, so the
      // elapsed value is frozen at the moment the page was hidden rather
      // than left to climb while the tab is torn down.
      const live = Math.max(0, (Date.now() - holdStart) / 1000)
      const elapsed = phase === 'hold' ? (frozenElapsedRef.current ?? live) : 0
      saveDraft({
        workout,
        startedAt: startedAtRef.current,
        blockIndex: bi,
        setIndex: si,
        logs,
        wasHolding: phase === 'hold',
        holdElapsed: elapsed,
        restEndsAt: phase === 'rest' ? restEnd : null,
        restTotal,
        ...(checkIn ? { checkIn } : {}),
        phase: phase === 'rest' || phase === 'summary' ? phase : 'ready',
        ...(interrupted !== null && interruptedAt.current
          ? { interrupted, interruptedAt: interruptedAt.current }
          : {}),
        rpe,
        notes,
      })
    }
    snapshot()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (phase === 'hold') {
          const raw = Math.max(0, (Date.now() - holdStart) / 1000)
          frozenElapsedRef.current = raw
          setInterrupted(Math.max(0, Math.round((raw - latency) * 10) / 10))
          interruptedAt.current = { bi, si }
          // Hidden time is unknowable. End the attempt now rather than letting
          // a locked phone manufacture a PR; the athlete can log or redo it.
          if (filming) {
            setCameraOn(false)
            void recorder.stop().finally(() => recorder.release())
          }
          setPhase('ready')
        }
        snapshot()
      } else {
        frozenElapsedRef.current = null
      }
    }
    const onPageHide = () => {
      if (phase === 'hold' && frozenElapsedRef.current === null) {
        frozenElapsedRef.current = Math.max(0, (Date.now() - holdStart) / 1000)
      }
      snapshot()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    // Keep the live value fresh while visible, so an abrupt kill still
    // recovers a realistic number.
    const iv =
      phase === 'hold'
        ? window.setInterval(() => {
            if (document.visibilityState === 'visible') snapshot()
          }, 2000)
        : undefined
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      if (iv) window.clearInterval(iv)
    }
  }, [
    phase,
    bi,
    si,
    logs,
    holdStart,
    restEnd,
    restTotal,
    rpe,
    notes,
    workout,
    latency,
    filming,
    recorder,
    interrupted,
    checkIn,
  ])

  useEffect(() => {
    if (resumeFrom) pushToast('Session restored — nothing was lost.', 'success', 4500)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Open the camera while setting up so the shot can be framed, and close it
  // again as soon as filming is not imminent — no stray camera light.
  // A clip belongs to the set that was just rated. Leaving the rest screen
  // without rating discards it rather than carrying it to the next exercise.
  useEffect(() => {
    if (phase !== 'rest' && phase !== 'summary') setPendingClip(null)
  }, [phase])

  const { prepare: prepareCamera, release: releaseCamera } = recorder
  useEffect(() => {
    if (phase === 'ready' && filming) void prepareCamera()
    else if (phase !== 'lead' && phase !== 'hold' && phase !== 'ready') releaseCamera()
  }, [phase, filming, prepareCamera, releaseCamera])

  // Countdown cues for lead-in and rest: spoken when voice is on, ticks otherwise.
  useEffect(() => {
    if (phase !== 'lead' && phase !== 'rest') return
    const remaining = phase === 'lead' ? leadRemaining : restRemaining
    const whole = Math.ceil(remaining)
    if (whole <= 3 && whole >= 1 && whole !== lastBeepRef.current) {
      lastBeepRef.current = whole
      if (state.settings.voice) speak(String(whole))
      else if (state.settings.beeps) sfx.tick()
    }
  }, [phase, leadRemaining, restRemaining, state.settings.beeps, state.settings.voice])

  // Lead-in finished → the hold starts.
  useEffect(() => {
    if (phase === 'lead' && leadRemaining <= 0) {
      sfx.go()
      // Recording starts with the hold, not with the lead-in. Filming the
      // walk into position put upright frames inside the analysed window,
      // and a single standing frame reads as perfectly locked arms.
      if (filming) void recorder.start()
      if (state.settings.voice) speak('Go')
      targetHitRef.current = false
      lastCountRef.current = -1
      prBuzzedRef.current = false
      setHoldStart(Date.now())
      setPhase('hold')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, leadRemaining, state.settings.voice, filming])

  // Rest finished → back to ready.
  useEffect(() => {
    if (phase === 'rest' && restRemaining <= 0) {
      sfx.go()
      if (state.settings.voice) speak('Rest over')
      lastBeepRef.current = -1
      setPhase('ready')
    }
  }, [phase, restRemaining, state.settings.voice])

  // Chime + announce when the target is reached mid-hold.
  useEffect(() => {
    if (phase !== 'hold' || !block || block.target.kind !== 'hold') return
    if (!targetHitRef.current && holdCredited >= block.target.sec) {
      targetHitRef.current = true
      sfx.target()
      buzz(40)
      if (state.settings.voice) speak('Target')
    }
  }, [phase, holdCredited, block, state.settings.voice])

  // Spoken 5-second counts mid-hold — the screen is unreadable upside-down.
  useEffect(() => {
    if (phase !== 'hold' || !state.settings.voice || !block) return
    const whole = Math.floor(holdCredited)
    const target = block.target.kind === 'hold' ? block.target.sec : 0
    if (whole >= 5 && whole % 5 === 0 && whole !== target && whole !== lastCountRef.current) {
      lastCountRef.current = whole
      speak(String(whole))
    }
  }, [phase, holdCredited, block, state.settings.voice])

  // Haptic pulse the moment a live hold becomes a PR.
  useEffect(() => {
    if (phase !== 'hold' || prBuzzedRef.current) return
    if (bestBefore !== undefined && holdCredited > bestBefore) {
      prBuzzedRef.current = true
      buzz([30, 40, 30])
    }
  }, [phase, holdCredited, bestBefore])

  const advance = useCallback(
    (withRest: boolean) => {
      lastBeepRef.current = -1
      const b = workout.blocks[bi]
      const isLastSet = si + 1 >= b.sets
      const isLastBlock = bi + 1 >= workout.blocks.length
      if (isLastSet && isLastBlock) {
        setPhase('summary')
        return
      }
      if (isLastSet) {
        setBi(bi + 1)
        setSi(0)
      } else {
        setSi(si + 1)
      }
      if (withRest) {
        // Both taken from the block just finished; the index has already moved
        // on, so reading it later would mix two different blocks' rests.
        setRestEnd(Date.now() + b.restSec * 1000)
        setRestTotal(b.restSec)
        setPhase('rest')
      } else {
        setPhase('ready')
      }
    },
    [bi, si, workout],
  )

  const logSet = useCallback(
    (value: number, raw?: number, at = Date.now()) => {
      if (!block || !exercise) return
      setLogs((l) => [
        ...l,
        {
          exerciseId: exercise.id,
          kind: exercise.type,
          value,
          ...(raw !== undefined && Math.abs(raw - value) > 0.05 ? { raw } : {}),
          ...(exercise.perSide ? { side } : {}),
          target: block.target.kind === 'hold' ? block.target.sec : block.target.reps,
          section: block.section,
          at,
        },
      ])
      advance(true)
    },
    [block, exercise, advance, side],
  )

  const stopHold = useCallback(() => {
    const raw = Math.round(((Date.now() - holdStart) / 1000) * 10) / 10
    // You come out of the hold, then reach for the button. That gap is time
    // you were not actually holding, so it comes back off.
    const v = Math.max(0, Math.round((raw - latency) * 10) / 10)
    sfx.stop()
    if (bestBefore !== undefined && v > bestBefore) sfx.pr()
    const loggedAt = Date.now()
    if (filming && exercise) {
      const exId = exercise.id
      setClipFinalizing(true)
      void recorder
        .stop()
        .then(async (blob) => {
          if (!blob) return
          const key = await saveClip(exId, blob, v)
          if (key) {
            // Attach the clip immediately, even if the rest screen is skipped.
            // Summary can still run the required review on this exact set.
            setLogs((current) =>
              current.map((log) => (log.at === loggedAt ? { ...log, clipKey: key } : log)),
            )
          }
          // Only offer it on the screen that rates that very set — otherwise it
          // would surface under a later, unrelated exercise.
          const ratable = phaseRef.current === 'rest' || phaseRef.current === 'summary'
          setPendingClip(key && ratable ? { key, logAt: loggedAt } : null)
          if (!key) pushToast('The clip could not be saved. Your set is still logged.', 'danger', 5000)
        })
        .finally(() => setClipFinalizing(false))
    }
    logSet(v, raw, loggedAt)
  }, [holdStart, logSet, bestBefore, latency, filming, exercise, recorder])

  const beginSet = useCallback(() => {
    if (!block || !exercise) return
    lastBeepRef.current = -1
    if (exercise.type === 'hold') {
      setLeadEnd(Date.now() + LEAD_SEC * 1000)
      setPhase('lead')
    } else {
      setPendingReps(block.target.kind === 'reps' ? block.target.reps : 0)
      setPhase('reps')
    }
  }, [block, exercise, filming, recorder])

  // Skipping a unilateral round skips its partner too, so a set never ends up
  // trained on one side only.
  const skipSet = useCallback(() => {
    if (perSide && si % 2 === 0 && block && si + 1 < block.sets) {
      // Advance normally when this is the final pair; directly adding two
      // would leave the index past the end of the same block.
      if (si + 2 >= block.sets) advance(false)
      else {
        setSi(si + 2)
        setPhase('ready')
      }
      return
    }
    advance(false)
  }, [advance, perSide, si, block])

  const skipBlock = useCallback(() => {
    lastBeepRef.current = -1
    if (bi + 1 >= workout.blocks.length) {
      setPhase('summary')
    } else {
      setBi(bi + 1)
      setSi(0)
      setPhase('ready')
    }
  }, [bi, workout])

  /** Attach form to the exact set that produced it, even after navigation. */
  const setFormForLog = useCallback((at: number, form: FormCheck) => {
    setLogs((current) => current.map((log) => (log.at === at ? { ...log, form } : log)))
  }, [])

  const setAnalysisBusy = useCallback((at: number, busy: boolean) => {
    setAnalysingSets((current) => {
      const next = new Set(current)
      if (busy) next.add(at)
      else next.delete(at)
      return next
    })
  }, [])

  const adjustLastLog = useCallback((delta: number) => {
    setLogs((l) => {
      if (l.length === 0) return l
      const last = l[l.length - 1]
      const value = Math.max(0, Math.round((last.value + delta) * 10) / 10)
      // Hand-edited now, so the original stopwatch reading no longer explains
      // it — keeping it would render a nonsense negative reaction time.
      const { raw: _dropped, ...rest } = last
      void _dropped
      return [...l.slice(0, -1), { ...rest, value }]
    })
  }, [])

  const save = useCallback(() => {
    const session: Session = {
      id: crypto.randomUUID(),
      startedAt: startedAtRef.current,
      endedAt: Date.now(),
      workoutName: workout.name,
      workoutKind: workout.kind,
      stepId: state.stepId,
      sets: logs,
      rpe,
      notes: notes.trim() || undefined,
      strategy: workout.strategy,
      checkIn: checkIn ?? undefined,
    }
    const { next, events: raw } = applySession(state, session)
    // The coach reacts to every finished session, whatever kind it was.
    const targetBefore = adaptiveTarget(state, state.stepId)
    const targetAfter = next.stepId === state.stepId ? adaptiveTarget(next, next.stepId) : undefined
    setDebrief(debriefSession(state, next, session, { before: targetBefore, after: targetAfter }))
    // First-ever values on accessories are technically PRs but not worth a
    // party — celebrate improvements, plus any first planche-line numbers.
    const ev: SessionEvents = {
      ...raw,
      prs: raw.prs.filter(
        (p) => p.previous !== undefined || EXERCISE_BY_ID[p.exerciseId]?.category === 'planche',
      ),
    }
    // Compare against the last run of this same workout.
    const plancheHold = (s: Session) =>
      Math.round(
        s.sets
          .filter((x) => x.kind === 'hold' && EXERCISE_BY_ID[x.exerciseId]?.category === 'planche')
          .reduce((t, x) => t + x.value, 0),
      )
    const prevSame = [...state.sessions]
      .filter((s) => s.workoutName === workout.name)
      .sort((a, b) => b.startedAt - a.startedAt)[0]
    if (prevSame) {
      const delta = plancheHold(session) - plancheHold(prevSame)
      setInsight({
        delta,
        label:
          delta >= 0
            ? `+${delta}s planche hold time vs your last ${workout.name}`
            : `${delta}s planche hold time vs last time — down days are part of it`,
      })
    }
    dispatch({ type: 'SAVE_SESSION', session })
    clearDraft()
    setEvents(ev)
    setSavedSession(session)
    setPhase('celebrate')
    sfx.done()
    if (ev.unlockedStep) confetti(2)
    else if (ev.prs.length > 0) confetti(1)
  }, [workout, state, logs, rpe, notes, dispatch])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      // A dialog is on top: let it own the keyboard, or Escape would also open
      // the exit prompt and Space would start the set behind the overlay.
      if (document.querySelector('[role="dialog"]')) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (phase === 'intro') setPhase('ready')
        else if (phase === 'ready') beginSet()
        else if (phase === 'hold') stopHold()
        else if (phase === 'reps') logSet(pendingReps)
      } else if (e.key.toLowerCase() === 's' && phase === 'rest') {
        setRestEnd(Date.now())
      } else if (e.key === 'Escape' && phase !== 'celebrate') {
        setConfirmExit(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, beginSet, stopHold, logSet, pendingReps])

  const sessionElapsed = Math.max(0, (now - startedAtRef.current) / 1000)
  const lastLog = logs[logs.length - 1]

  const holdSecTotal = Math.round(logs.filter((l) => l.kind === 'hold').reduce((t, l) => t + l.value, 0))

  // ————— Render helpers —————

  const header = (
    <div className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-8">
      <div className="min-w-0">
        <div className="truncate font-display text-[15px] font-semibold text-ink">{workout.name}</div>
        <div className="text-[12.5px] text-ink3 tnum">
          {doneSets}/{totalSets} sets · {fmtClock(sessionElapsed)}
        </div>
      </div>
      <button
        onClick={() => {
          if (phase === 'summary' || phase === 'celebrate') {
            // Leaving a finished session without saving discards it, so the
            // draft must go too or it reopens on next launch.
            clearDraft()
            onExit()
          } else {
            setConfirmExit(true)
          }
        }}
        aria-label="Exit session"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink2 hover:text-ink"
      >
        <Icon name="x" size={17} />
      </button>
    </div>
  )

  const progressBar = (
    <div className="mx-5 mt-3 h-1 overflow-hidden rounded-full bg-line sm:mx-8">
      <div
        className="h-full rounded-full bg-accent transition-all duration-500"
        style={{ width: `${(doneSets / Math.max(1, totalSets)) * 100}%` }}
      />
    </div>
  )

  function body() {
    if (phase === 'intro') {
      const sections = [...new Set(workout.blocks.map((b) => b.section))]
      // Say up front that filming happens — it only appears once the main
      // work starts, which is several sets in and easy to be surprised by.
      const willFilm =
        cameraOn && recorder.supported && workout.blocks.some((b) => b.section === 'main' && isFilmable(b.exerciseId))
      return (
        <div className="mx-auto w-full max-w-lg px-5 pb-10">
          <div className="mt-6 rounded-3xl border border-line bg-surface p-6 shadow-card">
            <div className="text-[13px] font-medium uppercase tracking-wide text-ink3">Up next</div>
            <h1 className="mt-1 font-display text-[26px] font-bold text-ink">{workout.name}</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink2">{workout.focus}</p>
            <div className="mt-4 space-y-4">
              {sections.map((sec) => (
                <div key={sec}>
                  <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink3">
                    {SECTION_LABEL[sec]}
                  </div>
                  <div className="space-y-1">
                    {workout.blocks
                      .filter((b) => b.section === sec)
                      .map((b, i) => {
                        const ex = EXERCISE_BY_ID[b.exerciseId]
                        return (
                          <div key={i} className="flex items-baseline justify-between gap-3 text-[14px]">
                            <span className="text-ink">{ex.name}</span>
                            <span className="shrink-0 text-ink2 tnum">{describeBlock(b)}</span>
                          </div>
                        )
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {willFilm ? (
            <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3 text-left">
              <Icon name="monitor" size={16} className="mt-0.5 shrink-0 text-accent" />
              <div>
                <div className="text-[13.5px] font-medium text-ink">Your main sets will be filmed</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink2">
                  Stand your phone side-on when you reach the main work — a preview and a level guide appear before
                  each set, and you can switch the camera off there or in Settings.
                </p>
              </div>
            </div>
          ) : null}
          <button
            onClick={() => setPhase('ready')}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 font-display text-[17px] font-semibold text-on-accent shadow-card transition hover:brightness-105 active:scale-[0.99]"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            <Icon name="play" size={18} /> Begin session
          </button>
          <div className="mt-3 text-center text-[12.5px] text-ink3">Space = start / stop · S = skip rest · Esc = exit</div>
        </div>
      )
    }

    if (!block || !exercise) return null

    if (phase === 'ready') {
      const isHold = exercise.type === 'hold'
      const target = block.target.kind === 'hold' ? `${block.target.sec}s` : `${block.target.reps} reps`
      return (
        <div className="mx-auto w-full max-w-lg px-5 pb-10 text-center">
          <div className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-accent">
            {SECTION_LABEL[block.section]} · Set {displaySet} of {displayTotal}
          </div>
          <h1 className="mt-1 font-display text-[30px] font-bold leading-tight text-ink">{exercise.name}</h1>
          {perSide ? (
            <div className="mt-1.5 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3.5 py-1 text-[14px] font-semibold text-accent">
              {side === 'left' ? 'Left side' : 'Right side'}
              <span className="text-[12px] font-normal text-ink2">
                {side === 'left' ? 'then you’ll do the right' : 'second half of this set'}
              </span>
            </div>
          ) : null}
          <div className="mt-1 text-[15px] text-ink2 tnum">
            Target {target}
            {perSide ? ' this side' : ''}
            {bestBefore ? ` · Best ${exercise.type === 'hold' ? fmtHold(bestBefore) : `${bestBefore} reps`}` : ''}
          </div>
          {exercise.category === 'planche' ? (
            <Figure step={figureFor(exercise.id)} className="mx-auto mt-2 h-36 w-44 text-ink" />
          ) : (
            <div className="mt-6" />
          )}
          {interrupted !== null &&
          interruptedAt.current?.bi === bi &&
          interruptedAt.current?.si === si ? (
            <div className="mx-auto mt-3 max-w-sm rounded-2xl border border-accent/30 bg-accent-soft p-4 text-left">
              <div className="text-[13.5px] font-semibold text-ink">Your last hold was interrupted</div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink2">
                Your phone locked mid-set. It had reached{' '}
                <span className="font-semibold text-ink tnum">{fmtHold(interrupted)}</span> — log it, or redo the set.
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={() => {
                    // No button was pressed to end this one, so there is no
                    // reaction delay to subtract.
                    logSet(interrupted)
                    setInterrupted(null)
                    interruptedAt.current = null
                  }}
                  className="flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold text-on-accent"
                  style={{ background: 'var(--t-btn-accent)' }}
                >
                  Log {fmtHold(interrupted)}
                </button>
                <button
                  onClick={() => {
                    setInterrupted(null)
                    interruptedAt.current = null
                  }}
                  className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink2 hover:text-ink"
                >
                  Redo the set
                </button>
              </div>
            </div>
          ) : null}
          <div className="mx-auto mt-2 max-w-sm space-y-1.5">
            {exercise.cues.slice(0, 3).map((c) => (
              <div key={c} className="rounded-xl border border-line bg-surface px-4 py-2 text-[13.5px] text-ink2">
                {c}
              </div>
            ))}
            {block.note ? (
              <div className="rounded-xl border border-accent/25 bg-accent-soft px-4 py-2 text-[13.5px] text-ink">
                {block.note}
              </div>
            ) : null}
          </div>
          {filmable && recorder.supported ? (
            <div className="mx-auto mt-3 w-full max-w-sm">
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5">
                <span className="flex items-center gap-2 text-[13.5px] text-ink2">
                  <Icon name="monitor" size={15} className={cameraOn ? 'text-accent' : 'text-ink3'} />
                  {cameraOn ? 'Filming this set' : 'Camera off'}
                </span>
                <button
                  onClick={() => {
                    const next = !cameraOn
                    setCameraOn(next)
                    if (next) void recorder.prepare()
                    else recorder.release()
                  }}
                  role="switch"
                  aria-checked={cameraOn}
                  aria-label="Film this set"
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${cameraOn ? 'bg-accent' : 'bg-line-strong'}`}
                >
                  <span
                    className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${cameraOn ? 'left-6' : 'left-1'}`}
                  />
                </button>
              </div>
              {cameraOn ? (
                <div className="relative mt-2 overflow-hidden rounded-2xl border border-line bg-black">
                  <video
                    ref={recorder.videoRef}
                    muted
                    playsInline
                    className="h-40 w-full object-contain"
                  />
                  <div className="pointer-events-none absolute inset-[8%] rounded-xl border border-dashed border-accent/70" />
                  <div className="pointer-events-none absolute inset-x-[8%] top-1/2 h-px bg-accent/60" />
                  <div className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-1.5 text-[11.5px] text-white/85">
                    Side-on · whole body and both hands inside the box · phone level.
                  </div>
                </div>
              ) : null}
              {recorder.status === 'denied' ? (
                <p className="mt-1.5 text-[12.5px] text-danger">
                  Camera access was blocked. Allow it in your browser settings, or leave this off.
                </p>
              ) : null}
              {recorder.status === 'unsupported' ? (
                <p className="mt-1.5 text-[12.5px] text-danger">
                  This browser could not start a compatible video recorder. Your sets still log normally.
                </p>
              ) : null}
            </div>
          ) : null}
          <button
            onClick={beginSet}
            className="mt-6 inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl px-6 py-4 font-display text-[17px] font-semibold text-on-accent shadow-card transition hover:brightness-105 active:scale-[0.99]"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            <Icon name="play" size={18} />
            {isHold ? `Start · ${LEAD_SEC}s lead-in` : 'Begin set'}
          </button>
          <div className="mt-3 flex flex-wrap justify-center gap-5 text-[13px]">
            <button onClick={() => setShowDemo(true)} className="text-accent underline-offset-2 hover:underline">
              How do I do this?
            </button>
            <button onClick={skipSet} className="text-ink3 underline-offset-2 hover:text-ink hover:underline">
              Skip set
            </button>
            <button onClick={skipBlock} className="text-ink3 underline-offset-2 hover:text-ink hover:underline">
              Skip exercise
            </button>
          </div>
        </div>
      )
    }

    if (phase === 'lead') {
      const n = Math.ceil(leadRemaining)
      return (
        <div className="mx-auto flex w-full max-w-lg flex-col items-center px-5 pb-10 text-center">
          <div className="mt-6 text-[14px] font-medium uppercase tracking-wide text-ink2">Get into position</div>
          <div className="relative mt-2 grid h-56 w-56 place-items-center">
            <div className="absolute inset-0 rounded-full bg-accent-soft blur-2xl" />
            <div key={n} className="font-timer relative text-[130px] leading-none text-accent animate-pop-num">
              {n}
            </div>
          </div>
          <div className="text-[15px] font-medium text-ink2">{exercise.name}</div>
          <button
            onClick={() => setLeadEnd(Date.now())}
            className="mt-8 rounded-xl border border-line bg-surface px-5 py-2.5 text-[14px] font-medium text-ink2 hover:text-ink"
          >
            Skip lead-in
          </button>
        </div>
      )
    }

    if (phase === 'hold') {
      const target = block.target.kind === 'hold' ? block.target.sec : 0
      const overTarget = holdCredited >= target
      const isPr = bestBefore !== undefined && holdCredited > bestBefore
      return (
        <div className="mx-auto flex w-full max-w-lg flex-col items-center px-5 pb-10 text-center">
          <div className="mt-2 text-[14px] font-medium text-ink2">
            {exercise.name} · Set {displaySet}/{displayTotal}
            {perSide ? ` · ${side === 'left' ? 'Left' : 'Right'}` : ''}
          </div>
          <div className="relative mt-4">
            <div className="pointer-events-none absolute inset-6 rounded-full bg-accent-soft blur-3xl" />
            <ProgressRing
              value={Math.min(1, holdCredited / Math.max(1, target))}
              size={290}
              stroke={13}
              glow
              color={isPr ? 'var(--t-ok)' : overTarget ? 'var(--t-ok)' : undefined}
              className="relative"
            >
              <div>
                <div
                  className={`font-timer text-[72px] leading-none ${
                    isPr || overTarget ? 'text-ok' : 'text-ink'
                  }`}
                >
                  {holdElapsed.toFixed(1)}
                </div>
                <div className="mt-1.5 text-[14px] font-semibold">
                  {isPr ? (
                    <span className="text-ok">PR secured — exit under control</span>
                  ) : overTarget ? (
                    <span className="text-ok">target reached — stop while clean</span>
                  ) : (
                    <span className="text-ink3 tnum">target {target}s</span>
                  )}
                </div>
                {latency > 0 ? (
                  <div className="mt-0.5 text-[11.5px] text-ink3 tnum">counts as {holdCredited.toFixed(1)}s</div>
                ) : null}
              </div>
            </ProgressRing>
          </div>
          <button
            onClick={stopHold}
            className="mt-8 inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-danger px-6 py-5 font-display text-[18px] font-semibold text-white shadow-card transition active:scale-[0.99]"
          >
            <Icon name="stop" size={18} /> Stop hold
          </button>
          <div className="mt-3 text-[12.5px] text-ink3">or press Space</div>
        </div>
      )
    }

    if (phase === 'reps') {
      return (
        <div className="mx-auto flex w-full max-w-lg flex-col items-center px-5 pb-10 text-center">
          <div className="mt-4 text-[14px] font-medium text-ink2">
            {exercise.name} · Set {displaySet}/{displayTotal}
            {perSide ? ` · ${side === 'left' ? 'Left' : 'Right'}` : ''}
          </div>
          <div className="mt-2 text-[15px] text-ink2">Do your set, then log the reps.</div>
          <div className="mt-6 flex items-center gap-5">
            <button
              onClick={() => setPendingReps((r) => Math.max(0, r - 1))}
              aria-label="Fewer reps"
              className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface text-ink hover:border-line-strong"
            >
              <Icon name="minus" size={20} />
            </button>
            <div className="w-32 font-display text-[80px] font-bold leading-none text-ink tnum">{pendingReps}</div>
            <button
              onClick={() => setPendingReps((r) => r + 1)}
              aria-label="More reps"
              className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface text-ink hover:border-line-strong"
            >
              <Icon name="plus" size={20} />
            </button>
          </div>
          <div className="mt-1 text-[13px] text-ink3 tnum">
            target {block.target.kind === 'reps' ? block.target.reps : 0}
          </div>
          <button
            onClick={() => logSet(pendingReps)}
            className="mt-8 inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl px-6 py-4 font-display text-[17px] font-semibold text-on-accent shadow-card transition hover:brightness-105 active:scale-[0.99]"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            <Icon name="check" size={18} /> Log {pendingReps} reps
          </button>
        </div>
      )
    }

    if (phase === 'rest') {
      const nb = workout.blocks[bi]
      const nx = EXERCISE_BY_ID[nb.exerciseId]
      const total = restTotal || nb.restSec
      return (
        <div className="mx-auto flex w-full max-w-lg flex-col items-center px-5 pb-10 text-center">
          <div className="mt-4 text-[14px] font-medium uppercase tracking-wide text-ink3">Rest</div>
          <ProgressRing value={restRemaining / Math.max(1, total)} size={210} stroke={10} className="mt-4">
            <div>
              <div className="font-timer text-[54px] leading-none text-ink">{fmtClock(restRemaining)}</div>
            </div>
          </ProgressRing>
          {lastLog ? (
            <div className="mt-5 flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border border-line bg-surface px-4 py-2 text-[13.5px] text-ink2">
              Logged {lastLog.kind === 'hold' ? fmtHold(lastLog.value) : `${lastLog.value} reps`}
              {lastLog.raw !== undefined ? (
                <span className="text-[12px] text-ink3 tnum">
                  ({lastLog.raw.toFixed(1)}s − {(lastLog.raw - lastLog.value).toFixed(1)}s reaction)
                </span>
              ) : null}
              <span className="flex gap-1">
                <button
                  onClick={() => adjustLastLog(-1)}
                  aria-label="Decrease logged value"
                  className="grid h-7 w-7 place-items-center rounded-full border border-line bg-raised text-ink2 hover:text-ink"
                >
                  <Icon name="minus" size={13} />
                </button>
                <button
                  onClick={() => adjustLastLog(1)}
                  aria-label="Increase logged value"
                  className="grid h-7 w-7 place-items-center rounded-full border border-line bg-raised text-ink2 hover:text-ink"
                >
                  <Icon name="plus" size={13} />
                </button>
              </span>
            </div>
          ) : null}
          {lastLog?.kind === 'hold' &&
          lastLog.section === 'main' &&
          (lastLog.exerciseId === STEP_BY_ID[state.stepId].keyExerciseId || isFilmable(lastLog.exerciseId)) ? (
            <FormCheckRow
              key={lastLog.at}
              clipKey={
                pendingClip?.logAt === lastLog.at
                  ? pendingClip.key
                  : (lastLog.clipKey ?? lastLog.form?.clipKey ?? null)
              }
              exerciseId={lastLog.exerciseId}
              creditedHoldSec={lastLog.value}
              value={lastLog.form}
              autoRun={state.settings.autoAnalyze}
              onDone={(form) => {
                setFormForLog(lastLog.at, form)
              }}
              onBusyChange={(busy) => setAnalysisBusy(lastLog.at, busy)}
            />
          ) : null}

          <div className="mt-5 text-[14px] text-ink2">
            Next: <span className="font-medium text-ink">{nx.name}</span>
            {nx.perSide ? (
              <>
                {' '}
                · <span className="font-medium text-ink">{si % 2 === 0 ? 'left' : 'right'} side</span>
              </>
            ) : null}{' '}
            · set {Math.floor(si / (nx.perSide ? 2 : 1)) + 1}/{Math.ceil(nb.sets / (nx.perSide ? 2 : 1))}
          </div>
          <div className="mt-5 flex gap-3">
            <button
              onClick={() => setRestEnd((e) => e + 30_000)}
              className="rounded-xl border border-line bg-surface px-5 py-2.5 text-[14px] font-medium text-ink2 hover:text-ink"
            >
              +30s
            </button>
            <button
              onClick={() => setRestEnd(Date.now())}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-5 py-2.5 text-[14px] font-medium text-ink2 hover:text-ink"
            >
              <Icon name="skip" size={15} /> Skip rest
            </button>
          </div>
        </div>
      )
    }

    if (phase === 'summary') {
      return (
        <div className="mx-auto w-full max-w-lg px-5 pb-10">
          <h1 className="mt-6 text-center font-display text-[26px] font-bold text-ink">Session done 🎉</h1>
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {[
              ['Duration', fmtClock(sessionElapsed)],
              ['Sets', String(doneSets)],
              ['Hold time', `${holdSecTotal}s`],
            ].map(([l, v]) => (
              <div key={l} className="rounded-2xl border border-line bg-surface p-3 text-center">
                <div className="text-[12px] text-ink3">{l}</div>
                <div className="font-display text-[20px] font-semibold text-ink tnum">{v}</div>
              </div>
            ))}
          </div>
          {(() => {
            // The last set of a session skips the rest screen entirely, so
            // without this its form would never get rated.
            const lastMain = [...logs]
              .reverse()
              .find(
                (l) =>
                  l.kind === 'hold' &&
                  l.section === 'main' &&
                  (l.exerciseId === STEP_BY_ID[state.stepId].keyExerciseId || isFilmable(l.exerciseId)),
              )
            if (!lastMain) return null
            const blocking = logs.filter((log) => setNeedsProgressionFormEvidence(log, state))
            const formLogs = [...blocking, lastMain].filter(
              (log, index, all) => all.findIndex((candidate) => candidate.at === log.at) === index,
            )
            return formLogs.map((log) => (
              <FormCheckRow
                key={log.at}
                clipKey={
                  pendingClip?.logAt === log.at
                    ? pendingClip.key
                    : (log.clipKey ?? log.form?.clipKey ?? null)
                }
                exerciseId={log.exerciseId}
                creditedHoldSec={log.value}
                value={log.form}
                autoRun={state.settings.autoAnalyze}
                onDone={(form) => {
                  setFormForLog(log.at, form)
                }}
                onBusyChange={(busy) => setAnalysisBusy(log.at, busy)}
              />
            ))
          })()}

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-center gap-2 text-[14px] font-medium text-ink">
              How hard was it? (RPE)
              <button
                onClick={() => setShowRpeHelp(true)}
                aria-label="What is RPE?"
                className="grid h-5 w-5 place-items-center rounded-full border border-line text-ink3 hover:text-ink"
              >
                <Icon name="info" size={12} />
              </button>
            </div>
            <div className="flex gap-2">
              {[6, 7, 8, 9, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setRpe(n)}
                  className={`flex-1 rounded-xl border py-2.5 font-display text-[16px] font-semibold transition ${
                    rpe === n
                      ? 'border-transparent bg-accent text-on-accent'
                      : 'border-line bg-surface text-ink2 hover:text-ink'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes — how did it feel? (optional)"
            rows={2}
            className="mt-4 w-full resize-none rounded-2xl border border-line bg-surface p-4 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
          />
          {logs.some((log) => setNeedsProgressionFormEvidence(log, state)) ? (
            <p className="mt-4 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-center text-[13px] text-ink">
              This unlock-level hold will still save as a PR, but mastery needs both your confirmed Clean rating and
              a passing filmed form check. One isolated camera flag may pass; two or more flags do not.
            </p>
          ) : null}
          {clipFinalizing || analysingSets.size > 0 ? (
            <p className="mt-3 text-center text-[12.5px] text-ink3" role="status">
              {clipFinalizing ? 'Finishing your clip…' : 'Finishing the form check…'}
            </p>
          ) : null}
          <button
            onClick={save}
            disabled={
              logs.length === 0 ||
              clipFinalizing ||
              analysingSets.size > 0
            }
            className="mt-4 w-full rounded-2xl px-6 py-4 font-display text-[17px] font-semibold text-on-accent shadow-card transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            Save session
          </button>
          <button
            onClick={() => setConfirmExit(true)}
            className="mt-2 w-full rounded-2xl py-3 text-[14px] font-medium text-ink3 hover:text-ink"
          >
            Discard
          </button>
          <p className="mt-2 text-center text-[12px] text-ink3">
            Unsaved sessions are not kept — save it to bank the work.
          </p>
        </div>
      )
    }

    if (phase === 'celebrate' && events && savedSession) {
      const unlocked = events.unlockedStep ? STEP_BY_ID[events.unlockedStep] : undefined
      return (
        <div className="mx-auto w-full max-w-lg px-5 pb-10 text-center">
          {unlocked ? (
            <div className="mt-6 rounded-3xl border border-accent/30 bg-accent-soft p-6">
              <div className="text-[13px] font-semibold uppercase tracking-wide text-accent">Step unlocked</div>
              <Figure step={unlocked.id} className="mx-auto mt-2 h-32 w-40 text-ink" />
              <div className="font-display text-[26px] font-bold text-ink">{unlocked.name}</div>
              <p className="mt-1 text-[14px] text-ink2">{unlocked.tagline}</p>
            </div>
          ) : (
            <h1 className="mt-8 font-display text-[26px] font-bold text-ink">Saved ✓</h1>
          )}
          {insight ? (
            <div
              className={`mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13.5px] font-medium ${
                insight.delta >= 0 ? 'border-ok/30 bg-ok-soft text-ink' : 'border-line bg-surface text-ink2'
              }`}
            >
              <Icon name="chart" size={15} className={insight.delta >= 0 ? 'text-ok' : 'text-ink3'} />
              {insight.label}
            </div>
          ) : null}
          {debrief.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-line bg-surface p-4 text-left">
              <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-accent">
                <Icon name="target" size={14} /> Coach's read
              </div>
              <ul className="space-y-1.5">
                {debrief.map((d) => (
                  <li key={d.text} className="flex gap-2 text-[13.5px] leading-relaxed">
                    <span
                      className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                        d.kind === 'warn' ? 'bg-danger' : d.kind === 'good' ? 'bg-ok' : 'bg-ink3'
                      }`}
                    />
                    <span className="text-ink2">{d.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {events.prs.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-line bg-surface p-4 text-left">
              <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink3">New records</div>
              {events.prs.map((p) => {
                const ex = EXERCISE_BY_ID[p.exerciseId]
                return (
                  <div key={p.exerciseId} className="flex items-baseline justify-between py-1 text-[14.5px]">
                    <span className="text-ink">{ex?.name ?? p.exerciseId}</span>
                    <span className="font-semibold text-accent tnum">
                      {ex?.type === 'hold' ? fmtHold(p.value) : `${p.value} reps`}
                      {p.previous !== undefined ? (
                        <span className="ml-1.5 font-normal text-ink3">
                          was {ex?.type === 'hold' ? fmtHold(p.previous) : p.previous}
                        </span>
                      ) : null}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : null}
          {events.achievements.length > 0 ? (
            <div className="mt-4 space-y-2">
              {events.achievements.map((id) => {
                const a = ACHIEVEMENT_BY_ID[id]
                return (
                  <div
                    key={id}
                    className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 text-left"
                  >
                    <div className="text-[26px]">{a.icon}</div>
                    <div>
                      <div className="text-[14.5px] font-semibold text-ink">{a.name}</div>
                      <div className="text-[13px] text-ink2">{a.desc}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}
          <button
            onClick={onExit}
            className="mt-6 w-full rounded-2xl px-6 py-4 font-display text-[17px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            Done
          </button>
        </div>
      )
    }
    return null
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-bg">
      <div className="app-ambient min-h-full pb-8">
        {header}
        {phase !== 'celebrate' ? progressBar : null}
        {body()}
      </div>
      <Modal open={showCheckIn} onClose={() => setShowCheckIn(false)}>
        <CheckInForm
          onDone={(c) => {
            setCheckIn(c)
            setShowCheckIn(false)
            // Re-plan today's session with the answers, not just tomorrow's.
            onCheckInAnswered?.(c)
            if (c.joints === 'pain') {
              pushToast("Today's session has been scaled back and intensity locked out.", 'info', 5500)
            } else if (c.joints === 'niggle') {
              pushToast('Adjusted — longer warm-up, no max-intensity work today.', 'info', 5000)
            } else if (c.energy === 'tired') {
              pushToast('Adjusted — trimmed volume so today still counts.', 'info', 4500)
            }
          }}
          onSkip={() => setShowCheckIn(false)}
        />
      </Modal>

      <Modal open={showDemo} onClose={() => setShowDemo(false)} wide>
        {exercise ? <DemoHelp exercise={exercise} pinnedUrl={state.videoLinks[exercise.id]} /> : null}
      </Modal>

      <Modal open={showRpeHelp} onClose={() => setShowRpeHelp(false)}>
        <div className="p-6">
          <h2 className="font-display text-[19px] font-semibold text-ink">What is RPE?</h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink2">
            Rate of Perceived Exertion — how hard the whole session felt. Be honest: the app uses it to decide how hard
            to make your next one.
          </p>
          <div className="mt-4 space-y-1.5 text-[13.5px]">
            {[
              ['6', 'Easy. Could have done a lot more.'],
              ['7', 'Comfortable. A few solid sets left.'],
              ['8', 'Hard but clean. The target for most days.'],
              ['9', 'Very hard. Form started to fray.'],
              ['10', 'Everything you had.'],
            ].map(([n, d]) => (
              <div key={n} className="flex gap-3 rounded-xl bg-raised px-3 py-2">
                <span className="font-display font-bold text-accent tnum">{n}</span>
                <span className="text-ink2">{d}</span>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Modal open={confirmExit} onClose={() => setConfirmExit(false)}>
        <div className="p-6">
          <h2 className="font-display text-[19px] font-semibold text-ink">Leave this session?</h2>
          <p className="mt-1.5 text-[14px] text-ink2">
            {logs.length > 0
              ? `You have ${logs.length} logged set${logs.length === 1 ? '' : 's'} that will be lost.`
              : 'Nothing has been logged yet.'}
          </p>
          <div className="mt-5 flex gap-2.5">
            <button
              onClick={() => setConfirmExit(false)}
              className="flex-1 rounded-xl border border-line bg-surface py-3 text-[14.5px] font-medium text-ink"
            >
              Keep training
            </button>
            <button
              onClick={() => {
                clearDraft()
                onExit()
              }}
              className="flex-1 rounded-xl bg-danger py-3 text-[14.5px] font-semibold text-white"
            >
              Leave
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export const FORM_ISSUE_LABEL: Record<FormIssue, string> = {
  arms: 'Elbows bent',
  scapula: 'Lost protraction',
  shrug: 'Shoulders shrugged',
  pike: 'Hips too high',
  sag: 'Hips too low',
  closed: 'Hips not open enough',
  knees: 'Knees bent',
  lean: 'Not enough lean',
  twist: 'Twisted / uneven',
  narrow: 'Straddle too narrow',
  hips: 'Hips sagged',
  level: 'Not level',
}

const COMMON_ISSUES: FormIssue[] = ['arms', 'scapula', 'shrug', 'pike', 'sag', 'lean', 'twist']
/** Only offered where they mean something — a lean has no straddle to narrow. */
const ISSUES_BY_EXERCISE: Record<string, FormIssue[]> = {
  'frog-stand': [],
  'adv-tuck-planche': [...COMMON_ISSUES, 'closed'],
  'one-leg-planche': [...COMMON_ISSUES, 'closed', 'knees'],
  'straddle-planche': [...COMMON_ISSUES, 'closed', 'knees', 'narrow'],
  'band-straddle-planche': [...COMMON_ISSUES, 'closed', 'knees', 'narrow'],
  'full-planche': [...COMMON_ISSUES, 'closed', 'knees'],
}

function issuesFor(exerciseId: string): { id: FormIssue; label: string }[] {
  return (ISSUES_BY_EXERCISE[exerciseId] ?? COMMON_ISSUES).map((id) => ({ id, label: FORM_ISSUE_LABEL[id] }))
}

/** Clips whose automatic analysis is currently running, across row instances. */
const autoAnalysisInFlight = new Set<string>()

/**
 * One tap for the common case, detail only when something went wrong. This is
 * the only signal the coach has about *quality* — without it, seconds earned
 * with bent arms look identical to clean ones.
 */
function FormCheckRow({
  clipKey,
  exerciseId,
  creditedHoldSec,
  value,
  autoRun,
  onDone,
  onBusyChange,
}: {
  clipKey: string | null
  exerciseId: string
  creditedHoldSec: number
  /** Already-saved rating, so the panel reflects it instead of looking blank. */
  value?: FormCheck
  /** Kick the analysis off unprompted once the clip is ready. */
  autoRun?: boolean
  onDone: (f: FormCheck) => void
  onBusyChange?: (busy: boolean) => void
}) {
  const [rating, setRating] = useState<FormRating | null>(value?.rating ?? null)
  const [issues, setIssues] = useState<FormIssue[]>(value?.issues ?? [])
  const [clipAvailable, setClipAvailable] = useState(false)
  const [analysis, setAnalysis] = useState<PoseFormResult | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [visualReviewPassed, setVisualReviewPassed] = useState(value?.visualReviewPassed === true)
  const autoRanRef = useRef(false)
  // Mirrors of rating/issues that async code can read after its awaits — the
  // state the closure captured goes stale, and an analysis resolving after a
  // tap used to overwrite the athlete's own answer with the model's.
  const ratingRef = useRef<FormRating | null>(value?.rating ?? null)
  const issuesRef = useRef<FormIssue[]>(value?.issues ?? [])
  const visualReviewRef = useRef(value?.visualReviewPassed === true)
  const needsManualReplayReview = exerciseId === 'frog-stand'
  const handleClipAvailability = useCallback((available: boolean) => setClipAvailable(available), [])

  const runAnalysis = async () => {
    if (!clipKey) return
    onBusyChange?.(true)
    setAnalysing(true)
    try {
      const blob = await getClipBlob(clipKey)
      const res: PoseFormResult = blob
        ? await analyseClip(blob, exerciseId, undefined, creditedHoldSec)
        : // Never leave the button looking like it did nothing.
          emptyResult('That clip could not be loaded.')
      setAnalysis(friendlyResult(res))
      if (res.ok) {
        const auto = {
          issues: res.issues,
          confidence: res.confidence,
          elbowDeg: res.elbowDeg,
          kneeDeg: res.kneeDeg,
          hipAngleDeg: res.hipAngleDeg,
          hipOffset: res.hipOffset,
          leanRatio: res.leanRatio,
          wobble: res.wobble,
        }
        if (ratingRef.current !== null) {
          // The athlete answered while the check was running — their word
          // stands. File the camera's reading alongside it, don't overwrite.
          onDone({
            rating: ratingRef.current,
            confirmed: true,
            ...(visualReviewRef.current ? { visualReviewPassed: true } : {}),
            ...(issuesRef.current.length ? { issues: issuesRef.current } : {}),
            ...(clipKey ? { clipKey } : {}),
            auto,
          })
        } else {
          // Pre-fills the answer and saves it immediately — it used to render
          // as selected while storing nothing, so a rest timer expiring lost
          // it. The athlete can still correct it; the model is guessing at a
          // body position it was barely trained on.
          const r: FormRating = res.issues.length === 0 ? 'clean' : res.issues.length > 1 ? 'broke' : 'slipped'
          ratingRef.current = r
          issuesRef.current = res.issues
          setIssues(res.issues)
          setRating(r)
          onDone({
            rating: r,
            confirmed: false,
            ...(res.issues.length ? { issues: res.issues } : {}),
            ...(clipKey ? { clipKey } : {}),
            auto,
          })
        }
      }
    } finally {
      setAnalysing(false)
      onBusyChange?.(false)
    }
  }

  // Fires at most once per set when auto-check is on. It may run after the
  // athlete has already answered; runAnalysis preserves that answer and adds
  // the camera evidence beside it. The in-flight set covers the same clip
  // mounting twice (rest screen row → skip rest → finish row).
  useEffect(() => {
    if (
      !autoRun ||
      !clipAvailable ||
      autoRanRef.current ||
      analysing ||
      analysis ||
      value?.auto ||
      needsManualReplayReview
    ) {
      return
    }
    if (clipKey && autoAnalysisInFlight.has(clipKey)) return
    autoRanRef.current = true
    if (clipKey) autoAnalysisInFlight.add(clipKey)
    void runAnalysis().finally(() => {
      if (clipKey) autoAnalysisInFlight.delete(clipKey)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, clipAvailable, analysing, analysis, value?.auto, needsManualReplayReview])

  // Committed on every tap rather than behind a Save button: the rest timer
  // can expire mid-selection and used to throw the whole rating away.
  const commit = (r: FormRating, iss: FormIssue[], replayPassed = visualReviewRef.current) =>
    onDone({
      rating: r,
      confirmed: true,
      ...(r === 'clean' && replayPassed ? { visualReviewPassed: true } : {}),
      ...(iss.length ? { issues: iss } : {}),
      ...(clipKey ? { clipKey } : {}),
      // The camera's own reading rides along, so the coach has an objective
      // record even when the athlete's rating disagrees with it.
      ...(analysis?.ok
        ? {
            auto: {
              issues: analysis.issues,
              confidence: analysis.confidence,
              elbowDeg: analysis.elbowDeg,
              kneeDeg: analysis.kneeDeg,
              hipAngleDeg: analysis.hipAngleDeg,
              hipOffset: analysis.hipOffset,
              leanRatio: analysis.leanRatio,
              wobble: analysis.wobble,
            },
          }
        : value?.auto
          ? { auto: value.auto }
          : {}),
    })

  const toggleIssue = (id: FormIssue) => {
    const next = issues.includes(id) ? issues.filter((x) => x !== id) : [...issues, id]
    issuesRef.current = next
    setIssues(next)
    if (rating) commit(rating, next)
  }

  const progressionFormPassed = passesProgressionFormCheck(value, exerciseId)

  return (
    <div className="mx-auto mt-5 w-full max-w-sm rounded-2xl border border-line bg-surface p-4">
      {clipKey ? (
        <ClipPlayer
          clipKey={clipKey}
          label={`${EXERCISE_BY_ID[exerciseId]?.name ?? 'Hold'} form check`}
          className="mb-3 h-40 w-full rounded-xl border border-line"
          onAvailabilityChange={handleClipAvailability}
        />
      ) : null}
      {clipKey ? (
        <div className="mb-3">
          {!needsManualReplayReview ? (
            <button
              onClick={() => void runAnalysis()}
              disabled={analysing || !clipAvailable}
              aria-busy={analysing}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-raised py-2 text-[13px] font-semibold text-ink transition hover:border-line-strong disabled:opacity-60"
            >
              <Icon name="sparkle" size={14} className="text-accent" />
              {analysing ? 'Checking your position…' : 'Check my form automatically'}
            </button>
          ) : null}
          {analysing ? (
            <p className="mt-1 text-center text-[11.5px] text-ink3" role="status">
              First run downloads the checker — it is quick after that.
            </p>
          ) : null}
          {analysis ? (
            <div
              className={`mt-2 rounded-xl border p-3 text-[12.5px] leading-relaxed ${
                analysis.ok ? 'border-line bg-raised text-ink2' : 'border-line bg-raised text-ink3'
              }`}
            >
              {analysis.ok ? (
                <>
                  {analysis.notes.length > 0 ? (
                    <div className="space-y-1">
                      {analysis.notes.map((n) => (
                        <div key={n} className="flex gap-1.5">
                          <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                          <span>{n}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="font-medium text-ok">
                      No measured issue found — confirm scapular position and control yourself.
                    </div>
                  )}
                  {analysis.good.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {analysis.good.map((g) => (
                        <span key={g} className="rounded-full bg-ok-soft px-2 py-0.5 text-[11.5px] font-medium text-ok">
                          ✓ {g}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11.5px] text-ink3">Measurement detail</summary>
                      <div className="mt-1 space-y-0.5 text-[11.5px] text-ink3">
                        {analysis.details.map((d) => (
                          <div key={d}>{d}</div>
                        ))}
                        <div>
                          {analysis.framesUsed} frames · {Math.round(analysis.confidence * 100)}% tracking confidence.
                          A side-on estimate, not a verdict — correct it below if it read you wrong.
                        </div>
                      </div>
                    </details>
                  }
                </>
              ) : (
                (analysis.reason ?? 'Could not analyse that clip.')
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="text-[13px] font-semibold text-ink">How did that set look?</div>
      {value?.confirmed === false && rating ? (
        <p className="mt-1 text-[11.5px] font-medium text-accent" role="status">
          Camera suggestion only — tap your answer below to confirm or correct it.
        </p>
      ) : null}
      <div className="mt-2 flex gap-2">
        {(
          [
            ['clean', 'Clean'],
            ['slipped', 'Slipped'],
            ['broke', 'Broke down'],
          ] as [FormRating, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => {
              // Refs updated synchronously so an analysis resolving a moment
              // later sees this tap and defers to it.
              ratingRef.current = id
              issuesRef.current = id === 'clean' ? [] : issues
              if (id !== 'clean') {
                visualReviewRef.current = false
                setVisualReviewPassed(false)
              }
              setRating(id)
              commit(id, id === 'clean' ? [] : issues, id === 'clean' && visualReviewRef.current)
              if (id === 'clean') setIssues([])
            }}
            aria-pressed={rating === id}
            className={`flex-1 rounded-xl border py-2 text-[13px] font-medium transition ${
              rating === id
                ? 'border-transparent bg-accent text-on-accent'
                : 'border-line bg-raised text-ink2 hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {needsManualReplayReview && clipAvailable && rating === 'clean' ? (
        <div className="mt-3 rounded-xl border border-line bg-raised p-3">
          <p className="text-[12.5px] leading-relaxed text-ink2">
            Frog Stand has no fixed geometry the camera can grade honestly. Watch the replay and check that balance
            stayed controlled, with no uncontrolled collapse.
          </p>
          <button
            onClick={() => {
              visualReviewRef.current = true
              setVisualReviewPassed(true)
              commit('clean', [], true)
            }}
            aria-pressed={visualReviewPassed}
            className={`mt-2 w-full rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${
              visualReviewPassed
                ? 'border-ok/40 bg-ok-soft text-ok'
                : 'border-line-strong bg-surface text-ink hover:border-accent'
            }`}
          >
            {visualReviewPassed ? 'Replay checked — form held' : 'I reviewed the replay — form held'}
          </button>
        </div>
      ) : null}
      {rating === 'clean' && value?.confirmed === true ? (
        <p
          className={`mt-2 text-[11.5px] font-medium ${progressionFormPassed ? 'text-ok' : 'text-accent'}`}
          role="status"
        >
          {progressionFormPassed
            ? value?.auto?.issues.length === 1
              ? 'Progression evidence complete — your Clean rating plus one isolated camera flag.'
              : 'Progression evidence complete — athlete and filmed form checks agree.'
            : needsManualReplayReview
              ? 'Your Clean rating is saved. Review the replay above for this hold to count toward progression.'
              : value?.auto && value.auto.issues.length > 1
                ? 'Saved as a PR, but the camera found multiple form flags, so this hold will not unlock.'
                : 'Your Clean rating is saved. A successful camera check is still needed for progression.'}
        </p>
      ) : null}
      {rating && rating !== 'clean' ? (
        <div className="mt-3">
          <div className="text-[12.5px] text-ink2">
            What gave out?{analysis?.ok && analysis.issues.length ? ' (pre-filled from the clip)' : ''}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {issuesFor(exerciseId).map((f) => {
              const on = issues.includes(f.id)
              return (
                <button
                  key={f.id}
                  onClick={() => toggleIssue(f.id)}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition ${
                    on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2'
                  }`}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[11.5px] text-ink3">Saved as you tap — no need to confirm.</p>
        </div>
      ) : null}
    </div>
  )
}

/** The coach's periodic readiness questions — answers change today's plan. */
function CheckInForm({ onDone, onSkip }: { onDone: (c: CheckIn) => void; onSkip: () => void }) {
  const [joints, setJoints] = useState<CheckIn['joints'] | null>(null)
  const [energy, setEnergy] = useState<CheckIn['energy'] | null>(null)

  const JOINTS: { id: CheckIn['joints']; label: string; hint: string }[] = [
    { id: 'good', label: 'All good', hint: 'Wrists and elbows feel normal' },
    { id: 'niggle', label: 'A bit off', hint: 'Slight ache or stiffness, no real pain' },
    { id: 'pain', label: 'Painful', hint: 'Sharp or persistent joint pain' },
  ]
  const ENERGY: { id: CheckIn['energy']; label: string }[] = [
    { id: 'fresh', label: 'Fresh' },
    { id: 'ok', label: 'Okay' },
    { id: 'tired', label: 'Tired' },
  ]

  return (
    <div className="p-6">
      <div className="pr-10">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-wider text-accent">
          <Icon name="target" size={14} /> Quick check-in
        </div>
        <h2 className="mt-1 font-display text-[20px] font-bold text-ink">How are you feeling?</h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">
          Two questions. Your answers change today's warm-up, intensity and volume — being honest here is what keeps
          you training instead of recovering.
        </p>
      </div>

      <div className="mt-4">
        <div className="text-[13px] font-semibold text-ink">Wrists, elbows and shoulders</div>
        <div className="mt-2 space-y-2">
          {JOINTS.map((j) => (
            <button
              key={j.id}
              onClick={() => setJoints(j.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${
                joints === j.id ? 'border-accent bg-accent-soft' : 'border-line bg-raised hover:border-line-strong'
              }`}
            >
              <span>
                <span className="block text-[14px] font-medium text-ink">{j.label}</span>
                <span className="block text-[12.5px] text-ink2">{j.hint}</span>
              </span>
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                  joints === j.id ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'
                }`}
              >
                {joints === j.id ? <Icon name="check" size={11} strokeWidth={3} /> : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[13px] font-semibold text-ink">Energy today</div>
        <div className="mt-2 flex gap-2">
          {ENERGY.map((e) => (
            <button
              key={e.id}
              onClick={() => setEnergy(e.id)}
              className={`flex-1 rounded-xl border py-2.5 text-[13.5px] font-medium transition ${
                energy === e.id
                  ? 'border-transparent bg-accent text-on-accent'
                  : 'border-line bg-raised text-ink2 hover:text-ink'
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      <button
        disabled={!joints || !energy}
        onClick={() => joints && energy && onDone({ joints, energy, at: Date.now() })}
        className="mt-5 w-full rounded-2xl px-6 py-3.5 font-display text-[16px] font-semibold text-on-accent shadow-card transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: 'var(--t-btn-accent)' }}
      >
        Start session
      </button>
      <button onClick={onSkip} className="mt-2 w-full py-2 text-[13px] font-medium text-ink3 hover:text-ink">
        Skip for now
      </button>
    </div>
  )
}

function DemoHelp({ exercise, pinnedUrl }: { exercise: Exercise; pinnedUrl?: string }) {
  const pinnedId = pinnedUrl ? youtubeId(pinnedUrl) : null
  return (
    <div className="p-6 sm:p-7">
      <div className="pr-10">
        <h2 className="font-display text-[21px] font-bold text-ink">{exercise.name}</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink2">{exercise.blurb}</p>
      </div>
      {pinnedId ? (
        <div className="relative mt-4 w-full overflow-hidden rounded-xl border border-line" style={{ paddingTop: '56.25%' }}>
          <iframe
            src={embedUrl(pinnedId)}
            title={`${exercise.name} demo`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        </div>
      ) : (
        <a
          href={demoSearchUrl(exercise)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-line bg-raised py-3 text-[14px] font-medium text-ink transition hover:border-line-strong"
        >
          <Icon name="play" size={15} className="text-accent" /> Watch demos on YouTube
        </a>
      )}
      <div className="mt-4 rounded-2xl border border-line bg-raised p-4">
        <div className="mb-2 text-[13px] font-semibold text-ink">Step by step</div>
        <ol className="space-y-1.5 text-[13.5px] leading-relaxed text-ink2">
          {exercise.howTo.map((s, i) => (
            <li key={s} className="flex gap-2.5">
              <span className="font-display font-semibold text-accent tnum">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-3 rounded-2xl border border-line bg-raised p-4">
        <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-danger">
          <Icon name="x" size={14} /> Watch out for
        </div>
        <ul className="space-y-1.5 text-[13.5px] leading-relaxed text-ink2">
          {exercise.mistakes.map((m) => (
            <li key={m} className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink3" />
              {m}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-[12.5px] text-ink3">
        Tip: pin your favourite demo in the Learn tab and it will play here instead of a search.
      </p>
    </div>
  )
}

/** Map planche-line exercise ids onto the figure pictograms. */
function figureFor(exerciseId: string) {
  switch (exerciseId) {
    case 'planche-lean':
      return 'lean' as const
    case 'frog-stand':
      return 'frog' as const
    case 'tuck-planche':
      return 'tuck' as const
    case 'adv-tuck-planche':
      return 'advtuck' as const
    case 'one-leg-planche':
      return 'oneleg' as const
    case 'straddle-planche':
    case 'band-straddle-planche':
      return 'straddle' as const
    case 'full-planche':
      return 'full' as const
    default:
      return 'lean' as const
  }
}
