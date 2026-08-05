import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BodyRegion,
  CheckIn,
  Exercise,
  FormCheck,
  FormIssue,
  FormRating,
  Section,
  Session,
  SessionEvents,
  SetLog,
  TrainingSurface,
  Workout,
} from '../types'
import { BODY_REGIONS } from '../types'
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
import { ClipPlayer } from '../components/ClipPlayer'
import { FramingCheck } from '../components/FramingCheck'
import {
  passesProgressionFormCheck,
  requiresFlightConfirmation,
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

/**
 * How long a form check may run before the session stops waiting for it.
 *
 * Generous, because a genuine first-run model download on a slow connection is
 * legitimately slow and cutting it off early would waste the athlete's clip.
 */
const ANALYSIS_TIMEOUT_MS = 45_000

/**
 * Bound the form check so a stalled one cannot trap the whole session.
 *
 * `analyseClip` already converts every *rejection* into a friendly result, but
 * a promise that never settles is not a rejection. The model fetch is several
 * megabytes over whatever network the gym has, and on a captive portal it can
 * hang indefinitely — at which point the `finally` that clears the busy flag
 * never runs, Save stays disabled forever, and the athlete's only remaining
 * exit is Discard, which throws away every set they logged. A session must
 * never become unsavable because a camera check went quiet.
 */
function withAnalysisTimeout(work: Promise<PoseFormResult>): Promise<PoseFormResult> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      resolve(
        emptyResult(
          'The form check ran out of time — usually a slow or blocked connection while the model downloads. Your set is saved either way, and you can run the check later from the clip in Learn.',
        ),
      )
    }, ANALYSIS_TIMEOUT_MS)
    work
      .then((res) => {
        window.clearTimeout(timer)
        resolve(res)
      })
      .catch(() => {
        window.clearTimeout(timer)
        resolve(emptyResult('That form check could not be completed.'))
      })
  })
}

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
  const restoredSetup = restoredSessionSetup(resumeFrom, state.settings)
  const resumeExerciseId = resumeFrom
    ? workout.blocks[resumeFrom.blockIndex]?.exerciseId
    : undefined
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
  /** Seconds from a hold that was cut short by the page being discarded. */
  const [interrupted, setInterrupted] = useState<number | null>(
    resumeFrom?.interrupted !== undefined
      ? resumeFrom.interrupted
      : resumeFrom?.wasHolding && resumeFrom.holdElapsed > 1
      ? Math.max(0, Math.round((resumeFrom.holdElapsed - resumeLatency) * 10) / 10)
      : null,
  )
  const [events, setEvents] = useState<SessionEvents | null>(null)
  const [savedSession, setSavedSession] = useState<Session | null>(null)
  const [confirmExit, setConfirmExit] = useState(false)
  const [showDemo, setShowDemo] = useState(false)
  const [showRpeHelp, setShowRpeHelp] = useState(false)
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
  const [pendingClip, setPendingClip] = useState<{ key: string; logAt: number } | null>(null)
  const [clipFinalizing, setClipFinalizing] = useState(false)
  const [analysingSets, setAnalysingSets] = useState<Set<number>>(() => new Set())
  const recorder = useFormRecorder()
  const [showCheckIn, setShowCheckIn] = useState(askCheckIn && !resumeFrom)
  const [insight, setInsight] = useState<{ delta: number; label: string } | null>(null)
  const [debrief, setDebrief] = useState<CoachDecision[]>([])
  const sessionRef = useRef<HTMLDivElement | null>(null)
  /**
   * When training actually started — stamped on "Begin session", not on mount.
   *
   * Opening a workout is not training: the intro screen is a plan you might
   * read for a minute, walk away from, or back out of entirely. Starting the
   * clock there inflated every session's duration by however long you spent
   * deciding, and that number is saved on the session and shown in the summary.
   * 0 means "not started yet".
   */
  const startedAtRef = useRef(resumeFrom?.startedAt ?? 0)
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
   * weaker side goes first while the athlete is freshest — the coach's
   * "lead with the weak side" advice used to be contradicted right here by a
   * hard-coded left-first order. The set counter still shows real rounds.
   */
  const perSide = Boolean(exercise?.perSide)
  const sideGap = useMemo(() => readSignals(state).sideGap, [state])
  const weakSideFirst = sideGap?.weakSide ?? 'left'
  const side: 'left' | 'right' =
    si % 2 === 0 ? weakSideFirst : weakSideFirst === 'left' ? 'right' : 'left'
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
        log.exerciseId === exercise.id &&
        (!surfaceAware || log.surface === surface) &&
        log.value > best
          ? log.value
          : best,
      0,
    )
    if (stored === undefined && thisSession === 0) return undefined
    return Math.max(stored ?? 0, thisSession)
  }, [exercise, state.prs, logs, surface])
  const leadSec = leadInSecondsFor(exercise?.id)
  const latency =
    exercise?.type === 'hold'
      ? stopLatencySecondsFor(exercise.id, state.settings.stopLatencySec, !walkedBack)
      : 0
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
    const snapshot = (override?: { cameraOn?: boolean }) => {
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
        // These are live session choices. Falling back to Settings after a
        // crash can change the next hold's seconds or reopen a camera the
        // athlete explicitly switched off.
        walkedBack,
        cameraOn: override?.cameraOn ?? cameraOn,
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
        // React state may not flush before a hidden tab is discarded. Persist
        // the forced-off camera synchronously instead of relying on a later
        // render that the browser is free never to run.
        snapshot(filming ? { cameraOn: false } : undefined)
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
    walkedBack,
    cameraOn,
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
      leadUsedRef.current = Math.max(0, (Date.now() - leadStartedAtRef.current) / 1000)
      stoppingHoldRef.current = false
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

  /**
   * Leave the intro and start the clock. Both the button and the Space key
   * come through here so the two can never disagree about when a session
   * began, and a resumed session keeps its original start time.
   */
  const startSession = useCallback(() => {
    if (!startedAtRef.current) startedAtRef.current = Date.now()
    setPhase('ready')
  }, [])

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
    (value: number, raw?: number, at = Date.now(), usedLeadInSec: number | null = leadUsedRef.current) => {
      if (!block || !exercise) return
      setLogs((l) => [
        ...l,
        {
          exerciseId: exercise.id,
          kind: exercise.type,
          value,
          ...(raw !== undefined && Math.abs(raw - value) > 0.05 ? { raw } : {}),
          ...(exercise.perSide ? { side } : {}),
          ...(exercise.category === 'planche' ? { surface } : {}),
          ...(exercise.type === 'hold' && usedLeadInSec !== null
            ? { leadInSec: Math.round(usedLeadInSec * 10) / 10 }
            : {}),
          target: block.target.kind === 'hold' ? block.target.sec : block.target.reps,
          section: block.section,
          at,
        },
      ])
      advance(true)
    },
    [block, exercise, advance, side, surface],
  )

  const stopHold = useCallback(() => {
    // A hold can only be stopped once.
    //
    // `phase` is read from a closure, and several events can fire before React
    // re-renders: holding the space bar auto-repeats, and an impatient double
    // tap on Stop is ordinary behaviour mid-workout. Every one of them used to
    // reach this function while the phase still read 'hold', logging its own
    // set — five taps wrote five sets, four of them phantom 0s holds that then
    // counted toward set totals, session volume and the coach's history. The
    // ref is claimed synchronously, so the duplicates have nothing left to do.
    if (stoppingHoldRef.current) return
    stoppingHoldRef.current = true
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
      const started = Date.now()
      leadStartedAtRef.current = started
      leadUsedRef.current = 0
      setLeadEnd(started + leadSec * 1000)
      setPhase('lead')
    } else {
      setPendingReps(block.target.kind === 'reps' ? block.target.reps : 0)
      setPhase('reps')
    }
  }, [block, exercise, leadSec])

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

  /**
   * Re-credit the hold just logged against the other stop-allowance.
   *
   * Recomputed from the untouched stopwatch reading rather than nudged, so
   * tapping back and forth always lands on exactly the same two numbers and
   * cannot drift. `raw` is deliberately kept even when it now equals the
   * credited value, because it is what makes the tap reversible.
   */
  const setWalkedBackForLog = useCallback(
    (at: number, didWalk: boolean) => {
      setWalkedBack(didWalk)
      setLogs((l) => {
        const target = l.find((log) => log.at === at)
        if (!target || target.kind !== 'hold' || target.raw === undefined) return l
        const value = creditedHoldSeconds(
          target.raw,
          target.exerciseId,
          state.settings.stopLatencySec,
          !didWalk,
        )
        // Target by timestamp so the summary can correct its final Path hold
        // even when a cooldown set was logged after it.
        return l.map((log) => (log.at === at ? { ...log, value } : log))
      })
    },
    [state.settings.stopLatencySec],
  )

  /** The stopwatch correction shared by rest and the final summary screen. */
  const stopAllowanceCorrection = (log: SetLog) => {
    if (log.kind !== 'hold' || log.raw === undefined || !isMainProgressionHold(log.exerciseId)) return null
    const credits = stopSetupCredits(log.raw, log.exerciseId, state.settings.stopLatencySec)
    if (credits.delta <= 0.05) return null
    const didWalk = Math.abs(log.value - credits.walkedBack) <= Math.abs(log.value - credits.withinReach)
    return (
      <button
        onClick={() => setWalkedBackForLog(log.at, !didWalk)}
        className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] font-medium text-ink2 transition hover:border-line-strong hover:text-ink"
      >
        <Icon name="rotate" size={13} className="text-accent-text" />
        {didWalk
          ? `Stopped it without getting up? +${credits.delta.toFixed(1)}s`
          : `Had to walk back to the phone? −${credits.delta.toFixed(1)}s`}
      </button>
    )
  }

  const save = useCallback(() => {
    const session: Session = {
      id: crypto.randomUUID(),
      // Never 0 in practice — a session cannot reach the summary without
      // leaving the intro — but a real timestamp beats an epoch date if it is.
      startedAt: startedAtRef.current || Date.now(),
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
      // A child dialog is on top: let it own the keyboard, or Escape would
      // also open the exit prompt and Space would start behind the overlay.
      if (showCheckIn || showDemo || showRpeHelp || confirmExit) return
      // A focused control owns its own keys. Space is how a keyboard user
      // activates a button, and swallowing it here meant tabbing to "Skip
      // set", "+30s", an RPE value or a form rating and pressing Space either
      // did nothing or fired the phase action instead of the button — the
      // shortcut made the visible controls unreachable without a mouse.
      // Media counts as a focused control too. Space is play/pause on a
      // focused <video>, and during rest the athlete is often scrubbing the
      // clip they just recorded — swallowing it there stopped the replay
      // responding at all, for a phase that has no Space action anyway.
      if (
        e.target instanceof HTMLElement &&
        e.target.closest(
          'button, a, select, video, audio, [role="switch"], [role="button"], [role="slider"], [contenteditable]',
        )
      ) {
        // Scoped to Space only: Escape and "skip rest" are not keys a button
        // owns, and returning early for everything meant tabbing to any
        // control silently disabled both of them.
        if (e.code === 'Space') return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        // Every Space action is a one-shot phase transition, so at most one may
        // run per phase. Holding the bar auto-repeats and a double tap fires
        // twice before React re-renders; each event read the same stale phase
        // and ran the transition again, which logged duplicate sets. The claim
        // is taken synchronously and cleared when the phase actually changes.
        if (e.repeat || spaceClaimRef.current === phase) return
        spaceClaimRef.current = phase
        if (phase === 'intro') startSession()
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
  }, [phase, beginSet, stopHold, logSet, pendingReps, showCheckIn, showDemo, showRpeHelp, confirmExit])

  const sessionElapsed = startedAtRef.current ? Math.max(0, (now - startedAtRef.current) / 1000) : 0
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
      const primaryTarget = primaryTargetBlock(workout)
      const primaryExercise = primaryTarget ? EXERCISE_BY_ID[primaryTarget.exerciseId] : undefined
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
                    Put the phone directly beside you. The live guide confirms your whole body is ready before each
                    filmed set.
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

    if (!block || !exercise) return null

    if (phase === 'ready') {
      const isHold = exercise.type === 'hold'
      const target = block.target.kind === 'hold' ? `${block.target.sec}s` : `${block.target.reps} reps`
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
                    : 'then you’ll do the right'
                  : 'second half of this set'}
              </span>
            </div>
          ) : null}
          <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft px-4 py-2 text-accent-text">
            <Icon name="target" size={16} />
            <span className="text-[11px] font-bold uppercase tracking-wider">Target</span>
            <span className="text-[18px] font-bold text-ink tnum">
              {target}{perSide ? ' this side' : ''}
            </span>
          </div>
          {bestBefore ? (
            <div className="mt-1.5 text-[12.5px] text-ink3 tnum">
              {exercise.category === 'planche' ? `${surfaceLabel(surface)} ` : ''}best{' '}
              {exercise.type === 'hold' ? fmtHold(bestBefore) : `${bestBefore} reps`}
            </div>
          ) : null}
          {exercise.category === 'planche' && state.profile.equipment.includes('parallettes') ? (
            <div className="mt-2 inline-flex overflow-hidden rounded-xl border border-line" aria-label="Training surface">
              {TRAINING_SURFACES.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSurface(item.id)}
                  aria-pressed={surface === item.id}
                  className={`px-3.5 py-1.5 text-[12.5px] font-semibold transition ${
                    surface === item.id ? 'bg-accent text-on-accent' : 'bg-surface text-ink2 hover:text-ink'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
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
                    // The page was restored after this attempt, so its exact
                    // setup countdown is unknowable. Leave it unspecified and
                    // let rest reconstruction use the normal fallback.
                    logSet(interrupted, undefined, Date.now(), null)
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
                  <Icon name="monitor" size={15} className={cameraOn ? 'text-accent-text' : 'text-ink3'} />
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
                // The box takes the camera's real shape rather than forcing
                // 16:9. Letterboxing a portrait stream into a wide frame put
                // the framing guide over black bars, so the one thing the
                // preview exists for — seeing what will actually be in the
                // clip — was the thing it got wrong.
                <div
                  className="relative mt-2 w-full overflow-hidden rounded-2xl border border-line bg-black"
                  style={{ aspectRatio: recorder.frame ? recorder.frame.width / recorder.frame.height : 16 / 9 }}
                >
                  <video
                    ref={recorder.previewRef}
                    muted
                    playsInline
                    className="h-full w-full object-cover"
                  />
                  <div className="pointer-events-none absolute inset-[8%] rounded-xl border border-dashed border-accent/70" />
                  <div className="pointer-events-none absolute inset-x-[8%] top-1/2 h-px bg-accent/60" />
                  {/* Live "can the camera actually see you" check — placement
                      problems get caught here, before the effort is spent,
                      instead of by a refused verdict afterwards. */}
                  <FramingCheck
                    videoRef={recorder.videoRef}
                    active={state.settings.autoAnalyze && recorder.status === 'idle'}
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-1.5 text-[11.5px] text-white/85">
                    Side-on · whole body and both hands inside the box · phone level.
                  </div>
                </div>
              ) : null}
              {cameraOn ? (
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="text-[12.5px] text-ink3">
                    {recorder.onWideLens ? 'Ultra-wide (0.5×) lens' : 'Standard lens'}
                    {recorder.frame ? ` · ${recorder.frame.width}×${recorder.frame.height}` : ''}
                  </span>
                  <button
                    onClick={() => recorder.setWide(!recorder.wide)}
                    className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition ${
                      recorder.wide ? 'border-accent/40 bg-accent-soft text-accent-text' : 'border-line bg-raised text-ink2'
                    }`}
                  >
                    {recorder.wide ? '0.5× on' : '0.5× off'}
                  </button>
                </div>
              ) : null}
              {cameraOn && recorder.portrait ? (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-accent-text">
                  <Icon name="rotate" size={14} className="mt-0.5 shrink-0" />
                  Turn the phone on its side. A planche is a wide shape, and an upright frame cuts off your
                  hands or your feet.
                </p>
              ) : null}
              {recorder.status === 'denied' ? (
                <p className="mt-1.5 text-[12.5px] text-danger-text">
                  Camera access was blocked. Allow it in your browser settings, or leave this off.
                </p>
              ) : null}
              {recorder.status === 'unsupported' ? (
                <p className="mt-1.5 text-[12.5px] text-danger-text">
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
            {isHold ? `Start · ${leadSec}s lead-in` : 'Begin set'}
          </button>
          {/* Bare text buttons measured 20px tall, under the 24px minimum, on
              the one screen where taps are one-handed and mid-workout. The
              padding buys a real target without changing how the row looks. */}
          <div className="mt-2 flex flex-wrap justify-center gap-x-4 text-[13px]">
            <button onClick={() => setShowDemo(true)} className="px-1 py-2 text-accent-text underline-offset-2 hover:underline">
              How do I do this?
            </button>
            <button onClick={skipSet} className="px-1 py-2 text-ink3 underline-offset-2 hover:text-ink hover:underline">
              Skip set
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
                    isPr || overTarget ? 'text-ok-text' : 'text-ink'
                  }`}
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
              {lastLog.raw !== undefined && lastLog.raw - lastLog.value > 0.05 ? (
                <span className="text-[12px] text-ink3 tnum">
                  ({lastLog.raw.toFixed(1)}s − {(lastLog.raw - lastLog.value).toFixed(1)}s to stop it)
                </span>
              ) : null}
              <span className="flex gap-1">
                <button
                  onClick={() => adjustLastLog(-1)}
                  aria-label="Decrease logged value"
                  className="grid h-9 w-9 place-items-center rounded-full border border-line bg-raised text-ink2 hover:text-ink"
                >
                  <Icon name="minus" size={13} />
                </button>
                <button
                  onClick={() => adjustLastLog(1)}
                  aria-label="Increase logged value"
                  className="grid h-9 w-9 place-items-center rounded-full border border-line bg-raised text-ink2 hover:text-ink"
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
                · <span className="font-medium text-ink">{side} side</span>
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
            // The final set bypasses the rest screen. Keep the per-set stop
            // question reachable here or that hold is permanently stuck with
            // the opening guess from Settings.
            const finalPathHold = [...logs]
              .reverse()
              .find(
                (log) =>
                  log.kind === 'hold' &&
                  log.raw !== undefined &&
                  isMainProgressionHold(log.exerciseId),
              )
            if (!finalPathHold) return null
            return (
              <div className="mt-3 text-center">
                <div className="text-[12px] text-ink3">
                  Final Path hold: {fmtHold(finalPathHold.value)} credited
                </div>
                {stopAllowanceCorrection(finalPathHold)}
              </div>
            )
          })()}
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
            const unreviewedFilmed = logs.filter((log) => {
              const hasClip = Boolean(log.clipKey ?? log.form?.clipKey)
              if (!hasClip || log.kind !== 'hold' || log.section !== 'main' || !isFilmable(log.exerciseId)) {
                return false
              }
              if (log.form?.confirmed !== true) return true
              if (log.exerciseId === 'frog-stand') return log.form.visualReviewPassed !== true
              if (!log.form.auto) return true
              return requiresFlightConfirmation(log.exerciseId) && log.form.flightConfirmed !== true
            })
            const formLogs = [...unreviewedFilmed, ...blocking, lastMain].filter(
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
              a passing filmed form check. True flight skills also need your no-foot-support confirmation. One isolated
              camera flag may pass; two or more flags do not.
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
              <div className="text-[13px] font-semibold uppercase tracking-wide text-accent-text">Step unlocked</div>
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
                  <div
                    key={`${p.exerciseId}-${p.surface ?? 'overall'}`}
                    className="flex items-baseline justify-between py-1 text-[14.5px]"
                  >
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
    <div
      ref={sessionRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${workout.name} training session`}
      aria-hidden={showCheckIn || showDemo || showRpeHelp || confirmExit ? true : undefined}
      inert={showCheckIn || showDemo || showRpeHelp || confirmExit ? true : undefined}
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

      <Modal open={confirmExit} onClose={() => setConfirmExit(false)} label="Leave training session">
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
  const [flightConfirmed, setFlightConfirmed] = useState(value?.flightConfirmed === true)
  const autoRanRef = useRef(false)
  // Mirrors of rating/issues that async code can read after its awaits — the
  // state the closure captured goes stale, and an analysis resolving after a
  // tap used to overwrite the athlete's own answer with the model's.
  const ratingRef = useRef<FormRating | null>(value?.rating ?? null)
  const issuesRef = useRef<FormIssue[]>(value?.issues ?? [])
  const visualReviewRef = useRef(value?.visualReviewPassed === true)
  const flightConfirmedRef = useRef(value?.flightConfirmed === true)
  const needsManualReplayReview = exerciseId === 'frog-stand'
  const needsFlightConfirmation = requiresFlightConfirmation(exerciseId)
  const handleClipAvailability = useCallback((available: boolean) => setClipAvailable(available), [])

  const runAnalysis = async () => {
    if (!clipKey) return
    onBusyChange?.(true)
    setAnalysing(true)
    try {
      const blob = await getClipBlob(clipKey)
      const res: PoseFormResult = blob
        ? await withAnalysisTimeout(analyseClip(blob, exerciseId, undefined, creditedHoldSec))
        : // Never leave the button looking like it did nothing.
          emptyResult('That clip could not be loaded.')
      setAnalysis(friendlyResult(res))
      if (res.ok) {
        const auto = {
          issues: res.issues,
          confidence: res.confidence,
          score: res.score,
          cleanSeconds: res.cleanSeconds,
          cleanRatio: res.cleanRatio,
          elbowDeg: res.elbowDeg,
          kneeDeg: res.kneeDeg,
          hipAngleDeg: res.hipAngleDeg,
          hipOffset: res.hipOffset,
          leanRatio: res.leanRatio,
          shrugRatio: res.shrugRatio,
          wobble: res.wobble,
          ...(res.unseen.length ? { unseen: res.unseen } : {}),
        }
        if (ratingRef.current !== null) {
          // The athlete answered while the check was running — their word
          // stands. File the camera's reading alongside it, don't overwrite.
          onDone({
            rating: ratingRef.current,
            confirmed: true,
            ...(visualReviewRef.current ? { visualReviewPassed: true } : {}),
            ...(flightConfirmedRef.current ? { flightConfirmed: true } : {}),
            ...(issuesRef.current.length ? { issues: issuesRef.current } : {}),
            ...(clipKey ? { clipKey } : {}),
            auto,
          })
        } else {
          // Pre-fills the answer and saves it immediately — it used to render
          // as selected while storing nothing, so a rest timer expiring lost
          // it. The athlete can still correct it; the model is guessing at a
          // body position it was barely trained on.
          const cleanShare = res.cleanRatio ?? 1
          const r: FormRating =
            res.issues.length === 0 && cleanShare >= 0.8
              ? 'clean'
              : res.issues.length > 1 || cleanShare < 0.6
                ? 'broke'
                : 'slipped'
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
  const commit = (
    r: FormRating,
    iss: FormIssue[],
    replayPassed = visualReviewRef.current,
    flightPassed = flightConfirmedRef.current,
  ) =>
    onDone({
      rating: r,
      confirmed: true,
      ...(r === 'clean' && replayPassed ? { visualReviewPassed: true } : {}),
      ...(r === 'clean' && flightPassed ? { flightConfirmed: true } : {}),
      ...(iss.length ? { issues: iss } : {}),
      ...(clipKey ? { clipKey } : {}),
      // The camera's own reading rides along, so the coach has an objective
      // record even when the athlete's rating disagrees with it.
      ...(analysis?.ok
        ? {
            auto: {
              issues: analysis.issues,
              confidence: analysis.confidence,
              score: analysis.score,
              cleanSeconds: analysis.cleanSeconds,
              cleanRatio: analysis.cleanRatio,
              elbowDeg: analysis.elbowDeg,
              kneeDeg: analysis.kneeDeg,
              hipAngleDeg: analysis.hipAngleDeg,
              hipOffset: analysis.hipOffset,
              leanRatio: analysis.leanRatio,
              shrugRatio: analysis.shrugRatio,
              wobble: analysis.wobble,
              ...(analysis.unseen.length ? { unseen: analysis.unseen } : {}),
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
          overlay={analysis?.track}
          overlayIssues={analysis?.issues}
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
              <Icon name="sparkle" size={14} className="text-accent-text" />
              {analysing ? 'Checking your position…' : 'Check my form automatically'}
            </button>
          ) : null}
          {analysing ? (
            <p className="mt-1 text-center text-[11.5px] text-ink3" role="status">
              First run downloads the checker. Longer holds sample more moments, so keep this screen open.
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
                  {analysis.score !== undefined ? (
                    <div className="mb-2 flex items-center gap-3">
                      <div
                        className={`grid h-14 w-14 shrink-0 place-items-center rounded-full border-[3px] font-display text-[19px] font-bold tnum ${
                          analysis.score >= 85
                            ? 'border-ok/60 text-ok-text'
                            : analysis.score >= 60
                              ? 'border-accent/60 text-accent-text'
                              : 'border-danger/60 text-danger-text'
                        }`}
                        aria-label={`Form score ${analysis.score} out of 100`}
                      >
                        {analysis.score}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold uppercase tracking-wide text-ink3">
                          Form score
                        </div>
                        {analysis.subscores?.length ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {analysis.subscores.map((s) => (
                              <span
                                key={s.key}
                                className={`rounded-full px-2 py-0.5 text-[11px] font-medium tnum ${
                                  s.score >= 85
                                    ? 'bg-ok-soft text-ok-text'
                                    : s.score >= 60
                                      ? 'bg-accent-soft text-accent-text'
                                      : 'bg-danger-soft text-danger-text'
                                }`}
                              >
                                {s.label} {s.score}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {analysis.fixFirst ? (
                    <div className="mb-2 rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-text">
                        Fix this first
                      </div>
                      <div className="mt-0.5 text-[12.5px] font-medium leading-snug text-ink">
                        {analysis.fixFirst.cue}
                      </div>
                    </div>
                  ) : null}
                  {analysis.cleanSeconds !== undefined ? (
                    <div
                      className={`mb-2 rounded-lg px-2.5 py-2 ${
                        analysis.cleanSeconds + 0.05 >= creditedHoldSec
                          ? 'bg-ok-soft text-ok-text'
                          : 'bg-accent-soft text-accent-text'
                      }`}
                    >
                      <span className="font-semibold">
                        Camera-verified clean window: {analysis.cleanSeconds.toFixed(1)}s
                      </span>
                      <span className="text-[11.5px]">
                        {' '}
                        of {creditedHoldSec.toFixed(1)}s. Isolated joint-tracking jumps are ignored; a material
                        miss has to persist for roughly a second before it stops progression credit.
                      </span>
                    </div>
                  ) : null}
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
                    <div className="font-medium text-ok-text">
                      No measured issue found — confirm scapular position and control yourself.
                    </div>
                  )}
                  {analysis.good.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {analysis.good.map((g) => (
                        <span key={g} className="rounded-full bg-ok-soft px-2 py-0.5 text-[11.5px] font-medium text-ok-text">
                          ✓ {g}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {/* Stated on the face of the panel, not folded into detail:
                      everything above is a verdict on what the camera saw, and
                      it must be obvious which parts it never looked at. */}
                  {analysis.unseen.length ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-[11.5px] text-ink3">
                      <Icon name="monitor" size={13} className="mt-[1px] shrink-0" />
                      <span>
                        Could not see your {analysis.unseen.join(', ')} — not judged above. Move the phone back
                        or turn it sideways to get {analysis.unseen.length === 1 ? 'it' : 'them'} in frame.
                      </span>
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
                          {analysis.framesUsed} usable of {analysis.framesSampled ?? analysis.framesUsed} sampled
                          moments · {Math.round(analysis.confidence * 100)}% tracking confidence. A side-on estimate,
                          not a verdict — correct it below if it read you wrong.
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
        <p className="mt-1 text-[11.5px] font-medium text-accent-text" role="status">
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
                flightConfirmedRef.current = false
                setFlightConfirmed(false)
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
                ? 'border-ok/40 bg-ok-soft text-ok-text'
                : 'border-line-strong bg-surface text-ink hover:border-accent'
            }`}
          >
            {visualReviewPassed ? 'Replay checked — form held' : 'I reviewed the replay — form held'}
          </button>
        </div>
      ) : null}
      {needsFlightConfirmation && rating === 'clean' ? (
        <div className="mt-3 rounded-xl border border-line bg-raised p-3">
          <p className="text-[12.5px] leading-relaxed text-ink2">
            The camera can judge your shape, but it cannot reliably tell whether a toe was helping. Confirm that both
            feet stayed fully off the floor for the camera-verified window.
          </p>
          <button
            onClick={() => {
              flightConfirmedRef.current = true
              setFlightConfirmed(true)
              commit('clean', [], visualReviewRef.current, true)
            }}
            aria-pressed={flightConfirmed}
            className={`mt-2 w-full rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${
              flightConfirmed
                ? 'border-ok/40 bg-ok-soft text-ok-text'
                : 'border-line-strong bg-surface text-ink hover:border-accent'
            }`}
          >
            {flightConfirmed ? 'Flight confirmed — no foot support' : 'Both feet stayed completely off the floor'}
          </button>
        </div>
      ) : null}
      {rating === 'clean' && value?.confirmed === true ? (
        <p
          className={`mt-2 text-[11.5px] font-medium ${progressionFormPassed ? 'text-ok-text' : 'text-accent-text'}`}
          role="status"
        >
          {progressionFormPassed
            ? value?.auto?.cleanSeconds !== undefined &&
              value.auto.cleanSeconds + 0.05 < creditedHoldSec
              ? `Evidence complete — ${value.auto.cleanSeconds.toFixed(1)}s of this hold count toward progression before the sustained breakdown.`
              : value?.auto?.issues.length === 1
              ? 'Progression evidence complete — your Clean rating plus one isolated camera flag.'
              : 'Progression evidence complete — athlete and filmed form checks agree.'
            : needsManualReplayReview
              ? 'Your Clean rating is saved. Review the replay above for this hold to count toward progression.'
              : needsFlightConfirmation && value?.flightConfirmed !== true
                ? 'Your Clean rating is saved. Confirm that both feet stayed off the floor for this hold to count.'
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
const REGION_LABEL: Record<BodyRegion, string> = {
  wrist: 'Wrist',
  elbow: 'Elbow',
  shoulder: 'Shoulder',
  'lower-back': 'Lower back',
  other: 'Somewhere else',
}

function CheckInForm({ onDone, onSkip }: { onDone: (c: CheckIn) => void; onSkip: () => void }) {
  const [joints, setJoints] = useState<CheckIn['joints'] | null>(null)
  const [energy, setEnergy] = useState<CheckIn['energy'] | null>(null)
  const [regions, setRegions] = useState<BodyRegion[]>([])

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

  // Asked only when there is something to locate. A region changes what the
  // session actually contains — a sore lower back gets its core work swapped
  // out, a wrist keeps it — so this is a real question, not extra paperwork.
  const needsRegion = joints === 'niggle' || joints === 'pain'
  const ready = Boolean(joints && energy && (!needsRegion || regions.length > 0))

  return (
    <div className="p-6">
      <div className="pr-10">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-wider text-accent-text">
          <Icon name="target" size={14} /> Quick check-in
        </div>
        <h2 className="mt-1 font-display text-[20px] font-bold text-ink">How are you feeling?</h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">
          Your answers change today's warm-up, intensity and volume — being honest here is what keeps you training
          instead of recovering.
        </p>
      </div>

      <div className="mt-4">
        <div className="text-[13px] font-semibold text-ink" id="ci-joints">
          Wrists, elbows and shoulders
        </div>
        <div className="mt-2 space-y-2" role="group" aria-labelledby="ci-joints">
          {JOINTS.map((j) => (
            <button
              key={j.id}
              aria-pressed={joints === j.id}
              onClick={() => {
                setJoints(j.id)
                if (j.id === 'good') setRegions([])
              }}
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

      {needsRegion ? (
        <div className="mt-4">
          <div className="text-[13px] font-semibold text-ink" id="ci-regions">
            Where? <span className="font-normal text-ink2">Pick all that apply.</span>
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink3">
            This changes the session rather than just being recorded — the plan leaves out whatever loads the area you
            name.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-labelledby="ci-regions">
            {BODY_REGIONS.map((r) => {
              const on = regions.includes(r)
              return (
                <button
                  key={r}
                  aria-pressed={on}
                  onClick={() => setRegions((v) => (on ? v.filter((x) => x !== r) : [...v, r]))}
                  className={`rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
                    on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2 hover:text-ink'
                  }`}
                >
                  {REGION_LABEL[r]}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <div className="text-[13px] font-semibold text-ink" id="ci-energy">
          Energy today
        </div>
        <div className="mt-2 flex gap-2" role="group" aria-labelledby="ci-energy">
          {ENERGY.map((e) => (
            <button
              key={e.id}
              aria-pressed={energy === e.id}
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
        disabled={!ready}
        onClick={() =>
          ready &&
          joints &&
          energy &&
          onDone({ joints, energy, at: Date.now(), ...(regions.length ? { regions } : {}) })
        }
        className="mt-5 w-full rounded-2xl px-6 py-3.5 font-display text-[16px] font-semibold text-on-accent shadow-card transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: 'var(--t-btn-accent)' }}
      >
        Start session
      </button>
      {needsRegion && regions.length === 0 ? (
        <p className="mt-1.5 text-center text-[12px] text-ink3" aria-live="polite">
          Pick where it is, so the session can leave that out.
        </p>
      ) : null}
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
