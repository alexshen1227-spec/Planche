import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CheckIn,
  EndReason,
  Exercise,
  FormCheck,
  Section,
  Session,
  SessionEvents,
  SetLog,
  SetTiming,
  TrainingSurface,
  Workout,
} from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID } from '../data/progressions'
import { describeBlock, describeTarget, primaryTargetBlock, adaptiveTarget } from '../data/workouts'
import { debriefSession, type CoachDecision } from '../lib/coach'
import { ACHIEVEMENT_BY_ID } from '../data/achievements'
import { useStore } from '../lib/store'
import { applySession } from '../lib/engine'
import { sfx, speak, buzz } from '../lib/audio'
import { confetti } from '../lib/confetti'
import { useWakeLock } from '../lib/wakeLock'
import { clearDraft, restoredSessionSetup, saveDraft, type SessionDraft } from '../lib/draft'
import { useFormRecorder, type RecorderStatus } from '../lib/recorder'
import { saveClip } from '../lib/clips'
import { isFilmable, warmDetector } from '../lib/poseForm'
import { pushToast } from '../lib/toast'
import { fmtClock, fmtHold } from '../lib/time'
import { readSignals } from '../lib/signals'
import {
  creditedHoldSeconds,
  isMainProgressionHold,
  leadInSecondsFor,
  stopLatencySecondsFor,
  stopSetupCredits,
} from '../lib/sessionTiming'
import { defaultSurface, surfaceLabel, TRAINING_SURFACES } from '../data/equipment'
import { recordForSurface } from '../lib/records'
import { demoSearchUrl, youtubeId, embedUrl } from '../lib/video'
import { Icon } from '../components/Icon'
import { Figure } from '../components/Figure'
import { ProgressRing, Modal } from '../components/ui'
import { FramingCheck } from '../components/FramingCheck'
import {
  FormCheckRow,
  mergeHumanReview,
  mergeModelReading,
  type HumanReview,
  type ModelReading,
} from '../components/FormCheckRow'
import { CheckInForm, type CheckInContext } from '../components/CheckInForm'
import { AttemptEnd, type AttemptSymptom } from '../components/AttemptEnd'
import { SetupRow } from '../components/SetupRow'
import {
  requiresFlightConfirmation,
  setNeedsProgressionFormEvidence,
  unseenVariantCriteria,
} from '../lib/progression'

export type { CheckInContext } from '../components/CheckInForm'

type Phase = 'intro' | 'ready' | 'lead' | 'hold' | 'reps' | 'rest' | 'summary' | 'celebrate'

