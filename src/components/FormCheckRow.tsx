import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutoForm, FormCheck, FormIssue, FormRating } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { getClipBlob } from '../lib/clips'
import {
  analyseClipDetailed,
  emptyResult,
  friendlyResult,
  judgeTrackedFrames,
  JUDGE_VERSION,
  type ClipAnalysis,
  type PoseFormResult,
} from '../lib/poseForm'
import { saveProblemReport } from '../lib/problemReports'
import { pushToast } from '../lib/toast'
import {
  passesProgressionFormCheck,
  progressionRelevantIssues,
  requiresFlightConfirmation,
  unseenVariantCriteria,
  VARIANT_CRITICAL,
  verifiedCleanSeconds,
} from '../lib/progression'
import { Icon } from './Icon'
import { Modal } from './ui'
import { ClipPlayer, type ClipInterval } from './ClipPlayer'

export const FORM_ISSUE_LABEL: Record<FormIssue, string> = {
  arms: 'Elbows not fully locked',
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

/**
 * How long a form check may *run* before the session stops waiting for it,
 * and how long the whole operation — reading the clip, waiting in the queue,
 * running — may take from the tap.
 *
 * The old watchdog started only after the clip had been read, so a stalled
 * read left "Checking your position…" and a disabled Save up forever; and it
 * started at enqueue, so the third of three queued checks timed out after
 * running for five seconds. Waiting and running now have separate clocks.
 */
const RUN_TIMEOUT_MS = 45_000
const TOTAL_TIMEOUT_MS = 150_000

/** A machine reading of one clip, before it is folded into the set's form. */
export interface ModelReading {
  auto: AutoForm
  suggestedRating: FormRating
  suggestedIssues: FormIssue[]
  clipKey?: string
}

/** What an athlete's explicit tap says about a set. */
export interface HumanReview {
  rating: FormRating
  issues: FormIssue[]
  visualReviewPassed?: boolean
  flightConfirmed?: boolean
  variantConfirmed?: boolean
  clipKey?: string
  /** The row's own reading, used only when the set has none on file yet. */
  auto?: AutoForm
}

/**
 * Fold a machine result into whatever the set's form is *now*.
 *
 * Pure, and applied by the owner of the log rather than the row that asked:
 * a row can be retired (rest ended, the summary mounted a new one) while its
 * check is still running, and its captured state cannot see choices made in
 * its replacement. A late result used to replace the whole form, turning a
 * newer "Clean, both feet off the floor" into an unconfirmed "broke". Now a
 * human review stands and only the camera reading is updated; without one,
 * the result is a suggestion and stays unconfirmed.
 */
export function mergeModelReading(current: FormCheck | undefined, reading: ModelReading): FormCheck {
  if (current?.confirmed === true) {
    return {
      ...current,
      ...(current.clipKey || !reading.clipKey ? {} : { clipKey: reading.clipKey }),
      auto: reading.auto,
    }
  }
  return {
    rating: reading.suggestedRating,
    confirmed: false,
    ...(reading.suggestedIssues.length ? { issues: reading.suggestedIssues } : {}),
    ...((reading.clipKey ?? current?.clipKey) ? { clipKey: reading.clipKey ?? current?.clipKey } : {}),
    auto: reading.auto,
  }
}

/**
 * Apply an explicit athlete review. Only this may set `confirmed: true` —
 * value presence never stands in for a human action. The camera reading on
 * file is kept; the row's own reading fills in only when there is none.
 */
export function mergeHumanReview(current: FormCheck | undefined, review: HumanReview): FormCheck {
  const clean = review.rating === 'clean'
  const clipKey = review.clipKey ?? current?.clipKey
  const auto = current?.auto ?? review.auto
  return {
    rating: review.rating,
    confirmed: true,
    ...(clean && review.visualReviewPassed ? { visualReviewPassed: true } : {}),
    ...(clean && review.flightConfirmed ? { flightConfirmed: true } : {}),
    ...(clean && review.variantConfirmed ? { variantConfirmed: true } : {}),
    ...(review.issues.length ? { issues: review.issues } : {}),
    ...(clipKey ? { clipKey } : {}),
    ...(auto ? { auto } : {}),
  }
}

/** The camera's suggested rating for a result. Never a confirmation. */
export function suggestedRatingFor(res: Pick<PoseFormResult, 'issues' | 'cleanRatio'>): FormRating {
  const cleanShare = res.cleanRatio ?? 1
  return res.issues.length === 0 && cleanShare >= 0.8
    ? 'clean'
    : res.issues.length > 1 || cleanShare < 0.6
      ? 'broke'
      : 'slipped'
}

/** The persisted reading for a successful result. */
export function autoFromResult(res: PoseFormResult, analysedSec: number, analysedFromSec = 0): AutoForm {
  return {
    issues: res.issues,
    heldIssues: res.heldIssues ?? res.issues,
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
    analysedSec: Math.round(analysedSec * 10) / 10,
    ...(analysedFromSec > 0 ? { analysedFromSec: Math.round(analysedFromSec * 100) / 100 } : {}),
    ...(res.samplingGapSec !== undefined ? { samplingGapSec: Math.round(res.samplingGapSec * 100) / 100 } : {}),
    ...(res.model ? { model: res.model } : {}),
    judge: JUDGE_VERSION,
    ...(res.unseen.length ? { unseen: res.unseen } : {}),
  }
}

let opCounter = 0

/**
 * One tap for the common case, detail only when something went wrong. This is
 * the only signal the coach has about *quality* — without it, seconds earned
 * with bent arms look identical to clean ones.
 */
export function FormCheckRow({
  clipKey,
  exerciseId,
  creditedHoldSec,
  analysisWindowSec,
  value,
  autoRun,
  restReportAction,
  onReportOpenChange,
  onReviewOpenChange,
  onHuman,
  onModel,
  onBusyChange,
  analysisWindowStartSec = 0,
  videoInterval,
  onVideoInterval,
}: {
  clipKey: string | null
  exerciseId: string
  creditedHoldSec: number
  /**
   * Seconds of the *clip* to analyse — the credited hold minus any time that
   * passed before recording actually started. Defaults to the credited hold.
   */
  analysisWindowSec?: number
  /** The set's current form, so the panel reflects it instead of looking blank. */
  value?: FormCheck
  /** Kick the analysis off unprompted once the clip is ready. */
  autoRun?: boolean
  /** Put the simple report trigger in the top-right of the surrounding rest screen. */
  restReportAction?: boolean
  onReportOpenChange?: (open: boolean) => void
  /** Fullscreen review opened or closed — the session holds its rest clock for it. */
  onReviewOpenChange?: (open: boolean) => void
  onHuman: (review: HumanReview) => void
  onModel: (reading: ModelReading) => void
  /** Per-operation busy reporting; only the operation that set busy can clear it. */
  onBusyChange?: (opId: string, busy: boolean) => void
  /** Clip time the analysed window starts at — the marked start of a video-timed hold. */
  analysisWindowStartSec?: number
  /** The interval marked on the clip, when the hold was timed from the video. */
  videoInterval?: ClipInterval
  /** Re-time the hold from the clip. Absent where re-timing is not allowed. */
  onVideoInterval?: (interval: ClipInterval) => void
}) {
  // Whether a *person* has answered for this set. Kept apart from the
  // displayed rating, because the camera's suggestion pre-fills that rating —
  // and treating "a rating is showing" as "the athlete answered" let a second
  // automatic check confirm the first one's guess on nobody's behalf.
  const humanRef = useRef(value?.confirmed === true)
  const [rating, setRating] = useState<FormRating | null>(value?.rating ?? null)
  const [issues, setIssues] = useState<FormIssue[]>(value?.issues ?? [])
  const [clipAvailable, setClipAvailable] = useState(false)
  const [analysis, setAnalysis] = useState<PoseFormResult | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'queued' | 'running'>('idle')
  const [showProblemReport, setShowProblemReport] = useState(false)
  const [problemNote, setProblemNote] = useState('')
  const [reportSaving, setReportSaving] = useState(false)
  const [reportSaved, setReportSaved] = useState(false)
  const [visualReviewPassed, setVisualReviewPassed] = useState(value?.visualReviewPassed === true)
  const [flightConfirmed, setFlightConfirmed] = useState(value?.flightConfirmed === true)
  const [variantConfirmed, setVariantConfirmed] = useState(value?.variantConfirmed === true)
  const autoRanRef = useRef(false)
  /** Raw poses and technical wording stay out of the normal UI but make a reported verdict reproducible. */
  const diagnosticRef = useRef<ClipAnalysis | null>(null)
  /** Share one detector run when Report is tapped while the automatic check is still working. */
  const diagnosticPromiseRef = useRef<Promise<ClipAnalysis> | null>(null)
  const issuesRef = useRef<FormIssue[]>(value?.issues ?? [])
  const ratingRef = useRef<FormRating | null>(value?.rating ?? null)
  const visualReviewRef = useRef(value?.visualReviewPassed === true)
  const flightConfirmedRef = useRef(value?.flightConfirmed === true)
  const variantConfirmedRef = useRef(value?.variantConfirmed === true)
  const needsManualReplayReview = exerciseId === 'frog-stand'
  const needsFlightConfirmation = requiresFlightConfirmation(exerciseId)
  const handleClipAvailability = useCallback((available: boolean) => setClipAvailable(available), [])
  const analysing = status !== 'idle'
  const windowSec = Math.max(0, analysisWindowSec ?? creditedHoldSec)

  // A newer form arriving from the owner (a merged late result, or a review
  // made in another row for the same set) updates what this row shows.
  useEffect(() => {
    if (value?.confirmed === true) humanRef.current = true
    if (value?.rating && value.rating !== ratingRef.current) {
      ratingRef.current = value.rating
      setRating(value.rating)
      const next = value.issues ?? []
      issuesRef.current = next
      setIssues(next)
    }
  }, [value?.confirmed, value?.rating, value?.issues])

  const runAnalysis = async () => {
    if (!clipKey) return
    const opId = `${clipKey}#${++opCounter}`
    onBusyChange?.(opId, true)
    setStatus('loading')
    let settled = false
    try {
      const work: Promise<ClipAnalysis> = new Promise((resolve) => {
        let runTimer: number | undefined
        const finish = (outcome: ClipAnalysis) => {
          if (settled) return
          settled = true
          window.clearTimeout(totalTimer)
          window.clearTimeout(runTimer)
          resolve(outcome)
        }
        const totalTimer = window.setTimeout(
          () =>
            finish({
              result: emptyResult(
                'The form check could not finish in time — the clip or the checker is taking too long on this device. Your set is saved either way, and you can run the check again later from the clip in Learn or Progress.',
              ),
            }),
          TOTAL_TIMEOUT_MS,
        )
        void (async () => {
          try {
            const blob = await getClipBlob(clipKey)
            if (settled) return
            if (!blob) {
              finish({ result: emptyResult('That clip could not be loaded.') })
              return
            }
            setStatus('queued')
            const result = await analyseClipDetailed(blob, exerciseId, undefined, windowSec, {
              windowStartSec: analysisWindowStartSec,
              onStart: () => {
                if (settled) return
                setStatus('running')
                runTimer = window.setTimeout(
                  () =>
                    finish({
                      result: emptyResult(
                        'The form check ran out of time — usually a slow or blocked connection while the model downloads. Your set is saved either way, and you can run the check later from the clip in Learn.',
                      ),
                    }),
                  RUN_TIMEOUT_MS,
                )
              },
            })
            finish(result)
          } catch {
            finish({ result: emptyResult('That form check could not be completed.') })
          }
        })()
      })
      diagnosticPromiseRef.current = work
      const diagnostic = await work
      // The athlete sees the same verdict as before. The extra explanation is
      // retained only so an explicitly saved problem report can say which
      // sampled moments and criteria produced it.
      const res = diagnostic.poses
        ? { ...judgeTrackedFrames(diagnostic.poses, exerciseId, { explain: true }), model: diagnostic.result.model }
        : diagnostic.result
      diagnosticRef.current = { ...diagnostic, result: res }
      setAnalysis(friendlyResult(res))
      if (res.ok) {
        const reading: ModelReading = {
          auto: autoFromResult(res, windowSec, analysisWindowStartSec),
          suggestedRating: suggestedRatingFor(res),
          suggestedIssues: res.issues,
          clipKey,
        }
        // Only the display here; the owner folds the reading into the set's
        // current form, which is the only copy that knows about newer taps.
        if (!humanRef.current) {
          ratingRef.current = reading.suggestedRating
          issuesRef.current = reading.suggestedIssues
          setRating(reading.suggestedRating)
          setIssues(reading.suggestedIssues)
        }
        onModel(reading)
      }
    } finally {
      diagnosticPromiseRef.current = null
      setStatus('idle')
      onBusyChange?.(opId, false)
    }
  }

  const saveReport = async () => {
    if (!clipKey || reportSaving) return
    setReportSaving(true)
    try {
      const video = await getClipBlob(clipKey)
      if (!video) throw new Error('That clip is no longer available, so the report could not be saved.')

      // The report button is available before automatic analysis finishes —
      // and auto checking may be off. Run the same local checker here when
      // needed so the support report gets raw poses and frame-by-frame working
      // rather than only a video and the athlete's note.
      let diagnostic = diagnosticRef.current
      if (!diagnostic) {
        const rerun = await (diagnosticPromiseRef.current ??
          analyseClipDetailed(video, exerciseId, undefined, windowSec, { windowStartSec: analysisWindowStartSec }))
        diagnostic = {
          ...rerun,
          result: rerun.poses ? judgeTrackedFrames(rerun.poses, exerciseId, { explain: true }) : rerun.result,
        }
        diagnosticRef.current = diagnostic
      }

      const saved = await saveProblemReport({
        note: problemNote,
        movementId: exerciseId,
        movementName: EXERCISE_BY_ID[exerciseId]?.name ?? exerciseId,
        creditedHoldSec,
        analysis: diagnostic.result,
        poses: diagnostic.poses,
        savedCameraReading: value?.auto,
        athleteReview: ratingRef.current
          ? {
              rating: ratingRef.current,
              confirmed: humanRef.current,
              issues: [...issuesRef.current],
            }
          : undefined,
        video,
      })
      if (!saved) throw new Error('The problem report could not be saved. Check available device storage and try again.')
      setReportSaved(true)
      setShowProblemReport(false)
      onReportOpenChange?.(false)
      pushToast('Problem report saved on this device.', 'success', 4500)
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'The problem report could not be saved.', 'danger')
    } finally {
      setReportSaving(false)
    }
  }

  // Fires at most once per set when auto-check is on. It may run after the
  // athlete has already answered; their answer stands and the camera reading
  // is filed beside it. The in-flight set covers the same clip mounting twice
  // (rest screen row → skip rest → finish row).
  useEffect(() => {
    if (!autoRun || !clipAvailable || autoRanRef.current || analysing || analysis || value?.auto || needsManualReplayReview) {
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

  /** Committed on every tap rather than behind a Save button: the rest timer can expire mid-selection. */
  const commit = (
    r: FormRating,
    iss: FormIssue[],
    replayPassed = visualReviewRef.current,
    flightPassed = flightConfirmedRef.current,
    variantPassed = variantConfirmedRef.current,
  ) => {
    humanRef.current = true
    onHuman({
      rating: r,
      issues: iss,
      visualReviewPassed: replayPassed,
      flightConfirmed: flightPassed,
      variantConfirmed: variantPassed,
      ...(clipKey ? { clipKey } : {}),
      ...(analysis?.ok ? { auto: autoFromResult(analysis, windowSec, analysisWindowStartSec) } : {}),
    })
  }

  const toggleIssue = (id: FormIssue) => {
    const next = issues.includes(id) ? issues.filter((x) => x !== id) : [...issues, id]
    issuesRef.current = next
    setIssues(next)
    if (rating) commit(rating, next)
  }

  const progressionFormPassed = passesProgressionFormCheck(value, exerciseId)
  const progressionCameraIssues = value?.auto ? progressionRelevantIssues(value.auto) : []
  const variantGaps = unseenVariantCriteria(exerciseId, value?.auto ?? (analysis?.ok ? { issues: analysis.issues, confidence: analysis.confidence, unseen: analysis.unseen } : undefined))
  const analysedSec = value?.auto?.analysedSec
  // Stale when the hold now counts more than was checked, or was re-timed to
  // a different stretch of the clip than the one the camera looked at.
  const windowMoved = Math.abs((value?.auto?.analysedFromSec ?? 0) - analysisWindowStartSec) > 0.1
  const coverageStale = analysedSec !== undefined && (windowSec > analysedSec + 0.5 || windowMoved)
  const confirmedByHuman = value?.confirmed === true
  const statusLine =
    status === 'loading'
      ? 'Loading the clip…'
      : status === 'queued'
        ? 'Waiting for another check to finish…'
        : status === 'running'
          ? 'Checking your position…'
          : null

  return (
    <div className="mx-auto mt-5 w-full max-w-sm rounded-2xl border border-line bg-surface p-4">
      {restReportAction && clipKey ? (
        <button
          onClick={() => {
            setShowProblemReport(true)
            onReportOpenChange?.(true)
          }}
          disabled={reportSaved}
          className={`absolute right-5 top-2.5 z-10 inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 py-2 text-[12.5px] font-semibold shadow-card transition ${
            reportSaved
              ? 'border-ok/30 bg-ok-soft text-ok-text'
              : 'border-line bg-surface text-ink2 hover:border-line-strong hover:text-ink'
          }`}
        >
          <Icon name={reportSaved ? 'check' : 'info'} size={14} />
          {reportSaved ? 'Saved' : 'Report'}
        </button>
      ) : null}
      {clipKey ? (
        <ClipPlayer
          clipKey={clipKey}
          label={`${EXERCISE_BY_ID[exerciseId]?.name ?? 'Hold'} form check`}
          className="mb-3 h-40 w-full rounded-xl border border-line"
          onAvailabilityChange={handleClipAvailability}
          onReviewOpenChange={onReviewOpenChange}
          overlay={analysis?.track}
          overlayIssues={analysis?.issues}
          onMarkInterval={onVideoInterval}
          markedInterval={videoInterval}
        />
      ) : null}
      {clipKey && onVideoInterval && clipAvailable ? (
        <p className="-mt-1.5 mb-3 text-[11.5px] leading-relaxed text-ink3">
          {videoInterval
            ? `Timed from the video: ${(videoInterval.endSec - videoInterval.startSec).toFixed(1)}s between the marked start and end. Open Review to change it.`
            : 'Timed by the stopwatch, minus the time it takes to stop it. For an exact time, open Review and mark where the hold started and ended.'}
        </p>
      ) : null}
      {clipKey ? (
        <div className="mb-3">
          {!needsManualReplayReview ? (
            <button
              onClick={() => void runAnalysis()}
              disabled={analysing || !clipAvailable}
              aria-busy={analysing}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-raised py-2 text-[13px] font-semibold text-ink transition hover:border-line-strong disabled:opacity-60"
            >
              <Icon name="sparkle" size={14} className="text-accent-text" />
              {statusLine ?? (value?.auto || analysis ? 'Check my form again' : 'Check my form automatically')}
            </button>
          ) : null}
          {analysing ? (
            <p className="mt-1 text-center text-[11.5px] text-ink3" role="status">
              {status === 'queued'
                ? 'Checks run one at a time so they do not fight over the phone’s graphics chip.'
                : 'First run downloads the checker. Longer holds sample more moments, so keep this screen open.'}
            </p>
          ) : null}
          {coverageStale && !analysing ? (
            <p className="mt-2 rounded-lg bg-accent-soft px-2.5 py-2 text-[12px] leading-relaxed text-ink" role="status">
              {windowMoved
                ? 'This hold was re-timed from the video since the camera checked it. Run the check again so it covers the marked stretch.'
                : `The camera checked the first ${analysedSec!.toFixed(1)}s, but this hold now counts as ${windowSec.toFixed(1)}s. Only the checked part can count toward progression — run the check again to cover all of it.`}
            </p>
          ) : null}
          {analysis ? (
            <AnalysisPanel analysis={analysis} creditedHoldSec={creditedHoldSec} />
          ) : value?.auto && !value.auto.malformed ? (
            <SavedReading auto={value.auto} creditedHoldSec={creditedHoldSec} />
          ) : null}
        </div>
      ) : null}
      <div className="text-[13px] font-semibold text-ink" id={`rating-${clipKey ?? exerciseId}`}>
        How did that set look?
      </div>
      {!confirmedByHuman && rating ? (
        <p className="mt-1 text-[11.5px] font-medium text-accent-text" role="status">
          Camera suggestion only — tap your answer below to confirm or correct it.
        </p>
      ) : null}
      <div className="mt-2 flex gap-2" role="group" aria-labelledby={`rating-${clipKey ?? exerciseId}`}>
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
              const nextIssues = id === 'clean' ? [] : issues
              issuesRef.current = nextIssues
              if (id !== 'clean') {
                visualReviewRef.current = false
                setVisualReviewPassed(false)
                flightConfirmedRef.current = false
                setFlightConfirmed(false)
                variantConfirmedRef.current = false
                setVariantConfirmed(false)
              }
              setRating(id)
              commit(id, nextIssues)
              if (id === 'clean') setIssues([])
            }}
            aria-pressed={confirmedByHuman && rating === id}
            className={`min-h-11 flex-1 rounded-xl border py-2 text-[13px] font-medium transition ${
              rating === id
                ? confirmedByHuman
                  ? 'border-transparent bg-accent text-on-accent'
                  : 'border-accent/60 bg-accent-soft text-accent-text'
                : 'border-line bg-raised text-ink2 hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {needsManualReplayReview && clipAvailable && rating === 'clean' && confirmedByHuman ? (
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
            className={`mt-2 min-h-11 w-full rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${
              visualReviewPassed
                ? 'border-ok/40 bg-ok-soft text-ok-text'
                : 'border-line-strong bg-surface text-ink hover:border-accent'
            }`}
          >
            {visualReviewPassed ? 'Replay checked — form held' : 'I reviewed the replay — form held'}
          </button>
        </div>
      ) : null}
      {needsFlightConfirmation && rating === 'clean' && confirmedByHuman ? (
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
            className={`mt-2 min-h-11 w-full rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${
              flightConfirmed
                ? 'border-ok/40 bg-ok-soft text-ok-text'
                : 'border-line-strong bg-surface text-ink hover:border-accent'
            }`}
          >
            {flightConfirmed ? 'Flight confirmed — no foot support' : 'Both feet stayed completely off the floor'}
          </button>
        </div>
      ) : null}
      {variantGaps.length > 0 && rating === 'clean' && confirmedByHuman ? (
        <div className="mt-3 rounded-xl border border-line bg-raised p-3">
          <p className="text-[12.5px] leading-relaxed text-ink2">{VARIANT_CRITICAL[exerciseId]?.prompt}</p>
          <button
            onClick={() => {
              variantConfirmedRef.current = true
              setVariantConfirmed(true)
              commit('clean', [], visualReviewRef.current, flightConfirmedRef.current, true)
            }}
            aria-pressed={variantConfirmed}
            className={`mt-2 min-h-11 w-full rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${
              variantConfirmed
                ? 'border-ok/40 bg-ok-soft text-ok-text'
                : 'border-line-strong bg-surface text-ink hover:border-accent'
            }`}
          >
            {variantConfirmed ? 'Confirmed — the shape held' : 'Confirmed — the shape held for the counted time'}
          </button>
        </div>
      ) : null}
      {rating === 'clean' && confirmedByHuman ? (
        <p
          className={`mt-2 text-[11.5px] font-medium ${progressionFormPassed ? 'text-ok-text' : 'text-accent-text'}`}
          role="status"
        >
          {progressionFormPassed
            ? value?.auto?.cleanSeconds !== undefined && value.auto.cleanSeconds + 0.05 < creditedHoldSec
              ? `Evidence complete — ${value.auto.cleanSeconds.toFixed(1)}s of this hold count toward progression before the sustained breakdown.`
              : progressionCameraIssues.length === 1
                ? 'Progression evidence complete — your Clean rating plus one isolated camera flag.'
                : 'Progression evidence complete — athlete and filmed form checks agree.'
            : needsManualReplayReview
              ? 'Your Clean rating is saved. Review the replay above for this hold to count toward progression.'
              : needsFlightConfirmation && value?.flightConfirmed !== true
                ? 'Your Clean rating is saved. Confirm that both feet stayed off the floor for this hold to count.'
                : variantGaps.length > 0 && value?.variantConfirmed !== true
                  ? 'Your Clean rating is saved. The camera could not see part of the shape — confirm it above for this hold to count.'
                  : progressionCameraIssues.includes('arms')
                    ? 'Saved as a PR, but the camera measured elbows that were not fully locked in the credited window, so this hold will not unlock.'
                    : value?.auto && progressionCameraIssues.length > 1
                      ? 'Saved as a PR, but the camera found multiple form flags, so this hold will not unlock.'
                      : 'Your Clean rating is saved. A successful camera check is still needed for progression.'}
        </p>
      ) : null}
      {rating && rating !== 'clean' ? (
        <div className="mt-3">
          <div className="text-[12.5px] text-ink2" id={`issues-${clipKey ?? exerciseId}`}>
            What gave out?{analysis?.ok && analysis.issues.length ? ' (pre-filled from the clip)' : ''}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby={`issues-${clipKey ?? exerciseId}`}>
            {issuesFor(exerciseId).map((f) => {
              const on = issues.includes(f.id)
              return (
                <button
                  key={f.id}
                  onClick={() => toggleIssue(f.id)}
                  aria-pressed={on}
                  className={`min-h-9 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition ${
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
      <Modal
        open={showProblemReport}
        onClose={() => {
          if (!reportSaving) {
            setShowProblemReport(false)
            onReportOpenChange?.(false)
          }
        }}
        label="Report a camera error"
      >
        <div className="p-6">
          <div className="pr-10">
            <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-accent-soft text-accent-text">
              <Icon name="info" size={20} />
            </div>
            <h2 className="font-display text-[20px] font-bold text-ink">Save this camera check?</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink2">
              A private problem report will keep this {EXERCISE_BY_ID[exerciseId]?.name ?? 'movement'} video, its
              score and measurements, the camera’s frame-by-frame working, and basic app/browser details on this
              device. Your name and unrelated training history are not included, and nothing is sent automatically.
            </p>
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-raised px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink3">Check being saved</div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-[14px] font-medium text-ink">{EXERCISE_BY_ID[exerciseId]?.name ?? exerciseId}</span>
              <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink2 tnum">
                {analysis?.score !== undefined || value?.auto?.score !== undefined
                  ? `Score ${analysis?.score ?? value?.auto?.score}`
                  : analysis?.ok === false
                    ? 'Check failed'
                    : `${creditedHoldSec.toFixed(1)}s hold`}
              </span>
            </div>
          </div>

          <label className="mt-4 block text-[13px] font-semibold text-ink" htmlFor={`problem-note-${clipKey}`}>
            What looks wrong? <span className="font-normal text-ink3">(optional)</span>
          </label>
          <textarea
            id={`problem-note-${clipKey}`}
            value={problemNote}
            onChange={(event) => setProblemNote(event.target.value)}
            maxLength={1200}
            rows={4}
            placeholder="For example: My elbows were straight, but it marked them as bent."
            className="mt-1.5 w-full resize-y rounded-2xl border border-line bg-raised px-3.5 py-3 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink3 focus:border-accent"
          />
          <div className="mt-1 text-right text-[11px] text-ink3 tnum">{problemNote.length}/1200</div>

          <div className="mt-4 flex gap-2.5">
            <button
              onClick={() => {
                setShowProblemReport(false)
                onReportOpenChange?.(false)
              }}
              disabled={reportSaving}
              className="flex-1 rounded-xl border border-line bg-surface py-3 text-[14px] font-medium text-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void saveReport()}
              disabled={reportSaving}
              aria-busy={reportSaving}
              className="flex flex-[1.35] items-center justify-center gap-2 rounded-xl bg-accent py-3 text-[14px] font-semibold text-on-accent disabled:opacity-60"
            >
              <Icon name={reportSaving ? 'clock' : 'check'} size={15} />
              {reportSaving ? 'Preparing report…' : 'Save problem report'}
            </button>
          </div>
          {reportSaving && !diagnosticRef.current ? (
            <p className="mt-2 text-center text-[11.5px] text-ink3" role="status">
              Rebuilding the camera details can take a moment. Keep this screen open.
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}

/** Clips whose automatic analysis is currently running, across row instances. */
const autoAnalysisInFlight = new Set<string>()

/** The reading already on file, when this row has not run its own check. */
function SavedReading({ auto, creditedHoldSec }: { auto: AutoForm; creditedHoldSec: number }) {
  return (
    <div className="mt-2 rounded-xl border border-line bg-raised p-3 text-[12.5px] leading-relaxed text-ink2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink3">Camera reading on file</div>
      <div className="mt-1">
        {auto.score !== undefined ? <span className="font-semibold text-ink">Form score {auto.score}. </span> : null}
        {auto.cleanSeconds !== undefined
          ? `Clean window ${(verifiedCleanSeconds(auto) ?? 0).toFixed(1)}s of ${creditedHoldSec.toFixed(1)}s. `
          : ''}
        {auto.issues.length
          ? `Flagged: ${auto.issues.map((i) => FORM_ISSUE_LABEL[i].toLowerCase()).join(', ')}.`
          : 'No measured issue.'}
        {auto.unseen?.length ? ` Not judged: ${auto.unseen.join(', ')}.` : ''}
      </div>
    </div>
  )
}

function AnalysisPanel({ analysis, creditedHoldSec }: { analysis: PoseFormResult; creditedHoldSec: number }) {
  return (
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
                <div className="text-[12px] font-semibold uppercase tracking-wide text-ink3">Form score</div>
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
              <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-text">Fix this first</div>
              <div className="mt-0.5 text-[12.5px] font-medium leading-snug text-ink">{analysis.fixFirst.cue}</div>
            </div>
          ) : null}
          {analysis.cleanSeconds !== undefined && (analysis.heldIssues ?? analysis.issues).includes('arms') ? (
            // Bent arms inside the window: none of it was clean, whatever the
            // breakdown timing says. A green "7.4s of 7.4s" here sat beside
            // "lock the elbows" on the same panel.
            <div className="mb-2 rounded-lg bg-accent-soft px-2.5 py-2 text-accent-text">
              <span className="font-semibold">Camera-verified clean window: none</span>
              <span className="text-[11.5px]">
                {' '}
                — the elbows were bent through the hold rather than breaking at one moment, so none of these{' '}
                {creditedHoldSec.toFixed(1)}s count as camera-verified clean.
              </span>
            </div>
          ) : analysis.cleanSeconds !== undefined ? (
            <div
              className={`mb-2 rounded-lg px-2.5 py-2 ${
                analysis.cleanSeconds + 0.05 >= creditedHoldSec ? 'bg-ok-soft text-ok-text' : 'bg-accent-soft text-accent-text'
              }`}
            >
              <span className="font-semibold">Camera-verified clean window: {analysis.cleanSeconds.toFixed(1)}s</span>
              <span className="text-[11.5px]">
                {' '}
                of {creditedHoldSec.toFixed(1)}s. Isolated joint-tracking jumps are ignored; a material miss has to
                persist for roughly a second before it stops progression credit.
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
              No measured issue found — this is what the camera could see, not a full verdict. Confirm scapular position
              and control yourself.
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
          {/* Stated on the face of the panel, not folded into detail: everything
              above is a verdict on what the camera could judge reliably, and
              skipped criteria must stay obvious. */}
          {analysis.frameTurned ? (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-[11.5px] text-ink3">
              <Icon name="rotate" size={13} className="mt-[1px] shrink-0" />
              <span>
                {analysis.frameTurned === 'top'
                  ? 'The picture was upside down'
                  : 'Filmed with the phone on its side'}{' '}
                — it was turned the right way up before your hip height and lean were judged.
              </span>
            </div>
          ) : null}
          {analysis.unseen.length ? (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-[11.5px] text-ink3">
              <Icon name="monitor" size={13} className="mt-[1px] shrink-0" />
              <span>
                Could not reliably judge your {analysis.unseen.join(', ')} — not judged above. Check the skeleton
                replay; a clearer side view, brighter light, or more distance can help.
              </span>
            </div>
          ) : null}
          <details className="mt-2">
            <summary className="cursor-pointer text-[11.5px] text-ink3">Measurement detail</summary>
            <div className="mt-1 space-y-0.5 text-[11.5px] text-ink3">
              {analysis.details.map((d) => (
                <div key={d}>{d}</div>
              ))}
              <div>
                {analysis.framesUsed} usable of {analysis.framesSampled ?? analysis.framesUsed} sampled moments ·{' '}
                {Math.round(analysis.confidence * 100)}% tracking confidence. A side-on estimate, not a verdict — correct
                it below if it read you wrong.
              </div>
            </div>
          </details>
        </>
      ) : (
        (analysis.reason ?? 'Could not analyse that clip.')
      )}
    </div>
  )
}