const SECTION_LABEL: Record<Section, string> = {
  warmup: 'Warm-up',
  main: 'Main work',
  strength: 'Strength',
  core: 'Core',
  cooldown: 'Cooldown',
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** What the athlete can do about a camera that is not live, by cause. */
const CAMERA_FAILURE: Partial<Record<RecorderStatus, string>> = {
  denied:
    'Camera permission was refused. Allow it in this site’s browser settings to film — or train without filming.',
  unavailable: 'No usable camera was found, or it stopped. Try again, or train without filming.',
  busy: 'The camera is in use by another app or could not start. Close other camera apps and try again — or train without filming.',
  unsupported: 'This browser cannot record video here. Your sets still log normally.',
}

/** Holds where a remembered setup (assistance) is worth asking about. */
function assistApplies(ex: Exercise | undefined): boolean {
  return Boolean(ex && ex.type === 'hold' && ex.category === 'planche' && ex.id !== 'frog-stand')
}

interface LogExtra {
  raw?: number
  timing?: SetTiming
  at?: number
  /** Actual setup countdown used; null when unknowable (a restored attempt). */
  leadInSec?: number | null
  recordingOffsetSec?: number
}

/**
 * A hold ring that leaves the Stop button on screen.
 *
 * The fixed 290px ring pushed Stop below the fold on a short phone held
 * sideways — the one control that has to be reachable without scrolling while
 * someone is climbing out of a planche.
 */
function useRingSize(max: number, min = 168): number {
  const measure = useCallback(
    () =>
      typeof window === 'undefined'
        ? max
        : Math.round(Math.max(min, Math.min(max, window.innerWidth - 56, window.innerHeight - 300))),
    [max, min],
  )
  const [size, setSize] = useState(measure)
  useEffect(() => {
    const onResize = () => setSize(measure())
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [measure])
  return size
}

/** How a logged value was arrived at, when it is not a plain stopwatch reading. */
function timingNote(log: SetLog): string | null {
  if (log.kind !== 'hold') return null
  if (log.timing?.method === 'edited') {
    return log.raw !== undefined ? `(edited · the timer read ${log.raw.toFixed(1)}s)` : '(edited by hand)'
  }
  if (log.timing?.method === 'interrupted') {
    return log.raw !== undefined ? `(interrupted at ${log.raw.toFixed(1)}s on the timer)` : '(interrupted)'
  }
  if (log.raw !== undefined && log.raw - log.value > 0.05) {
    return `(${log.raw.toFixed(1)}s − ${(log.raw - log.value).toFixed(1)}s to stop it)`
  }
  return null
}

export function SessionPlayer({
  workout,
  onExit,
  resumeFrom,
  askCheckIn = false,
  checkInContext,
  onCheckInAnswered,
}: {
  workout: Workout
  onExit: () => void
  resumeFrom?: SessionDraft | null
  askCheckIn?: boolean
  checkInContext?: CheckInContext
  onCheckInAnswered?: (c: CheckIn) => void
}) {
  const { state, dispatch, persist } = useStore()
  const restoredSetup = restoredSessionSetup(resumeFrom, state.settings)
  const resumeExerciseId = resumeFrom ? workout.blocks[resumeFrom.blockIndex]?.exerciseId : undefined
  const resumeLatency = stopLatencySecondsFor(
    resumeExerciseId,
    state.settings.stopLatencySec,
    !restoredSetup.walkedBack,
  )
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
  const logsRef = useRef(logs)
  logsRef.current = logs
  const [now, setNow] = useState(() => Date.now())
  const [leadEnd, setLeadEnd] = useState(0)
  const [holdStart, setHoldStart] = useState(0)
  const [surface, setSurface] = useState<TrainingSurface>(() => {
    const resumedSurface = [...(resumeFrom?.logs ?? [])].reverse().find((log) => log.surface)?.surface
    return resumedSurface ?? defaultSurface(state.profile.equipment, state.profile.preferredSurface)
  })
  const [restEnd, setRestEnd] = useState(resumeFrom?.restEndsAt ?? 0)
  /** Duration the current rest was started with — the ring's denominator. */
  const [restTotal, setRestTotal] = useState(resumeFrom?.restTotal ?? 0)
  const [pendingReps, setPendingReps] = useState(0)
  const [rpe, setRpe] = useState<number | undefined>(resumeFrom?.rpe)
  const [notes, setNotes] = useState(resumeFrom?.notes ?? '')
  /**
   * A hold cut short by the page being hidden, awaiting log-or-redo: the
   * credited value, and the stopwatch reading behind it. The raw reading used
   * to be dropped on the way, so a logged interruption looked like an
   * ordinary measured hold.
   */
  const restoredHolding = Boolean(resumeFrom?.wasHolding && resumeFrom.holdElapsed > 1)
  const [interrupted, setInterrupted] = useState<number | null>(
    resumeFrom?.interrupted !== undefined
      ? resumeFrom.interrupted
      : restoredHolding
        ? Math.max(0, round1(resumeFrom!.holdElapsed - resumeLatency))
        : null,
  )
  const [interruptedRaw, setInterruptedRaw] = useState<number | null>(
    resumeFrom?.interrupted !== undefined
      ? (resumeFrom.interruptedRaw ?? null)
      : restoredHolding
        ? round1(resumeFrom!.holdElapsed)
        : null,
  )
  const [events, setEvents] = useState<SessionEvents | null>(null)
  const [savedSession, setSavedSession] = useState<Session | null>(null)
  const [confirmExit, setConfirmExit] = useState(false)
  const [showDemo, setShowDemo] = useState(false)
  const [showRpeHelp, setShowRpeHelp] = useState(false)
  const [problemReportOpen, setProblemReportOpen] = useState(false)
  /** Fullscreen clip review is open: the session holds its rest clock and keyboard for it. */
  const [reviewOpen, setReviewOpen] = useState(false)
  const [checkIn, setCheckIn] = useState<CheckIn | null>(resumeFrom?.checkIn ?? null)
  const [cameraOn, setCameraOn] = useState(restoredSetup.cameraOn)
  /**
   * Whether the athlete had to climb out of the position and walk to the phone
   * to stop the last hold.
   *
   * A per-set fact rather than a profile one: the same athlete films some sets
   * and stops others from arm's reach, and a single global answer is wrong
   * half the time. Settings supplies the opening guess, the rest screen offers
   * a one-tap correction, and the corrected answer carries to the next set so
   * it only ever costs a tap when it is actually wrong.
   */
  const [walkedBack, setWalkedBack] = useState(restoredSetup.walkedBack)
  /** Clips still being finalised and stored. */
  const [clipsFinalizing, setClipsFinalizing] = useState(0)
  /**
   * Form checks in flight, by operation. Only the operation that set busy can
   * clear it: keying by set let an older check finish and clear the flag while
   * a newer check of the same set was still running.
   */
  const [busyOps, setBusyOps] = useState<Set<string>>(() => new Set())
  /** The app is hidden; nothing that was running keeps running unseen. */
  const [suspended, setSuspended] = useState(false)
  const [finishedEarly, setFinishedEarly] = useState(resumeFrom?.finishedEarly === true)
  const recorder = useFormRecorder()
  const [showCheckIn, setShowCheckIn] = useState(askCheckIn && !resumeFrom)
  const [insight, setInsight] = useState<{ delta: number; label: string } | null>(null)
  const [debrief, setDebrief] = useState<CoachDecision[]>([])
  const ringSize = useRingSize(290)
  const sessionRef = useRef<HTMLDivElement | null>(null)
  /**
   * When training actually started — stamped on "Begin session", not on mount.
   *
   * Opening a workout is not training: the intro screen is a plan you might
   * read for a minute, walk away from, or back out of entirely. 0 means "not
   * started yet".
   */
  const startedAtRef = useRef(resumeFrom?.startedAt ?? 0)
  /**
   * When training ended — stamped the moment the summary opens. Time spent
   * reviewing clips, rating sets and writing notes is not training; saving
   * with Date.now() used to add all of it to the session's duration.
   */
  const endedAtRef = useRef(resumeFrom?.endedAt ?? 0)
  const restoredPausedMs =
    Math.max(0, resumeFrom?.pausedMs ?? 0) +
    (resumeFrom?.startedAt && resumeFrom.pausedAt
      ? Math.max(0, (resumeFrom.endedAt || Date.now()) - resumeFrom.pausedAt)
      : 0)
  /** Completed time spent outside the app during training. */
  const pausedMsRef = useRef(restoredPausedMs)
  /** Start of the current inactive period, if the app is hidden mid-training. */
  const hiddenAtRef = useRef<number | null>(null)
  const lastBeepRef = useRef(-1)
  const targetHitRef = useRef(false)
  const lastCountRef = useRef(-1)
  const prBuzzedRef = useRef(false)
  const leadStartedAtRef = useRef(0)
  const leadUsedRef = useRef(0)
  /** Hold elapsed frozen at the moment the page was hidden. */
  const frozenElapsedRef = useRef<number | null>(null)
  /** Claimed synchronously so one hold cannot be logged twice. */
  const stoppingHoldRef = useRef(false)
  /** The phase whose Space action has already been claimed this render. */
  const spaceClaimRef = useRef<Phase | null>(null)
  /** Current phase, readable from async callbacks without going stale. */
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  /** This attempt was started with a live camera and is meant to be recorded. */
  const filmAttemptRef = useRef(false)
  /** Recording actually began for this attempt, and how long after the hold did. */
  const recordingRef = useRef<{ offsetSec: number } | null>(null)
  /** Set once saved: late camera results and clips then update the saved session. */
  const savedSessionIdRef = useRef<string | null>(null)
  const savingRef = useRef(false)
  /** Forms written after saving, so two late results merge instead of racing. */
  const postSaveForms = useRef(new Map<number, FormCheck | undefined>())
  // A new phase re-arms the keyboard: the claim only exists to collapse the
  // burst of events that arrives before this render.
  useEffect(() => {
    spaceClaimRef.current = null
  }, [phase])
  /**
   * The exact set the interrupted hold belongs to. Without this the recovery
   * card would follow you to later exercises and could log a planche hold as
   * reps of whatever came next.
   */
  const interruptedAt = useRef(
    resumeFrom?.interruptedAt ?? (resumeFrom ? { bi: resumeFrom.blockIndex, si: resumeFrom.setIndex } : null),
  )

  useWakeLock(phase !== 'summary' && phase !== 'celebrate')

  useEffect(() => {
    sessionRef.current?.focus()
  }, [])

  const block = workout.blocks[bi]
  const exercise = block ? EXERCISE_BY_ID[block.exerciseId] : undefined
  /** Raw rounds, which is what the progress bar and the "n/N sets" counter track. */
  const totalSets = useMemo(() => workout.blocks.reduce((n, b) => n + b.sets, 0), [workout])
  const doneSets = logs.length
  /**
   * Unilateral work runs twice per set so both sides get the same dose. The
   * weaker side goes first while the athlete is freshest. The set counter
   * still shows real rounds.
   */
  const perSide = Boolean(exercise?.perSide)
  const sideGap = useMemo(() => readSignals(state).sideGap, [state])
  const weakSideFirst = sideGap?.weakSide ?? 'left'
  const sideFor = useCallback(
    (setIndex: number): 'left' | 'right' =>
      setIndex % 2 === 0 ? weakSideFirst : weakSideFirst === 'left' ? 'right' : 'left',
    [weakSideFirst],
  )
  const side = sideFor(si)
  const roundsPerSet = perSide ? 2 : 1
  const displaySet = Math.floor(si / roundsPerSet) + 1
  const displayTotal = block ? Math.ceil(block.sets / roundsPerSet) : 0
  // The record to beat includes anything already set earlier in this session,
  // otherwise a second, weaker set would celebrate as a PR too.
  const bestBefore = useMemo(() => {
    if (!exercise) return undefined
    const surfaceAware = exercise.category === 'planche'
    const stored = surfaceAware
      ? recordForSurface(state.prs[exercise.id], surface)?.value
      : state.prs[exercise.id]?.value
    const thisSession = logs.reduce(
      (best, log) =>
        log.exerciseId === exercise.id && (!surfaceAware || log.surface === surface) && log.value > best
          ? log.value
          : best,
      0,
    )
    if (stored === undefined && thisSession === 0) return undefined
    return Math.max(stored ?? 0, thisSession)
  }, [exercise, state.prs, logs, surface])
  const leadSec = leadInSecondsFor(exercise?.id)
  const latency =
    exercise?.type === 'hold' ? stopLatencySecondsFor(exercise.id, state.settings.stopLatencySec, !walkedBack) : 0
  // Film every key hold on the road. Most use pose geometry; Frog Stand keeps
  // the replay for an explicit checklist review instead.
  const filmable = Boolean(block?.section === 'main' && exercise && isFilmable(exercise.id))
  /** The athlete wants this set filmed — intent, not capability. */
  const wantsFilm = Boolean(filmable && cameraOn && recorder.supported)
  const cameraLive = recorder.status === 'live' || recorder.status === 'recording'
  const cameraFailure = wantsFilm ? CAMERA_FAILURE[recorder.status] : undefined
  /** A filmed attempt waits for a live camera; a timer-only one never does. */
  const startWaitsForCamera =
    exercise?.type === 'hold' && wantsFilm && (recorder.status === 'starting' || recorder.status === 'off')
  const setup = exercise && assistApplies(exercise) ? state.setups?.[exercise.id] : undefined

  // Spin the pose model up while the athlete is still getting into position,
  // so an automatic check lands right after the clip instead of stalling on
  // the model load.
  useEffect(() => {
    if (wantsFilm && state.settings.autoAnalyze && exercise?.id !== 'frog-stand') warmDetector()
  }, [wantsFilm, state.settings.autoAnalyze, exercise?.id])

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
        pausedMs: pausedMsRef.current,
        ...(hiddenAtRef.current !== null ? { pausedAt: hiddenAtRef.current } : {}),
        blockIndex: bi,
        setIndex: si,
        logs,
        wasHolding: phase === 'hold',
        holdElapsed: elapsed,
        restEndsAt: phase === 'rest' ? restEnd : null,
        restTotal,
        ...(checkIn ? { checkIn } : {}),
        // These are live session choices. Falling back to Settings after a
        // crash can change the next hold's seconds or reopen a camera the
        // athlete explicitly switched off.
        walkedBack,
        cameraOn,
        phase: phase === 'rest' || phase === 'summary' ? phase : 'ready',
        ...(interrupted !== null && interruptedAt.current
          ? {
              interrupted,
              interruptedAt: interruptedAt.current,
              ...(interruptedRaw !== null ? { interruptedRaw } : {}),
            }
          : {}),
        ...(endedAtRef.current ? { endedAt: endedAtRef.current } : {}),
        ...(finishedEarly ? { finishedEarly: true } : {}),
        rpe,
        notes,
      })
    }
    snapshot()
    /**
     * One suspend action for every phase. Hiding an active hold already ended
     * it; Ready and the lead-in used to keep the camera open and the
     * countdown running, so a phone in a pocket could start a hold — and a
     * recording — that nobody was in.
     */
    const suspend = () => {
      if (startedAtRef.current && !endedAtRef.current && hiddenAtRef.current === null) {
        hiddenAtRef.current = Date.now()
      }
      if (phase === 'hold') {
        const raw = Math.max(0, (Date.now() - holdStart) / 1000)
        frozenElapsedRef.current = raw
        // Hidden time is unknowable. End the attempt now rather than letting a
        // locked phone manufacture a PR; the athlete can log or redo it. The
        // same allowance as stopping it yourself is held back, because the
        // moment the position was left is not known either.
        setInterrupted(Math.max(0, round1(raw - latency)))
        setInterruptedRaw(round1(raw))
        interruptedAt.current = { bi, si }
        stoppingHoldRef.current = true
        // Footage of an interrupted attempt is not kept: it cannot be lined
        // up with a value the athlete has not chosen yet.
        if (filmAttemptRef.current) void recorder.stop()
        filmAttemptRef.current = false
        recordingRef.current = null
        setPhase('ready')
      } else if (phase === 'lead') {
        filmAttemptRef.current = false
        setPhase('ready')
      }
      recorder.release()
      setSuspended(true)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        suspend()
        // React state may not flush before a hidden tab is discarded; this
        // synchronous write still carries the frozen hold.
        snapshot()
      } else {
        const resumedAt = Date.now()
        if (hiddenAtRef.current !== null) {
          pausedMsRef.current += Math.max(0, resumedAt - hiddenAtRef.current)
          hiddenAtRef.current = null
          setNow(resumedAt)
        }
        frozenElapsedRef.current = null
        setSuspended(false)
        snapshot()
      }
    }
    const onPageHide = () => {
      if (startedAtRef.current && !endedAtRef.current && hiddenAtRef.current === null) {
        hiddenAtRef.current = Date.now()
      }
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
    recorder,
    interrupted,
    interruptedRaw,
    checkIn,
    walkedBack,
    cameraOn,
    finishedEarly,
  ])

  // Say what was recovered, not that nothing was lost — an interrupted hold
  // is exactly the thing that may have been.
  useEffect(() => {
    if (!resumeFrom) return
    const n = resumeFrom.logs.length
    pushToast(
      `Session restored — ${n} set${n === 1 ? '' : 's'} logged so far${
        interrupted !== null ? '. Your last hold was interrupted: choose whether to log it' : ''
      }.`,
      'success',
      5500,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Open the camera while setting up so the shot can be framed, and close it
  // again as soon as filming is not imminent — no stray camera light.
  const { prepare: prepareCamera, release: releaseCamera } = recorder
  useEffect(() => {
    if (suspended) return
    if (phase === 'ready') {
      if (wantsFilm) void prepareCamera()
      else releaseCamera()
    } else if (phase !== 'lead' && phase !== 'hold') {
      releaseCamera()
    }
  }, [phase, wantsFilm, suspended, prepareCamera, releaseCamera])

  // Countdown cues for lead-in and rest: spoken when voice is on, ticks otherwise.
  useEffect(() => {
    if (phase !== 'lead' && phase !== 'rest') return
    if (phase === 'rest' && (problemReportOpen || reviewOpen)) return
    const remaining = phase === 'lead' ? leadRemaining : restRemaining
    const whole = Math.ceil(remaining)
    if (whole <= 3 && whole >= 1 && whole !== lastBeepRef.current) {
      lastBeepRef.current = whole
      if (state.settings.voice) speak(String(whole))
      else if (state.settings.beeps) sfx.tick()
    }
  }, [phase, leadRemaining, restRemaining, problemReportOpen, reviewOpen, state.settings.beeps, state.settings.voice])

  // Lead-in finished → the hold starts.
  useEffect(() => {
    if (phase === 'lead' && leadRemaining <= 0) {
      sfx.go()
      const startedAt = Date.now()
      recordingRef.current = null
      // Recording starts with the hold, not with the lead-in — and only from a
      // camera that was live when the attempt began. A late camera never
      // starts a recording mid-hold: its clip's first frame would not be the
      // hold's first second, and the judge would grade the wrong window.
      if (filmAttemptRef.current) {
        void recorder.start().then((ok) => {
          if (ok) {
            recordingRef.current = { offsetSec: Math.max(0, (Date.now() - startedAt) / 1000) }
          } else if (filmAttemptRef.current) {
            filmAttemptRef.current = false
            pushToast('The camera stopped before this hold started — it is timed, but not filmed.', 'info', 4500)
          }
        })
      }
      if (state.settings.voice) speak('Go')
      targetHitRef.current = false
      lastCountRef.current = -1
      prBuzzedRef.current = false
      leadUsedRef.current = Math.max(0, (startedAt - leadStartedAtRef.current) / 1000)
      stoppingHoldRef.current = false
      setHoldStart(startedAt)
      setPhase('hold')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, leadRemaining, state.settings.voice])

  // Rest finished → back to ready. Never underneath an open review or report:
  // finishing the rest must not dismiss the clip someone is looking at.
  useEffect(() => {
    if (phase === 'rest' && restRemaining <= 0 && !problemReportOpen && !reviewOpen) {
      sfx.go()
      if (state.settings.voice) speak('Rest over')
      lastBeepRef.current = -1
      setPhase('ready')
    }
  }, [phase, restRemaining, problemReportOpen, reviewOpen, state.settings.voice])

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

  /**
   * Leave the intro and start the clock. Both the button and the Space key
   * come through here so the two can never disagree about when a session
   * began, and a resumed session keeps its original start time.
   */
  const startSession = useCallback(() => {
    if (!startedAtRef.current) {
      startedAtRef.current = Date.now()
      pausedMsRef.current = 0
      hiddenAtRef.current = null
    }
    setPhase('ready')
  }, [])

  /** Training is over: fix its end now, before any review time accrues. */
  const enterSummary = useCallback((early: boolean) => {
    lastBeepRef.current = -1
    if (!endedAtRef.current) endedAtRef.current = Date.now()
    if (early) setFinishedEarly(true)
    setPhase('summary')
  }, [])

  const advance = useCallback(
    (withRest: boolean) => {
      lastBeepRef.current = -1
      const b = workout.blocks[bi]
      const isLastSet = si + 1 >= b.sets
      const isLastBlock = bi + 1 >= workout.blocks.length
      if (isLastSet && isLastBlock) {
        enterSummary(false)
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
    [bi, si, workout, enterSummary],
  )

  /** Move on without logging anything — by whole rounds, across blocks if needed. */
  const moveBy = useCallback(
    (rounds: number) => {
      lastBeepRef.current = -1
      const b = workout.blocks[bi]
      if (b && si + rounds < b.sets) {
        setSi(si + rounds)
        setPhase('ready')
        return
      }
      if (bi + 1 < workout.blocks.length) {
        setBi(bi + 1)
        setSi(0)
        setPhase('ready')
        return
      }
      enterSummary(false)
    },
    [bi, si, workout, enterSummary],
  )

  /** One set's record, built for an explicit block and round. */
  const buildLog = useCallback(
    (blockIndex: number, setIndex: number, value: number, extra: LogExtra = {}): SetLog | null => {
      const b = workout.blocks[blockIndex]
      const ex = b ? EXERCISE_BY_ID[b.exerciseId] : undefined
      if (!b || !ex) return null
      // A snapshot of the remembered setup, so changing it later never
      // relabels this set.
      const remembered = assistApplies(ex) ? state.setups?.[ex.id] : undefined
      const { raw, timing, leadInSec, recordingOffsetSec } = extra
      return {
        exerciseId: ex.id,
        kind: ex.type,
        value,
        ...(raw !== undefined && Math.abs(raw - value) > 0.05 ? { raw } : {}),
        ...(ex.perSide ? { side: sideFor(setIndex) } : {}),
        ...(ex.category === 'planche' ? { surface } : {}),
        ...(ex.type === 'hold' && leadInSec !== undefined && leadInSec !== null ? { leadInSec: round1(leadInSec) } : {}),
        ...(ex.type === 'hold' && timing ? { timing } : {}),
        ...(remembered ? { assist: remembered.assist } : {}),
        ...(recordingOffsetSec !== undefined && recordingOffsetSec > 0.25
          ? { recordingOffsetSec: round1(recordingOffsetSec) }
          : {}),
        target: b.target.kind === 'hold' ? b.target.sec : b.target.reps,
        section: b.section,
        at: extra.at ?? Date.now(),
      }
    },
    [workout, sideFor, surface, state.setups],
  )

  const logSet = useCallback(
    (value: number, extra: LogExtra = {}, then: 'advance' | 'finish' = 'advance') => {
      const entry = buildLog(bi, si, value, { leadInSec: leadUsedRef.current, ...extra })
      if (!entry) return
      setLogs((l) => [...l, entry])
      if (then === 'finish') enterSummary(true)
      else advance(true)
    },
    [bi, si, buildLog, advance, enterSummary],
  )

  const stopHold = useCallback(
    (then: 'advance' | 'finish' = 'advance') => {
      // A hold can only be stopped once.
      //
      // `phase` is read from a closure, and several events can fire before
      // React re-renders: holding the space bar auto-repeats, and an impatient
      // double tap on Stop is ordinary behaviour mid-workout. The ref is
      // claimed synchronously, so the duplicates have nothing left to do.
      if (stoppingHoldRef.current) return
      stoppingHoldRef.current = true
      const raw = round1((Date.now() - holdStart) / 1000)
      // You come out of the hold, then reach for the button. That gap is time
      // you were not actually holding, so it comes back off.
      const v = Math.max(0, round1(raw - latency))
      sfx.stop()
      if (bestBefore !== undefined && v > bestBefore) sfx.pr()
      const loggedAt = Date.now()
      const recording = recordingRef.current
      recordingRef.current = null
      if (filmAttemptRef.current && exercise) {
        filmAttemptRef.current = false
        const exId = exercise.id
        setClipsFinalizing((n) => n + 1)
        void recorder
          .stop()
          .then(async (blob) => {
            if (!blob) return
            const key = await saveClip(exId, blob, v)
            if (!key) {
              pushToast('The clip could not be saved. Your set is still logged.', 'danger', 5000)
              return
            }
            // Attached by timestamp, so it lands on this exact set even if the
            // athlete has moved on — and on the saved session if it was saved
            // before the clip finished.
            setLogs((current) => current.map((log) => (log.at === loggedAt ? { ...log, clipKey: key } : log)))
            const sessionId = savedSessionIdRef.current
            if (sessionId) dispatch({ type: 'ATTACH_SET_CLIP', sessionId, setAt: loggedAt, clipKey: key })
          })
          .finally(() => setClipsFinalizing((n) => Math.max(0, n - 1)))
      }
      const allowanceSec = round1(raw - v)
      const timing: SetTiming = {
        method: 'stopwatch',
        ...(allowanceSec > 0
          ? {
              allowanceSec,
              allowance: exercise && isMainProgressionHold(exercise.id) && walkedBack ? 'walk-back' : 'reaction',
            }
          : {}),
      }
      logSet(v, { raw, at: loggedAt, timing, ...(recording ? { recordingOffsetSec: recording.offsetSec } : {}) }, then)
    },
    [holdStart, latency, bestBefore, exercise, recorder, logSet, walkedBack, dispatch],
  )

  const beginSet = useCallback(
    (film: boolean) => {
      if (!block || !exercise) return
      lastBeepRef.current = -1
      // Starting this round again is the "redo" of an interrupted attempt.
      if (interruptedAt.current?.bi === bi && interruptedAt.current?.si === si) {
        setInterrupted(null)
        setInterruptedRaw(null)
        interruptedAt.current = null
      }
      if (exercise.type === 'hold') {
        filmAttemptRef.current = film && recorder.status === 'live'
        const started = Date.now()
        leadStartedAtRef.current = started
        leadUsedRef.current = 0
        setLeadEnd(started + leadSec * 1000)
        setPhase('lead')
      } else {
        setPendingReps(block.target.kind === 'reps' ? block.target.reps : 0)
        setPhase('reps')
      }
    },
    [block, exercise, leadSec, recorder.status, bi, si],
  )

  /** Back out of a countdown; nothing has been done yet, so nothing is logged. */
  const cancelLead = useCallback(() => {
    filmAttemptRef.current = false
    lastBeepRef.current = -1
    setPhase('ready')
  }, [])

  // Skipping a unilateral round skips its partner too, so a set is never
  // trained on one side only — including the final pair of a block, which
  // used to move only to the second side.
  const skipSet = useCallback(() => {
    const pairStart = perSide && si % 2 === 0 && block !== undefined && si + 1 < block.sets
    moveBy(pairStart ? 2 : 1)
  }, [moveBy, perSide, si, block])

  const skipBlock = useCallback(() => {
    const b = workout.blocks[bi]
    moveBy(b ? b.sets - si : 1)
  }, [moveBy, workout, bi, si])

  /**
   * Apply a form change to the exact set it belongs to — in this session, and
   * on the saved session if it has already been saved.
   */
  const commitForm = useCallback(
    (at: number, merge: (current: FormCheck | undefined) => FormCheck) => {
      setLogs((current) => current.map((log) => (log.at === at ? { ...log, form: merge(log.form) } : log)))
      const sessionId = savedSessionIdRef.current
      if (sessionId) {
        const before = postSaveForms.current.has(at)
          ? postSaveForms.current.get(at)
          : logsRef.current.find((log) => log.at === at)?.form
        const next = merge(before)
        postSaveForms.current.set(at, next)
        dispatch({ type: 'UPDATE_SET_FORM', sessionId, setAt: at, form: next })
      }
    },
    [dispatch],
  )
  const applyHuman = useCallback(
    (at: number, review: HumanReview) => commitForm(at, (current) => mergeHumanReview(current, review)),
    [commitForm],
  )
  const applyModel = useCallback(
    (at: number, reading: ModelReading) => commitForm(at, (current) => mergeModelReading(current, reading)),
    [commitForm],
  )
  const onBusyChange = useCallback((opId: string, busy: boolean) => {
    setBusyOps((current) => {
      if (busy === current.has(opId)) return current
      const next = new Set(current)
      if (busy) next.add(opId)
      else next.delete(opId)
      return next
    })
  }, [])

  const setEndReason = useCallback((at: number, reason: EndReason | undefined) => {
    setLogs((current) =>
      current.map((log) => {
        if (log.at !== at) return log
        const { endReason: _previous, ...rest } = log
        void _previous
        return reason ? { ...rest, endReason: reason } : rest
      }),
    )
  }, [])

  /** A joint report from the middle of a session reaches the record now, saved session or not. */
  const recordAttemptSymptom = useCallback(
    (symptom: AttemptSymptom) => {
      dispatch({
        type: 'RECORD_SYMPTOM',
        event: { at: Date.now(), joints: symptom.joints, regions: symptom.regions, source: 'attempt' },
      })
    },
    [dispatch],
  )

  const adjustLastLog = useCallback((delta: number) => {
    setLogs((l) => {
      if (l.length === 0) return l
      const last = l[l.length - 1]
      const value = Math.max(0, round1(last.value + delta))
      // A hand edit replaces the value, not the observation: the timer's raw
      // reading stays on record and the set says it was edited, instead of
      // the reading being thrown away.
      return [...l.slice(0, -1), { ...last, value, ...(last.kind === 'hold' ? { timing: { method: 'edited' as const } } : {}) }]
    })
  }, [])

  /**
   * Re-credit the hold just logged against the other stop-allowance.
   *
   * Recomputed from the untouched stopwatch reading rather than nudged, so
   * tapping back and forth always lands on exactly the same two numbers and
   * cannot drift. Only for plain stopwatch readings — an edited or
   * interrupted value is not a stopwatch reading any more.
   */
  const setWalkedBackForLog = useCallback(
    (at: number, didWalk: boolean) => {
      setWalkedBack(didWalk)
      setLogs((l) =>
        l.map((log) => {
          if (log.at !== at || log.kind !== 'hold' || log.raw === undefined) return log
          if (log.timing && log.timing.method !== 'stopwatch') return log
          const value = creditedHoldSeconds(log.raw, log.exerciseId, state.settings.stopLatencySec, !didWalk)
          const allowanceSec = round1(log.raw - value)
          return {
            ...log,
            value,
            timing: {
              method: 'stopwatch',
              ...(allowanceSec > 0 ? { allowanceSec, allowance: didWalk ? ('walk-back' as const) : ('reaction' as const) } : {}),
            },
          }
        }),
      )
    },
    [state.settings.stopLatencySec],
  )

  /** The stopwatch correction shared by rest and the final summary screen. */
  const stopAllowanceCorrection = (log: SetLog) => {
    if (log.kind !== 'hold' || log.raw === undefined || !isMainProgressionHold(log.exerciseId)) return null
    if (log.timing && log.timing.method !== 'stopwatch') return null
    const credits = stopSetupCredits(log.raw, log.exerciseId, state.settings.stopLatencySec)
    if (credits.delta <= 0.05) return null
    const didWalk = Math.abs(log.value - credits.walkedBack) <= Math.abs(log.value - credits.withinReach)
    return (
      <button
        onClick={() => setWalkedBackForLog(log.at, !didWalk)}
        className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] font-medium text-ink2 transition hover:border-line-strong hover:text-ink"
      >
        <Icon name="rotate" size={13} className="text-accent-text" />
        {didWalk
          ? `Stopped it without getting up? +${credits.delta.toFixed(1)}s`
          : `Had to walk back to the phone? −${credits.delta.toFixed(1)}s`}
      </button>
    )
  }

  const clearInterrupted = useCallback(() => {
    setInterrupted(null)
    setInterruptedRaw(null)
    interruptedAt.current = null
  }, [])

  /**
   * Log the interrupted hold as what it is: an interrupted attempt, with the
   * timer's raw reading and the allowance held back, not a plain stopwatch set.
   */
  const logInterrupted = useCallback(() => {
    const where = interruptedAt.current
    if (interrupted === null || !where) return
    const raw = interruptedRaw ?? undefined
    const allowanceSec = raw !== undefined ? round1(raw - interrupted) : 0
    const entry = buildLog(where.bi, where.si, interrupted, {
      ...(raw !== undefined ? { raw } : {}),
      // The page was restored after this attempt, so its exact setup countdown
      // is unknowable. Leave it unspecified and let rest reconstruction use
      // the normal fallback.
      leadInSec: null,
      timing: {
        method: 'interrupted',
        ...(allowanceSec > 0.05 ? { allowanceSec, allowance: 'interruption' as const } : {}),
      },
    })
    clearInterrupted()
    if (!entry) return
    setLogs((l) => [...l, entry])
    if (phaseRef.current === 'ready' && where.bi === bi && where.si === si) advance(true)
  }, [interrupted, interruptedRaw, buildLog, clearInterrupted, advance, bi, si])

  const requestExit = useCallback(() => {
    if (phase === 'celebrate') {
      onExit()
      return
    }
    // A countdown never runs on behind a dialog — it would start a hold, and
    // a recording, under it.
    if (phase === 'lead') cancelLead()
    setConfirmExit(true)
  }, [phase, onExit, cancelLead])

  /** Stop here and review what was actually done. Distinct from discarding it. */
  const finishEarly = useCallback(() => {
    setConfirmExit(false)
    if (phase === 'hold') {
      stopHold('finish')
      return
    }
    if (phase === 'lead') cancelLead()
    enterSummary(true)
  }, [phase, stopHold, cancelLead, enterSummary])

  const discard = useCallback(() => {
    clearDraft()
    recorder.release()
    onExit()
  }, [recorder, onExit])

  const save = useCallback(() => {
    // Exactly once, however many taps arrive before the next render.
    if (savingRef.current || savedSessionIdRef.current || logs.length === 0) return
    savingRef.current = true
    const savedAt = Date.now()
    const endedAt = endedAtRef.current || savedAt
    const partial = finishedEarly || logs.length < totalSets
    const session: Session = {
      id: crypto.randomUUID(),
      // Never 0 in practice — a session cannot reach the summary without
      // leaving the intro — but a real timestamp beats an epoch date if it is.
      startedAt: startedAtRef.current || endedAt,
      endedAt,
      ...(pausedMsRef.current > 0 ? { pausedMs: pausedMsRef.current } : {}),
      savedAt,
      workoutName: workout.name,
      workoutKind: workout.kind,
      stepId: state.stepId,
      sets: logs,
      rpe,
      notes: notes.trim() || undefined,
      strategy: workout.strategy,
      checkIn: checkIn ?? undefined,
      // Skipped or unstarted work is not adherence; only what was done is here.
      completion: partial ? 'partial' : 'full',
      plannedRounds: totalSets,
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
    // Compare against the last run of this same workout — but not a partial
    // one: stopping early is not "down" on the full version.
    const plancheHold = (s: Session) =>
      Math.round(
        s.sets
          .filter((x) => x.kind === 'hold' && EXERCISE_BY_ID[x.exerciseId]?.category === 'planche')
          .reduce((t, x) => t + x.value, 0),
      )
    const prevSame = [...state.sessions]
      .filter((s) => s.workoutName === workout.name && s.completion !== 'partial')
      .sort((a, b) => b.startedAt - a.startedAt)[0]
    if (prevSame && !partial) {
      const delta = plancheHold(session) - plancheHold(prevSame)
      setInsight({
        delta,
        label:
          delta >= 0
            ? `+${delta}s planche hold time vs your last ${workout.name}`
            : `${delta}s planche hold time vs last time — down days are part of it`,
      })
    }
    savedSessionIdRef.current = session.id
    dispatch({ type: 'SAVE_SESSION', session })
    clearDraft()
    setEvents(ev)
    setSavedSession(session)
    setConfirmExit(false)
    setPhase('celebrate')
    sfx.done()
    if (ev.unlockedStep) confetti(2)
    else if (ev.prs.length > 0) confetti(1)
  }, [workout, state, logs, rpe, notes, dispatch, checkIn, finishedEarly, totalSets])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      // A layer is on top: let it own the keyboard, or Escape would also open
      // the exit prompt and Space would start a set behind the overlay.
      if (showCheckIn || showDemo || showRpeHelp || confirmExit || reviewOpen || problemReportOpen) return
      // A focused control owns its own Space (activating a button, play/pause
      // on a focused video). Escape and "skip rest" are not keys a button owns.
      if (
        e.target instanceof HTMLElement &&
        e.target.closest(
          'button, a, select, video, audio, [role="switch"], [role="button"], [role="slider"], [contenteditable]',
        ) &&
        e.code === 'Space'
      ) {
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        // Every Space action is a one-shot phase transition, so at most one may
        // run per phase. The claim is taken synchronously and cleared when the
        // phase actually changes.
        if (e.repeat || spaceClaimRef.current === phase) return
        if (phase === 'ready' && startWaitsForCamera) return
        spaceClaimRef.current = phase
        if (phase === 'intro') startSession()
        else if (phase === 'ready') beginSet(wantsFilm && cameraLive)
        else if (phase === 'hold') stopHold()
        else if (phase === 'reps') logSet(pendingReps)
      } else if (e.key.toLowerCase() === 's' && phase === 'rest') {
        setRestEnd(Date.now())
      } else if (e.key === 'Escape' && phase !== 'celebrate') {
        requestExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    phase,
    beginSet,
    stopHold,
    logSet,
    pendingReps,
    showCheckIn,
    showDemo,
    showRpeHelp,
    confirmExit,
    reviewOpen,
    problemReportOpen,
    startSession,
    startWaitsForCamera,
    wantsFilm,
    cameraLive,
    requestExit,
  ])

  const trainingEnd = endedAtRef.current || now
  const sessionElapsed = startedAtRef.current
    ? Math.max(0, (trainingEnd - startedAtRef.current - pausedMsRef.current) / 1000)
    : 0
  const lastLog = logs[logs.length - 1]

  const holdSecTotal = Math.round(logs.filter((l) => l.kind === 'hold').reduce((t, l) => t + l.value, 0))
  const layerOpen = showCheckIn || showDemo || showRpeHelp || confirmExit || reviewOpen || problemReportOpen

  // ————— Render helpers —————

  const header = (
    <div className="flex items-center justify-between gap-3 px-5 pt-[max(env(safe-area-inset-top),20px)] sm:px-8">
      <div className="min-w-0">
        <div className="truncate font-display text-[15px] font-semibold text-ink">{workout.name}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink3 tnum">
          <span>
            {doneSets}/{totalSets} sets · {fmtClock(sessionElapsed)}
          </span>
          {phase === 'summary' ? (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-text">
              Not saved yet
            </span>
          ) : null}
        </div>
      </div>
      <button
        onClick={requestExit}
        aria-label={phase === 'celebrate' ? 'Close' : 'Exit session'}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink2 hover:text-ink"
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

  /** The interrupted-hold card, on Ready for its own set and on the summary when still pending. */
  const interruptedCard = (where: 'ready' | 'summary') =>
    interrupted !== null ? (
      <div className="mx-auto mt-3 max-w-sm rounded-2xl border border-accent/30 bg-accent-soft p-4 text-left">
        <div className="text-[13.5px] font-semibold text-ink">Your last hold was interrupted</div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink2">
          The app was hidden mid-set
          {interruptedRaw !== null ? (
            <>
              {' '}
              at <span className="font-semibold text-ink tnum">{fmtHold(interruptedRaw)}</span> on the timer
            </>
          ) : null}
          . Logging it counts <span className="font-semibold text-ink tnum">{fmtHold(interrupted)}</span>
          {interruptedRaw !== null && interruptedRaw - interrupted > 0.05
            ? ' — the same allowance as stopping it yourself, because the moment you left the position is not known'
            : ''}
          .
        </p>
        <div className="mt-2.5 flex gap-2">
          <button
            onClick={logInterrupted}
            className="min-h-11 flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold text-on-accent"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            Log {fmtHold(interrupted)}
          </button>
          <button
            onClick={clearInterrupted}
            className="min-h-11 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink2 hover:text-ink"
          >
            {where === 'ready' ? 'Redo the set' : 'Leave it out'}
          </button>
        </div>
      </div>
    ) : null

  const formRowFor = (log: SetLog, rest: boolean) => (
    <FormCheckRow
      key={`form-${log.at}`}
      clipKey={log.clipKey ?? log.form?.clipKey ?? null}
      exerciseId={log.exerciseId}
      creditedHoldSec={log.value}
      analysisWindowSec={Math.max(0, log.value - (log.recordingOffsetSec ?? 0))}
      value={log.form}
      autoRun={state.settings.autoAnalyze}
      restReportAction={rest}
      onReportOpenChange={setProblemReportOpen}
      onReviewOpenChange={setReviewOpen}
      onHuman={(review) => applyHuman(log.at, review)}
      onModel={(reading) => applyModel(log.at, reading)}
      onBusyChange={onBusyChange}
    />
  )

  function body() {
    if (phase === 'intro') {
      const sections = [...new Set(workout.blocks.map((b) => b.section))]
      const primaryTarget = primaryTargetBlock(workout)
      const primaryExercise = primaryTarget ? EXERCISE_BY_ID[primaryTarget.exerciseId] : undefined
      // Say up front that filming happens — it only appears once the main
      // work starts, which is several sets in and easy to be surprised by.
      const willFilm =
        cameraOn && recorder.supported && workout.blocks.some((b) => b.section === 'main' && isFilmable(b.exerciseId))
      const requested =
        workout.request?.minutes ?? (workout.kind === 'auto' ? state.settings.sessionMinutes : undefined)
      const overBudget = requested !== undefined && workout.minutes > requested + 1
      return (
        <div className="mx-auto w-full max-w-lg px-5 pb-10">
          <div className="mt-6 rounded-3xl border border-line bg-surface p-6 shadow-card">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-[13px] font-medium uppercase tracking-wide text-ink3">Up next</div>
              <div className="text-[12.5px] text-ink3 tnum">About {workout.minutes} min</div>
            </div>
            <h1 className="mt-1 font-display text-[26px] font-bold text-ink">{workout.name}</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink2">{workout.focus}</p>
            {workout.purpose && workout.purpose !== workout.focus ? (
              <p className="mt-1 text-[13px] leading-relaxed text-ink3">
                <span className="font-semibold text-ink2">Why today:</span> {workout.purpose}
              </p>
            ) : null}
            {overBudget ? (
              <p className="mt-2 rounded-xl bg-raised px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
                You asked for about {requested} min. Under the current rules this plan's minimum runs about{' '}
                {workout.minutes} — it keeps the working sets rather than cutting them to fit.
              </p>
            ) : null}
            {workout.adjustments?.length ? (
              <div className="mt-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3">
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-accent-text">Adjusted for today</div>
                <ul className="mt-1 space-y-1 text-[13px] leading-relaxed text-ink">
                  {workout.adjustments.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {primaryTarget && primaryExercise ? (
              <div className="mt-4 flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-on-accent">
                  <Icon name="target" size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-accent-text">Main target</div>
                  <div className="truncate text-[14px] font-semibold text-ink">{primaryExercise.name}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[15px] font-bold text-ink tnum">{describeTarget(primaryTarget)}</div>
                  <div className="text-[11.5px] text-ink3 tnum">{describeBlock(primaryTarget)}</div>
                </div>
              </div>
            ) : null}
            {willFilm ? (
              <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-line bg-raised px-4 py-3 text-left">
                <Icon name="monitor" size={16} className="mt-0.5 shrink-0 text-accent-text" />
                <div>
                  <div className="text-[13.5px] font-medium text-ink">Side-view camera check on main sets</div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink2">
                    Put the phone directly beside you. Filming starts only once the camera is actually live — if it
                    cannot open, the set runs on the timer and says so.
                  </p>
                </div>
              </div>
            ) : null}
            <button
              onClick={startSession}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 font-display text-[17px] font-semibold text-on-accent shadow-card transition hover:brightness-105 active:scale-[0.99]"
              style={{ background: 'var(--t-btn-accent)' }}
            >
              <Icon name="play" size={18} /> Begin session
            </button>
            <div className="mt-2 text-center text-[12.5px] text-ink3">
              Space = start / stop · S = skip rest · Esc = exit
            </div>
            <div className="mt-5 space-y-4 border-t border-line pt-5">
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
        </div>
      )
    }

    if (phase === 'summary') return summary()
    if (phase === 'celebrate') return celebrate()
    if (!block || !exercise) return null

    if (phase === 'ready') {
      const isHold = exercise.type === 'hold'
      const target = block.target.kind === 'hold' ? `${block.target.sec}s` : `${block.target.reps} reps`
      const filmingThis = wantsFilm && cameraLive
      return (
        <div className="mx-auto w-full max-w-lg px-5 pb-10 text-center">
          <div className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-accent-text">
            {SECTION_LABEL[block.section]} · Set {displaySet} of {displayTotal}
          </div>
          <h1 className="mt-1 font-display text-[30px] font-bold leading-tight text-ink">{exercise.name}</h1>
          {perSide ? (
            <div className="mt-1.5 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3.5 py-1 text-[14px] font-semibold text-accent-text">
              {side === 'left' ? 'Left side' : 'Right side'}
              <span className="text-[12px] font-normal text-ink2">
                {si % 2 === 0
                  ? sideGap
                    ? `weaker side first — then the ${side === 'left' ? 'right' : 'left'}`
                    : `then you’ll do the ${side === 'left' ? 'right' : 'left'}`
                  : 'second half of this set'}
              </span>
            </div>
          ) : null}
          <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft px-4 py-2 text-accent-text">
            <Icon name="target" size={16} />
            <span className="text-[11px] font-bold uppercase tracking-wider">Target</span>
            <span className="text-[18px] font-bold text-ink tnum">
              {target}
              {perSide ? ' this side' : ''}
            </span>
          </div>
          {bestBefore ? (
            <div className="mt-1.5 text-[12.5px] text-ink3 tnum">
              {exercise.category === 'planche' ? `${surfaceLabel(surface)} ` : ''}best{' '}
              {exercise.type === 'hold' ? fmtHold(bestBefore) : `${bestBefore} reps`}
            </div>
          ) : null}
          {exercise.category === 'planche' && state.profile.equipment.includes('parallettes') ? (
            <div
              className="mt-2 inline-flex overflow-hidden rounded-xl border border-line"
              role="group"
              aria-label="Training surface"
            >
              {TRAINING_SURFACES.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSurface(item.id)}
                  aria-pressed={surface === item.id}
                  className={`min-h-10 px-3.5 py-1.5 text-[12.5px] font-semibold transition ${
                    surface === item.id ? 'bg-accent text-on-accent' : 'bg-surface text-ink2 hover:text-ink'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
          {assistApplies(exercise) ? (
            <SetupRow
              key={exercise.id}
              exerciseName={exercise.name}
              setup={setup}
              onSave={(next) => dispatch({ type: 'SET_SETUP', exerciseId: exercise.id, setup: next })}
            />
          ) : null}
          {exercise.category === 'planche' ? (
            <Figure step={figureFor(exercise.id)} className="mx-auto mt-2 h-36 w-44 text-ink" />
          ) : (
            <div className="mt-6" />
          )}
          {interruptedAt.current?.bi === bi && interruptedAt.current?.si === si ? interruptedCard('ready') : null}
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
                <span className="flex min-w-0 items-center gap-2 text-left text-[13.5px] text-ink2" role="status">
                  <Icon name="monitor" size={15} className={filmingThis ? 'shrink-0 text-accent-text' : 'shrink-0 text-ink3'} />
                  {!cameraOn
                    ? 'Camera off — this set is timed only'
                    : filmingThis
                      ? 'Camera live — this set will be filmed'
                      : cameraFailure
                        ? 'Camera not available'
                        : 'Opening the camera…'}
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
              {cameraOn && !cameraFailure ? (
                // The box takes the camera's real shape rather than forcing
                // 16:9, and follows it when the phone is turned — the preview
                // exists to show what will actually be in the clip.
                <div
                  className="relative mt-2 w-full overflow-hidden rounded-2xl border border-line bg-black"
                  style={{ aspectRatio: recorder.frame ? recorder.frame.width / recorder.frame.height : 16 / 9 }}
                >
                  <video ref={recorder.previewRef} muted playsInline className="h-full w-full object-cover" />
                  <div className="pointer-events-none absolute inset-[8%] rounded-xl border border-dashed border-accent/70" />
                  <div className="pointer-events-none absolute inset-x-[8%] top-1/2 h-px bg-accent/60" />
                  {/* Live "can the camera actually see you" check. Deliberately
                      not gated on autoAnalyze: bad placement is the top reason
                      a clip comes back ungradeable, for everyone who films.
                      FramingCheck's own model-ready guard still prevents any
                      unwanted model download. */}
                  <FramingCheck videoRef={recorder.videoRef} active={recorder.status === 'live'} />
                  {!cameraLive ? (
                    <div className="absolute inset-0 grid place-items-center text-[13px] text-white/80">
                      Opening the camera…
                    </div>
                  ) : null}
                  <div className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-1.5 text-[11.5px] text-white/85">
                    Side-on · whole body and both hands inside the box · phone level.
                  </div>
                </div>
              ) : null}
              {cameraOn && cameraLive ? (
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="text-left text-[12.5px] text-ink3">
                    {recorder.lens === 'ultra-wide'
                      ? 'Ultra-wide (0.5×) lens in use'
                      : recorder.lens === 'standard'
                        ? recorder.wide
                          ? 'Standard lens — no ultra-wide found'
                          : 'Standard lens'
                        : 'Lens not reported by this device'}
                    {recorder.frame ? ` · ${recorder.frame.width}×${recorder.frame.height}` : ''}
                  </span>
                  <button
                    onClick={() => recorder.setWide(!recorder.wide)}
                    aria-pressed={recorder.wide}
                    className={`min-h-9 shrink-0 rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition ${
                      recorder.wide ? 'border-accent/40 bg-accent-soft text-accent-text' : 'border-line bg-raised text-ink2'
                    }`}
                  >
                    Prefer 0.5×
                  </button>
                </div>
              ) : null}
              {cameraOn && cameraLive && recorder.portrait ? (
                <p className="mt-1.5 flex items-start gap-1.5 text-left text-[12.5px] leading-relaxed text-accent-text">
                  <Icon name="rotate" size={14} className="mt-0.5 shrink-0" />
                  Turn the phone on its side. A planche is a wide shape, and an upright frame cuts off your hands or
                  your feet.
                </p>
              ) : null}
              {cameraOn && cameraFailure ? (
                <div
                  className="mt-1.5 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-left text-[12.5px] leading-relaxed text-ink"
                  role="alert"
                >
                  {cameraFailure}
                  {recorder.status !== 'unsupported' ? (
                    <button
                      onClick={() => void recorder.prepare()}
                      className="ml-1 min-h-9 font-semibold text-accent-text underline underline-offset-2"
                    >
                      Try again
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <button
            onClick={() => beginSet(filmingThis)}
            disabled={startWaitsForCamera}
            className="mt-6 inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl px-6 py-4 font-display text-[17px] font-semibold text-on-accent shadow-card transition hover:brightness-105 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            <Icon name="play" size={18} />
            {!isHold
              ? 'Begin set'
              : startWaitsForCamera
                ? 'Waiting for the camera…'
                : wantsFilm && !cameraLive
                  ? `Start without filming · ${leadSec}s lead-in`
                  : `Start · ${leadSec}s lead-in`}
          </button>
          {startWaitsForCamera ? (
            <button
              onClick={() => beginSet(false)}
              className="mx-auto mt-1 block px-2 py-2 text-[13px] font-medium text-ink2 underline-offset-2 hover:text-ink hover:underline"
            >
              Start without filming
            </button>
          ) : null}
          {/* Bare text buttons measured 20px tall, under the 24px minimum, on
              the one screen where taps are one-handed and mid-workout. The
              padding buys a real target without changing how the row looks. */}
          <div className="mt-2 flex flex-wrap justify-center gap-x-4 text-[13px]">
            <button onClick={() => setShowDemo(true)} className="px-1 py-2 text-accent-text underline-offset-2 hover:underline">
              How do I do this?
            </button>
            <button onClick={skipSet} className="px-1 py-2 text-ink3 underline-offset-2 hover:text-ink hover:underline">
              {perSide && si % 2 === 0 ? 'Skip this pair' : 'Skip set'}
            </button>
            <button onClick={skipBlock} className="px-1 py-2 text-ink3 underline-offset-2 hover:text-ink hover:underline">
              Skip exercise
            </button>
          </div>
        </div>
      )
    }

    if (phase === 'lead') {
      const n = Math.ceil(leadRemaining)
      const target = block.target.kind === 'hold' ? `${block.target.sec}s` : `${block.target.reps} reps`
      return (
        <div className="mx-auto flex w-full max-w-lg flex-col items-center px-5 pb-10 text-center">
          <div className="mt-6 text-[14px] font-medium uppercase tracking-wide text-ink2">Get into position</div>
          <div className="relative mt-2 grid h-56 w-56 place-items-center">
            <div className="absolute inset-0 rounded-full bg-accent-soft blur-2xl" />
            <div key={n} className="font-timer relative text-[130px] leading-none text-accent-text animate-pop-num">
              {n}
            </div>
          </div>
          <div className="text-[15px] font-medium text-ink2">{exercise.name}</div>
          <div className="mt-2 inline-flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft px-3.5 py-2 text-[14px] font-semibold text-ink">
            <Icon name="target" size={15} className="text-accent-text" /> Target {target}
            {perSide ? ` · ${side === 'left' ? 'left' : 'right'} side` : ''}
          </div>
          {wantsFilm ? (
            <div className="mt-2 text-[12.5px] text-ink3">
              {filmAttemptRef.current ? 'Filming starts at Go.' : 'Timer only — this set is not being filmed.'}
            </div>
          ) : null}
          <div className="mt-8 flex gap-2.5">
            <button
              onClick={() => setLeadEnd(Date.now())}
              className="min-h-11 rounded-xl border border-line bg-surface px-5 py-2.5 text-[14px] font-medium text-ink2 hover:text-ink"
            >
              Skip lead-in
            </button>
            <button
              onClick={cancelLead}
              className="min-h-11 rounded-xl border border-line bg-surface px-5 py-2.5 text-[14px] font-medium text-ink3 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )
    }

    if (phase === 'hold') {
      const target = block.target.kind === 'hold' ? block.target.sec : 0
      const overTarget = holdCredited >= target
      const isPr = bestBefore !== undefined && holdCredited > bestBefore
      return (
        <div className="mx-auto flex w-full max-w-lg flex-col items-center px-5 text-center">
          <div className="mt-2 text-[14px] font-medium text-ink2">
            {exercise.name} · Set {displaySet}/{displayTotal}
            {perSide ? ` · ${side === 'left' ? 'Left' : 'Right'}` : ''}
          </div>
          {filmAttemptRef.current ? (
            <div className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-medium text-danger-text">
              <span className="h-2 w-2 rounded-full bg-danger" aria-hidden="true" /> Filming
            </div>
          ) : null}
          <div className="relative mt-4">
            <div className="pointer-events-none absolute inset-6 rounded-full bg-accent-soft blur-3xl" />
            <ProgressRing
              value={Math.min(1, holdCredited / Math.max(1, target))}
              size={ringSize}
              stroke={ringSize > 220 ? 13 : 10}
              glow
              color={isPr || overTarget ? 'var(--t-ok)' : undefined}
              className="relative"
            >
              <div>
                <div
                  className={`font-timer leading-none ${isPr || overTarget ? 'text-ok-text' : 'text-ink'}`}
                  style={{ fontSize: Math.round(ringSize * 0.25) }}
                >
                  {holdElapsed.toFixed(1)}
                </div>
                <div className="mt-1.5 text-[14px] font-semibold">
                  {isPr ? (
                    <span className="text-ok-text">PR secured — exit under control</span>
                  ) : overTarget ? (
                    <span className="text-ok-text">target reached — stop while clean</span>
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
          {/* Sticky so it stays reachable on a short screen held sideways. */}
          <div className="sticky bottom-0 z-10 mt-6 w-full max-w-sm bg-bg/80 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 backdrop-blur-sm">
            <button
              onClick={() => stopHold()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-danger px-6 py-5 font-display text-[18px] font-semibold text-white shadow-card transition active:scale-[0.99]"
            >
              <Icon name="stop" size={18} /> Stop hold
            </button>
            <div className="mt-2 text-[12.5px] text-ink3">or press Space</div>
          </div>
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
            <div className="w-32 font-display text-[80px] font-bold leading-none text-ink tnum" aria-live="polite">
              {pendingReps}
            </div>
            <button
              onClick={() => setPendingReps((r) => r + 1)}
              aria-label="More reps"
              className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface text-ink hover:border-line-strong"
            >
              <Icon name="plus" size={20} />
            </button>
          </div>
          <div className="mt-1 text-[13px] text-ink3 tnum">target {block.target.kind === 'reps' ? block.target.reps : 0}</div>
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
      const note = lastLog ? timingNote(lastLog) : null
      return (
        <div className="relative mx-auto flex w-full max-w-lg flex-col items-center px-5 pb-10 text-center">
          <div className="mt-4 text-[14px] font-medium uppercase tracking-wide text-ink3">
            {restRemaining <= 0 && (reviewOpen || problemReportOpen) ? 'Rest over — finish reviewing to continue' : 'Rest'}
          </div>
          <ProgressRing value={restRemaining / Math.max(1, total)} size={Math.min(210, ringSize)} stroke={10} className="mt-4">
            <div>
              <div className="font-timer text-[54px] leading-none text-ink">{fmtClock(restRemaining)}</div>
            </div>
          </ProgressRing>
          {lastLog ? (
            <div className="mt-5 flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border border-line bg-surface px-4 py-2 text-[13.5px] text-ink2">
              Logged {lastLog.kind === 'hold' ? fmtHold(lastLog.value) : `${lastLog.value} reps`}
              {note ? <span className="text-[12px] text-ink3 tnum">{note}</span> : null}
              <span className="flex gap-1">
                <button
                  onClick={() => adjustLastLog(-1)}
                  aria-label="Decrease logged value"
                  className="grid h-10 w-10 place-items-center rounded-full border border-line bg-raised text-ink2 hover:text-ink"
                >
                  <Icon name="minus" size={13} />
                </button>
                <button
                  onClick={() => adjustLastLog(1)}
                  aria-label="Increase logged value"
                  className="grid h-10 w-10 place-items-center rounded-full border border-line bg-raised text-ink2 hover:text-ink"
                >
                  <Icon name="plus" size={13} />
                </button>
              </span>
            </div>
          ) : null}
          {/* The one question the stopwatch cannot answer for itself. Asked
              where the number it changes is already on screen, phrased as what
              the tap does, and only when the two answers actually differ. */}
          {lastLog ? stopAllowanceCorrection(lastLog) : null}
          {lastLog ? (
            <AttemptEnd
              key={`end-${lastLog.at}`}
              log={lastLog}
              askReason={lastLog.kind === 'hold' && (lastLog.section === 'main' || lastLog.section === 'strength')}
              onReason={(reason) => setEndReason(lastLog.at, reason)}
              onSymptom={recordAttemptSymptom}
              onEndSession={() => enterSummary(true)}
            />
          ) : null}
          {lastLog?.kind === 'hold' &&
          lastLog.section === 'main' &&
          (lastLog.exerciseId === STEP_BY_ID[state.stepId].keyExerciseId || isFilmable(lastLog.exerciseId))
            ? formRowFor(lastLog, true)
            : null}

          <div className="mt-5 text-[14px] text-ink2">
            Next: <span className="font-medium text-ink">{nx.name}</span>
            {nx.perSide ? (
              <>
                {' '}
                · <span className="font-medium text-ink">{side} side</span>
              </>
            ) : null}{' '}
            · set {Math.floor(si / (nx.perSide ? 2 : 1)) + 1}/{Math.ceil(nb.sets / (nx.perSide ? 2 : 1))}
          </div>
          <div className="mt-5 flex gap-3">
            <button
              onClick={() => setRestEnd((e) => Math.max(e, Date.now()) + 30_000)}
              className="min-h-11 rounded-xl border border-line bg-surface px-5 py-2.5 text-[14px] font-medium text-ink2 hover:text-ink"
            >
              +30s
            </button>
            <button
              onClick={() => setRestEnd(Date.now())}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-5 py-2.5 text-[14px] font-medium text-ink2 hover:text-ink"
            >
              <Icon name="skip" size={15} /> Skip rest
            </button>
          </div>
        </div>
      )
    }
    return null
  }

  function summary() {
    const waiting = clipsFinalizing > 0 || busyOps.size > 0
    // The final set of a session skips the rest screen, so the stop question,
    // the end reason and the form review all need a home here.
    const finalPathHold = [...logs]
      .reverse()
      .find((log) => log.kind === 'hold' && log.raw !== undefined && isMainProgressionHold(log.exerciseId))
    const lastMain = [...logs]
      .reverse()
      .find(
        (l) =>
          l.kind === 'hold' &&
          l.section === 'main' &&
          (l.exerciseId === STEP_BY_ID[state.stepId].keyExerciseId || isFilmable(l.exerciseId)),
      )
    const blocking = logs.filter((log) => setNeedsProgressionFormEvidence(log, state))
    const unreviewedFilmed = logs.filter((log) => {
      const hasClip = Boolean(log.clipKey ?? log.form?.clipKey)
      if (!hasClip || log.kind !== 'hold' || log.section !== 'main' || !isFilmable(log.exerciseId)) return false
      if (log.form?.confirmed !== true) return true
      if (log.exerciseId === 'frog-stand') return log.form.visualReviewPassed !== true
      if (!log.form.auto) return true
      if (requiresFlightConfirmation(log.exerciseId) && log.form.flightConfirmed !== true) return true
      return unseenVariantCriteria(log.exerciseId, log.form.auto).length > 0 && log.form.variantConfirmed !== true
    })
    const formLogs = lastMain
      ? [...unreviewedFilmed, ...blocking, lastMain].filter(
          (log, index, all) => all.findIndex((candidate) => candidate.at === log.at) === index,
        )
      : []
    const lastNote = lastLog ? timingNote(lastLog) : null
    return (
      <div className="mx-auto w-full max-w-lg px-5 pb-10">
        <h1 className="mt-6 text-center font-display text-[26px] font-bold text-ink">
          {finishedEarly ? 'Finished early' : 'Session done 🎉'}
        </h1>
        <p className="mt-1 text-center text-[13px] text-ink2">Review and save — nothing is kept until you do.</p>
        {doneSets < totalSets ? (
          <p className="mx-auto mt-2 max-w-sm text-center text-[12.5px] leading-relaxed text-ink3">
            {doneSets} of {totalSets} planned rounds done. Only what you did is saved — skipped work does not count as
            done{finishedEarly ? ', and stopping early is never held against you' : ''}.
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          {[
            ['Training time', fmtClock(sessionElapsed)],
            ['Sets', String(doneSets)],
            ['Hold time', `${holdSecTotal}s`],
          ].map(([l, v]) => (
            <div key={l} className="rounded-2xl border border-line bg-surface p-3 text-center">
              <div className="text-[12px] text-ink3">{l}</div>
              <div className="font-display text-[20px] font-semibold text-ink tnum">{v}</div>
            </div>
          ))}
        </div>
        {interruptedAt.current ? interruptedCard('summary') : null}
        {lastLog ? (
          <div className="mt-3 text-center">
            <div className="text-[12px] text-ink3">
              Last set: {lastLog.kind === 'hold' ? fmtHold(lastLog.value) : `${lastLog.value} reps`}{' '}
              {EXERCISE_BY_ID[lastLog.exerciseId]?.name ?? ''}
              {lastNote ? ` ${lastNote}` : ''}
            </div>
            {finalPathHold && finalPathHold.at === lastLog.at ? stopAllowanceCorrection(finalPathHold) : null}
            <AttemptEnd
              key={`end-${lastLog.at}`}
              log={lastLog}
              askReason={lastLog.kind === 'hold' && (lastLog.section === 'main' || lastLog.section === 'strength')}
              onReason={(reason) => setEndReason(lastLog.at, reason)}
              onSymptom={recordAttemptSymptom}
            />
          </div>
        ) : null}
        {finalPathHold && finalPathHold.at !== lastLog?.at ? (
          <div className="mt-3 text-center">
            <div className="text-[12px] text-ink3">Final Path hold: {fmtHold(finalPathHold.value)} credited</div>
            {stopAllowanceCorrection(finalPathHold)}
          </div>
        ) : null}
        {formLogs.map((log) => formRowFor(log, false))}

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-center gap-2 text-[14px] font-medium text-ink" id="rpe-label">
            How hard was it? (RPE)
            <button
              onClick={() => setShowRpeHelp(true)}
              aria-label="What is RPE?"
              className="grid h-8 w-8 place-items-center rounded-full border border-line text-ink3 hover:text-ink"
            >
              <Icon name="info" size={12} />
            </button>
          </div>
          <div className="flex gap-2" role="group" aria-labelledby="rpe-label">
            {[6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                onClick={() => setRpe(rpe === n ? undefined : n)}
                aria-pressed={rpe === n}
                className={`min-h-11 flex-1 rounded-xl border py-2.5 font-display text-[16px] font-semibold transition ${
                  rpe === n ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-surface text-ink2 hover:text-ink'
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
          aria-label="Session notes"
          rows={2}
          className="mt-4 w-full resize-none rounded-2xl border border-line bg-surface p-4 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
        />
        {logs.some((log) => setNeedsProgressionFormEvidence(log, state)) ? (
          <p className="mt-4 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-center text-[13px] text-ink">
            This unlock-level hold will still save as a PR, but mastery needs both your confirmed Clean rating and a
            passing filmed form check. True flight skills also need your no-foot-support confirmation. One isolated
            camera flag may pass; two or more flags do not.
          </p>
        ) : null}
        {waiting ? (
          <p className="mt-3 text-center text-[12.5px] text-ink3" role="status">
            {clipsFinalizing > 0 ? 'Finishing your clip…' : 'Finishing the form check…'}
          </p>
        ) : null}
        <button
          onClick={save}
          disabled={logs.length === 0 || waiting}
          className="mt-4 w-full rounded-2xl px-6 py-4 font-display text-[17px] font-semibold text-on-accent shadow-card transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--t-btn-accent)' }}
        >
          Save session
        </button>
        {waiting && logs.length > 0 ? (
          <button
            onClick={save}
            className="mt-2 w-full rounded-2xl border border-line bg-surface py-3 text-[14px] font-medium text-ink"
          >
            Save without waiting
          </button>
        ) : null}
        {waiting && logs.length > 0 ? (
          <p className="mt-1 text-center text-[11.5px] leading-relaxed text-ink3">
            A check or clip still finishing attaches to the saved set if the app stays open; otherwise the clip stays in
            your gallery to check later.
          </p>
        ) : null}
        {logs.length === 0 ? (
          <p className="mt-2 text-center text-[12.5px] text-ink3">Nothing was logged, so there is nothing to save.</p>
        ) : null}
        <button
          onClick={() => setConfirmExit(true)}
          className="mt-2 w-full rounded-2xl py-3 text-[14px] font-medium text-ink3 hover:text-ink"
        >
          {logs.length ? 'Discard…' : 'Close'}
        </button>
      </div>
    )
  }

  function celebrate() {
    if (!events || !savedSession) return null
    const unlocked = events.unlockedStep ? STEP_BY_ID[events.unlockedStep] : undefined
    return (
      <div className="mx-auto w-full max-w-lg px-5 pb-10 text-center">
        {unlocked ? (
          <div className="mt-6 rounded-3xl border border-accent/30 bg-accent-soft p-6">
            <div className="text-[13px] font-semibold uppercase tracking-wide text-accent-text">Step unlocked</div>
            <Figure step={unlocked.id} className="mx-auto mt-2 h-32 w-40 text-ink" />
            <div className="font-display text-[26px] font-bold text-ink">{unlocked.name}</div>
            <p className="mt-1 text-[14px] text-ink2">{unlocked.tagline}</p>
          </div>
        ) : (
          <h1 className="mt-8 font-display text-[26px] font-bold text-ink">
            {persist.primary === 'ok' ? 'Saved ✓' : 'Saved in the app'}
          </h1>
        )}
        <p className="mt-1 text-[12.5px] text-ink3" role="status">
          {persist.primary === 'ok'
            ? 'Stored on this device.'
            : 'Not yet written to this device’s storage — use the warning at the top to export a backup now.'}
        </p>
        {insight ? (
          <div
            className={`mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13.5px] font-medium ${
              insight.delta >= 0 ? 'border-ok/30 bg-ok-soft text-ink' : 'border-line bg-surface text-ink2'
            }`}
          >
            <Icon name="chart" size={15} className={insight.delta >= 0 ? 'text-ok-text' : 'text-ink3'} />
            {insight.label}
          </div>
        ) : null}
        {debrief.length > 0 ? (
          <div className="mt-4 rounded-2xl border border-line bg-surface p-4 text-left">
            <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-accent-text">
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
                <div key={`${p.exerciseId}-${p.surface ?? 'overall'}`} className="flex items-baseline justify-between py-1 text-[14.5px]">
                  <span className="text-ink">
                    {ex?.name ?? p.exerciseId}
                    {p.surface ? <span className="ml-1 text-[12px] text-ink3">· {surfaceLabel(p.surface)}</span> : null}
                  </span>
                  <span className="font-semibold text-accent-text tnum">
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
                <div key={id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 text-left">
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

  const holdRunning = phase === 'hold' && holdElapsed > 1
  const canFinishEarly = phase !== 'summary' && (logs.length > 0 || holdRunning)

  return (
    <div
      ref={sessionRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${workout.name} training session`}
      aria-hidden={layerOpen ? true : undefined}
      inert={layerOpen ? true : undefined}
      tabIndex={-1}
      className="fixed inset-0 z-40 overflow-y-auto bg-bg outline-none"
    >
      <div className="app-ambient min-h-full pb-8">
        {header}
        {phase !== 'celebrate' ? progressBar : null}
        {body()}
      </div>
      <Modal open={showCheckIn} onClose={() => setShowCheckIn(false)} label="Readiness check-in">
        <CheckInForm
          context={checkInContext}
          onDone={(c) => {
            setCheckIn(c)
            setShowCheckIn(false)
            // Re-plan today's session with the answers, not just tomorrow's.
            // What changed is listed in the brief, decided by the same rails.
            onCheckInAnswered?.(c)
            pushToast('Today’s plan now reflects your answers — anything adjusted is listed below.', 'info', 4500)
          }}
          onSkip={() => setShowCheckIn(false)}
        />
      </Modal>

      <Modal
        open={showDemo}
        onClose={() => setShowDemo(false)}
        label={exercise ? `${exercise.name} exercise guide` : 'Exercise guide'}
        wide
      >
        {exercise ? <DemoHelp exercise={exercise} pinnedUrl={state.videoLinks[exercise.id]} /> : null}
      </Modal>

      <Modal open={showRpeHelp} onClose={() => setShowRpeHelp(false)} label="Rate of perceived exertion help">
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
                <span className="font-display font-bold text-accent-text tnum">{n}</span>
                <span className="text-ink2">{d}</span>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        open={confirmExit}
        onClose={() => setConfirmExit(false)}
        label={phase === 'summary' ? 'Leave without saving' : 'Leave training session'}
      >
        <div className="p-6">
          {phase === 'summary' ? (
            <>
              <h2 className="pr-10 font-display text-[19px] font-semibold text-ink">
                {logs.length ? 'Leave without saving?' : 'Close this session?'}
              </h2>
              <p className="mt-1.5 text-[14px] text-ink2">
                {logs.length
                  ? `${logs.length} logged set${logs.length === 1 ? ' is' : 's are'} not saved yet. Discarding removes ${
                      logs.length === 1 ? 'it' : 'them'
                    } for good.`
                  : 'Nothing was logged.'}
              </p>
              <div className="mt-5 flex flex-col gap-2">
                {logs.length ? (
                  <button
                    onClick={save}
                    className="min-h-12 rounded-xl px-4 py-3 text-[14.5px] font-semibold text-on-accent"
                    style={{ background: 'var(--t-btn-accent)' }}
                  >
                    Save session
                  </button>
                ) : null}
                <button
                  onClick={() => setConfirmExit(false)}
                  className="min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-[14.5px] font-medium text-ink"
                >
                  Keep reviewing
                </button>
                <button
                  onClick={discard}
                  className={`min-h-12 rounded-xl px-4 py-3 text-[14.5px] font-semibold ${
                    logs.length ? 'bg-danger text-white' : 'border border-line bg-surface text-ink2'
                  }`}
                >
                  {logs.length ? `Discard ${logs.length} set${logs.length === 1 ? '' : 's'}` : 'Close'}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="pr-10 font-display text-[19px] font-semibold text-ink">Leave this session?</h2>
              <p className="mt-1.5 text-[14px] text-ink2">
                {canFinishEarly
                  ? `Finish early to review and save what you did${
                      holdRunning ? ' — the hold in progress is stopped and logged' : ''
                    }, or discard it all.`
                  : 'Nothing has been logged yet.'}
              </p>
              <div className="mt-5 flex flex-col gap-2">
                {canFinishEarly ? (
                  <button
                    onClick={finishEarly}
                    className="min-h-12 rounded-xl px-4 py-3 text-[14.5px] font-semibold text-on-accent"
                    style={{ background: 'var(--t-btn-accent)' }}
                  >
                    Finish early &amp; review
                  </button>
                ) : null}
                <button
                  onClick={() => setConfirmExit(false)}
                  className="min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-[14.5px] font-medium text-ink"
                >
                  Keep training
                </button>
                <button
                  onClick={discard}
                  className={`min-h-12 rounded-xl px-4 py-3 text-[14.5px] font-semibold ${
                    canFinishEarly ? 'bg-danger text-white' : 'border border-line bg-surface text-ink2'
                  }`}
                >
                  {canFinishEarly
                    ? `Discard${logs.length ? ` ${logs.length} set${logs.length === 1 ? '' : 's'}` : ''}`
                    : 'Leave'}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
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
          <Icon name="play" size={15} className="text-accent-text" /> Watch demos on YouTube
        </a>
      )}
      <div className="mt-4 rounded-2xl border border-line bg-raised p-4">
        <div className="mb-2 text-[13px] font-semibold text-ink">Step by step</div>
        <ol className="space-y-1.5 text-[13.5px] leading-relaxed text-ink2">
          {exercise.howTo.map((s, i) => (
            <li key={s} className="flex gap-2.5">
              <span className="font-display font-semibold text-accent-text tnum">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-3 rounded-2xl border border-line bg-raised p-4">
        <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-danger-text">
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
