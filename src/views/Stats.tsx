import { EmptyState } from '../components/ds'
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { EXERCISES, EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID, stepForKeyExercise, stepsOf } from '../data/progressions'
import { isQualifyingSet } from '../lib/progression'
import { verifiedReps } from '../lib/repLadder'
import { SKILLS } from '../data/skills'
import { activeSkills, isSkillHold, isSurfaceAware, skillView, stepOfSkill } from '../lib/skills'
import { ACHIEVEMENTS, type AchievementProgress } from '../data/achievements'
import {
  bestSeries,
  plotsProgressionCredit,
  weeklyVolume,
  totalHoldSec,
  totalSets,
  sessionHoldSec,
  sessionDurationSec,
} from '../lib/stats'
import {
  armStats,
  STRATEGY_BY_ID,
  formatStrategyEvidence,
  buildPlan,
  strategyStanding,
  type NoLeaderReason,
} from '../lib/coach'
import { diagnose } from '../lib/diagnose'
import { PLATEAU_LABEL } from '../lib/plateau'
import { PROGRESSION_STOP_LATENCY_SEC } from '../lib/sessionTiming'
import { fmtWeight } from '../lib/units'
import { lastOf } from '../components/MeasurePrompt'
import { fmtDate, fmtTime, fmtDuration, fmtHold, fmtClock } from '../lib/time'
import { HoldLineChart, VolumeBarChart, TrainingHeatmap } from '../components/charts'
import {
  describeTrend,
  filmedExercisesFor,
  formatCriterionValue,
  readFormTrends,
  type FormComparison,
} from '../lib/formTrend'
import { ClipPlayer } from '../components/ClipPlayer'
import { CLIP_RETENTION_DAYS } from '../lib/clips'
import { Icon } from '../components/Icon'
import { BadgeGlyph } from '../components/ds/BadgeGlyph'
import { Modal, SectionTitle, Stat } from '../components/ui'
import { WeeklySummary } from '../components/plan/WeeklySummary'
import { pushToast } from '../lib/toast'
import type { Exercise, SkillId, TrainingSurface } from '../types'
import { surfaceLabel, TRAINING_SURFACES } from '../data/equipment'
import { ASSIST_LABEL } from '../components/SetupRow'
import { PRESS_LADDER, pressingChoiceFor, twinOf } from '../data/pressing'
import { capacityOn } from '../lib/bridge'
import { END_REASON_LABEL } from '../components/AttemptEnd'
import { programmedPress } from '../data/workouts'

/** Categories whose logs are prescribed counts, not efforts worth a record. */
const UNTRACKED_RECORD_CATEGORIES = new Set<Exercise['category']>(['general', 'wrist', 'mobility'])

/** Why no approach is marked as leading, in the athlete's words (the rule is the coach's: `strategyStanding`). */
const NO_LEADER: Record<NoLeaderReason, string> = {
  unmeasured: 'No approach has a measured result yet, so there is nothing to rank.',
  alone: 'Only one approach has a measured result so far, so there is nothing to rank it against.',
  level:
    'No approach is ahead yet: on the coach’s ranking, which pulls thinly measured results toward the average, the best of them are too close to call — so none is marked as leading.',
  split:
    'No approach is marked as leading: the one the coach ranks first does not show the biggest gain. Its ranking is more than the observed rate — clearing the bar, effort, joint reports and filmed form all count — so the two can differ.',
  flat: 'No approach is marked as leading: none has a measurable gain after it yet.',
}

/**
 * Form over weeks, per position.
 *
 * The judge already tells you whether one rep was clean. This is the question
 * it could never answer: is the lean actually getting deeper, or does it only
 * feel that way? Everything here is per exercise and excludes any set where
 * the camera said it could not see that criterion — so the coverage line
 * ("seen in 4 of 11") is part of the answer, not a footnote.
 */
/**
 * The push-up versions as a ladder: where your press is now, your best reps on
 * each rung, and what opens the next one. Reps are the athlete's own logged
 * bests (any section), never a verified measure — the card says so.
 */
function PressingLadder() {
  const { state } = useStore()
  const choice = useMemo(() => pressingChoiceFor(state.stepId, capacityOn(state, state.stepId)), [state])
  // What a full day programs, after kit and any setup-answer swap.
  const current = useMemo(() => programmedPress(state), [state])
  const own = twinOf(state.stepId)
  return (
    <section id="pressing" className="scroll-mt-5">
      <SectionTitle>Pressing ladder</SectionTitle>
      <div className="rounded-inner border border-line bg-surface p-4 shadow-card">
        <ol className="space-y-1.5">
          {PRESS_LADDER.map((id) => {
            const ex = EXERCISE_BY_ID[id]
            const best = state.prs[id]?.value
            const isCurrent = id === current.exerciseId
            const isOwn = id === own
            return (
              <li
                key={id}
                className={`flex items-center justify-between gap-3 rounded-control px-3 py-2 text-footnote ${
                  isCurrent ? 'border border-accent/40 bg-accent-soft' : 'bg-raised'
                }`}
              >
                <span className="min-w-0">
                  <span className={`font-medium ${isCurrent ? 'text-ink' : 'text-ink2'}`}>{ex.name}</span>
                  {isCurrent ? (
                    <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-caption font-bold uppercase tracking-wide text-on-accent">
                      now
                    </span>
                  ) : isOwn ? (
                    <span className="ml-2 text-caption text-ink3">your step’s version</span>
                  ) : null}
                </span>
                <span className="shrink-0 tnum text-ink3">{best ? `best ${best}` : '—'}</span>
              </li>
            )
          })}
        </ol>
        <p className="mt-2.5 text-caption leading-relaxed text-ink3">
          {current.swapped && current.note
            ? `${current.note} Reps grow by one when every set hits its target.`
            : choice.atLevel && current.exerciseId === own
              ? `You press in your step’s own shape. Reps grow by one when every set hits its target.`
              : `${choice.reason} Reps grow by one when every set hits its target.`}{' '}
          Bests are your logged reps, not camera-verified.
        </p>
      </div>
    </section>
  )
}

function FormTrendCard({ skill }: { skill: SkillId }) {
  const { state } = useStore()
  // The skill being looked at leads the list; everything else filmed follows.
  const filmed = useMemo(() => filmedExercisesFor(state, skill), [state, skill])
  const [exerciseId, setExerciseId] = useState<string | null>(null)
  const [comparing, setComparing] = useState<FormComparison | null>(null)
  const active = exerciseId && filmed.includes(exerciseId) ? exerciseId : (filmed[0] ?? null)
  const result = useMemo(() => (active ? readFormTrends(state, active) : null), [state, active])

  if (!active || !result) {
    return (
      <div id="form-trend" className="mt-4 scroll-mt-5 rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="font-display text-title3 font-semibold text-ink">Form over time</div>
        <p className="mt-1 max-w-xl text-footnote leading-relaxed text-ink2">
          Once you have filmed a position a few times, this compares those clips against each other — whether your
          elbows are locking out more, whether your lean is deepening, whether your hips are drifting. Turn on the
          camera check for your main sets and it fills in on its own.
        </p>
      </div>
    )
  }

  const DIRECTION_STYLE: Record<'improving' | 'declining' | 'steady', string> = {
    improving: 'border-ok/30 bg-ok-soft text-ok-text',
    declining: 'border-danger/30 bg-danger-soft text-danger-text',
    steady: 'border-line bg-raised text-ink2',
  }

  return (
    <div id="form-trend" className="mt-4 scroll-mt-5 rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-title3 font-semibold text-ink">Form over time</div>
          <div className="text-footnote text-ink2">
            What the camera measured across your filmed {EXERCISE_BY_ID[active]?.name.toLowerCase() ?? 'sets'} sets
          </div>
        </div>
        {filmed.length > 1 ? (
          <label className="shrink-0 text-footnote text-ink2">
            <span className="sr-only">Exercise to show form trends for</span>
            <select
              value={active}
              onChange={(e) => setExerciseId(e.target.value)}
              className="rounded-control border border-line bg-raised px-3 py-2 text-footnote font-medium text-ink outline-none focus:border-accent"
            >
              {filmed.map((id) => (
                <option key={id} value={id}>
                  {EXERCISE_BY_ID[id]?.name ?? id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {result.kind === 'insufficient' ? (
        <div className="mt-3 rounded-inner border border-dashed border-line-strong bg-surface/50 p-5 text-footnote leading-relaxed text-ink2">
          <span className="font-medium text-ink">Not enough yet.</span> {result.need}
        </div>
      ) : (
        <>
          <ul className="mt-3 space-y-2.5">
            {result.trends.map((t) => (
              <li key={t.criterion} className="rounded-inner border border-line bg-raised p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body font-semibold text-ink">{t.label}</span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-caption font-semibold uppercase tracking-wide ${
                      DIRECTION_STYLE[t.direction]
                    }`}
                  >
                    {t.direction}
                  </span>
                  <span className="text-caption text-ink3">
                    seen in {t.seen} of {t.seen + t.unseen} filmed sets
                    {t.confidence === 'low' ? ' · low confidence' : ''}
                  </span>
                </div>
                <p className="mt-1 text-footnote leading-relaxed text-ink2">{describeTrend(t)}</p>
              </li>
            ))}
          </ul>
          {/* One comparison for the card, not one per row: it is the same two
              clips whichever criterion you came in for, and four buttons
              saying the same thing is how a useful screen becomes a busy one. */}
          {result.comparison ? (
            <button
              onClick={() => setComparing(result.comparison)}
              className="mt-3 inline-flex items-center gap-2 rounded-control border border-line bg-raised px-4 py-2.5 text-footnote font-medium text-ink transition hover:border-line-strong"
            >
              <Icon name="monitor" size={15} /> Watch then and now
              <span className="text-ink3">
                · {fmtDate(result.comparison.from.at)} vs {fmtDate(result.comparison.to.at)}
              </span>
            </button>
          ) : null}

          {/* Recordings are pruned, so the comparison window silently shrinks
              to the retention period unless a clip is pinned. Said once, here,
              at the moment it is relevant — not as a standing banner. */}
          {result.comparison === null ? (
            <p className="mt-3 text-footnote leading-relaxed text-ink3">
              No two clips far enough apart to compare yet. The first clip the camera could read on each step’s key
              hold is kept for good, so your “then” will still be here in months; other recordings clear after{' '}
              {CLIP_RETENTION_DAYS} days unless you pin them from the exercise guide in Learn.
            </p>
          ) : null}

          {result.skipped.length > 0 ? (
            <p className="mt-3 text-footnote leading-relaxed text-ink3">
              Not trended:{' '}
              {result.skipped.map((s, i) => (
                <span key={s.label}>
                  {i > 0 ? '; ' : ''}
                  <span className="font-medium text-ink2">{s.label}</span> — {s.reason}
                </span>
              ))}
              .
              {result.skipped.some((s) => s.cause === 'framing')
                ? ' For anything out of shot, framing is the usual cause; the live guide on the ready screen catches it before you start.'
                : ''}
            </p>
          ) : null}
          <p className="mt-3 text-footnote leading-relaxed text-ink3">
            Sets where the camera could not see a criterion are left out rather than averaged in, and a change smaller
            than the camera's own measurement error is reported as steady rather than as progress.
          </p>
        </>
      )}

      <Modal open={comparing !== null} onClose={() => setComparing(null)} label="Then and now form comparison" wide>
        {comparing ? <ThenAndNow comparison={comparing} exerciseId={active} /> : null}
      </Modal>
    </div>
  )
}

/**
 * The same position, months apart, playing side by side.
 *
 * A trend can tell you the body line drifted from 0.18 to 0.40. It cannot show
 * you what 0.40 looks like, and that is the thing you actually have to change.
 * Clips are kept for a limited time, so either of these can have been pruned —
 * the player reports its own availability and this says so plainly rather than
 * showing a dead frame.
 */
function ThenAndNow({ comparison, exerciseId }: { comparison: FormComparison; exerciseId: string }) {
  const [missing, setMissing] = useState<{ from: boolean; to: boolean }>({ from: false, to: false })
  const days = Math.max(1, Math.round((comparison.to.at - comparison.from.at) / 86_400_000))

  return (
    <div className="p-6">
      <div className="pr-10">
        <h2 className="font-display text-[20px] font-bold text-ink">Then and now</h2>
        <p className="mt-1 text-footnote leading-relaxed text-ink2">
          Your oldest and newest kept clips of the {EXERCISE_BY_ID[exerciseId]?.name.toLowerCase() ?? 'exercise'},{' '}
          {days} day{days === 1 ? '' : 's'} apart. Clips are only kept for a while, so this is the widest window still
          on your device — not necessarily the whole trend.
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(['from', 'to'] as const).map((side) => (
          <div key={side}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-footnote font-semibold text-ink">{side === 'from' ? 'Then' : 'Now'}</span>
              <span className="text-footnote text-ink3">{fmtDate(comparison[side].at)}</span>
            </div>
            {missing[side] ? (
              <div className="grid h-40 place-items-center rounded-lg border border-dashed border-line-strong px-4 text-center text-footnote leading-relaxed text-ink3">
                This recording has been cleared. Pin a clip from the exercise guide to keep it as a reference.
              </div>
            ) : (
              <ClipPlayer
                clipKey={comparison[side].clipKey}
                label={`${side === 'from' ? 'Earlier' : 'Latest'} form clip`}
                onAvailabilityChange={(available: boolean) =>
                  setMissing((m) => (m[side] === !available ? m : { ...m, [side]: !available }))
                }
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-footnote">
          <caption className="sr-only">What the camera measured in each clip</caption>
          <thead>
            <tr className="text-caption uppercase tracking-wide text-ink3">
              <th scope="col" className="pb-1.5 pr-3 font-semibold">
                Measured
              </th>
              <th scope="col" className="pb-1.5 pr-3 font-semibold">
                Then
              </th>
              <th scope="col" className="pb-1.5 pr-3 font-semibold">
                Now
              </th>
              <th scope="col" className="pb-1.5 font-semibold">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {comparison.criteria.map((c) => (
              <tr key={c.label} className="border-t border-line">
                <td className="py-2 pr-3 text-ink">{c.label}</td>
                <td className="py-2 pr-3 text-ink2 tnum">{formatCriterionValue(c.from, c.unit)}</td>
                <td className="py-2 pr-3 font-medium text-ink tnum">{formatCriterionValue(c.to, c.unit)}</td>
                <td
                  className={`py-2 font-medium ${
                    c.direction === 'improving'
                      ? 'text-ok-text'
                      : c.direction === 'declining'
                        ? 'text-danger-text'
                        : 'text-ink3'
                  }`}
                >
                  {c.direction === 'steady' ? 'no real change' : c.direction}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-footnote leading-relaxed text-ink3">
        Only criteria the camera measured in <em>both</em> clips are listed — comparing a reading against a blank would
        make framing look like progress.
      </p>
    </div>
  )
}

function achievementProgressText(progress: AchievementProgress): string {
  if (progress.unit === 'duration') return `${fmtDuration(progress.current)} / ${fmtDuration(progress.target)}`
  if (progress.unit === 'seconds') return `${fmtHold(progress.current)} / ${fmtHold(progress.target)}`
  if (progress.unit === 'score') return `${progress.current} / ${progress.target} score`
  return `${progress.current} / ${progress.target}`
}

export function Stats({
  focusSessionId = null,
  onFocused,
}: {
  /** Open this session's history entry and bring it into view. */
  focusSessionId?: string | null
  onFocused?: () => void
} = {}) {
  const { state: whole, dispatch } = useStore()
  // What the coach has learned, the forecast and the plateau read are all per
  // skill; history, records and achievements are the whole athlete's.
  const skills = activeSkills(whole)
  const [pickedSkill, setPickedSkill] = useState<SkillId | null>(null)
  const viewSkill: SkillId = pickedSkill && skills.includes(pickedSkill) ? pickedSkill : skills[0]
  const state = useMemo(() => skillView(whole, viewSkill), [whole, viewSkill])
  const [chartEx, setChartEx] = useState(() => STEP_BY_ID[state.stepId].keyExerciseId)
  // Changing skill moves the chart to that skill's key hold.
  useEffect(() => {
    setChartEx(STEP_BY_ID[stepOfSkill(whole, viewSkill)].keyExerciseId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSkill])
  const [chartSurface, setChartSurface] = useState<TrainingSurface | 'all'>('all')
  const [expanded, setExpanded] = useState<string | null>(focusSessionId)
  useEffect(() => {
    if (!focusSessionId) return
    setExpanded(focusSessionId)
    // After layout, so the entry exists to scroll to.
    const timer = window.setTimeout(() => {
      const card = [...document.querySelectorAll<HTMLElement>('[data-session]')].find(
        (el) => el.dataset.session === focusSessionId,
      )
      card?.scrollIntoView({ block: 'center' })
      card?.querySelector<HTMLElement>('button[aria-expanded]')?.focus({ preventScroll: true })
      onFocused?.()
    }, 50)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSessionId])
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [achievementFilter, setAchievementFilter] = useState<'all' | 'earned' | 'next' | 'locked'>('next')

  const chartIsPlanche = isSurfaceAware(EXERCISE_BY_ID[chartEx])
  /** The line plots unlock credit, not the timer — every label must say so. */
  const chartIsCredit = plotsProgressionCredit(chartEx)
  const series = useMemo(
    () => bestSeries(state, chartEx, chartIsPlanche && chartSurface !== 'all' ? chartSurface : undefined),
    [state, chartEx, chartIsPlanche, chartSurface],
  )
  /**
   * Why the trend is empty, when it is not simply "you have not trained it".
   *
   * A planche series only plots form-qualified sets, so an athlete who logs
   * this hold every week but does not film it sees nothing — and the default
   * prompt tells them to log sessions they have already logged, which reads
   * as a broken app rather than a missing camera check.
   */
  const chartEmptyHint = useMemo(() => {
    if (series.length >= 2) return undefined
    // One qualified session is evidence that exists — it just is not a trend
    // yet. Saying "none is form-qualified" beside it denied the athlete's
    // own verified hold.
    if (series.length === 1) {
      const only = series[0]
      return `One ${chartIsCredit ? 'form-qualified ' : ''}session so far: ${fmtHold(only.value)} on ${fmtDate(
        only.at,
      )}. A trend needs a second one.`
    }
    const logged = state.sessions.reduce(
      (n, session) => n + session.sets.filter((set) => set.exerciseId === chartEx && set.value > 0).length,
      0,
    )
    if (logged === 0) return undefined
    if (!chartIsCredit) return undefined
    if (chartIsPlanche && chartSurface !== 'all') {
      return `No form-qualified ${surfaceLabel(chartSurface).toLowerCase()} sets yet. Try “All surfaces”, or film a set on this surface.`
    }
    return `${logged} set${logged === 1 ? '' : 's'} of this hold logged, but none is form-qualified yet. This chart plots the credit that counts toward unlocking — sets you rated Clean that also passed a filmed check, up to the camera's clean window${
      EXERCISE_BY_ID[chartEx]?.perSide ? ', and the weaker side when both were trained' : ''
    }. Your records and totals still count everything.`
  }, [series, state.sessions, chartEx, chartIsPlanche, chartIsCredit, chartSurface])

  const arms = useMemo(() => armStats(state), [state])
  const triedArms = useMemo(() => arms.filter((arm) => arm.attempts > 0).length, [arms])
  const measuredArms = useMemo(() => arms.filter((arm) => arm.n > 0).length, [arms])
  const coachPick = useMemo(() => buildPlan(state), [state])
  const standing = useMemo(
    () => strategyStanding(arms, STEP_BY_ID[state.stepId]?.unlockSec ?? 20),
    [arms, state.stepId],
  )
  const maxArmRate = useMemo(() => Math.max(0.001, ...arms.map((a) => Math.abs(a.secPerWeek ?? 0))), [arms])
  const diag = useMemo(() => diagnose(state, Date.now(), coachPick.plateau), [state, coachPick])
  const weightNow = useMemo(() => lastOf(state, 'weightKg'), [state])
  const volume = useMemo(() => weeklyVolume(state, 12), [state])
  const sessions = useMemo(() => [...state.sessions].sort((a, b) => b.startedAt - a.startedAt), [state.sessions])

  // The selector leads with the viewed skill's own road, then any other hold
  // that has actually been logged. Every hold in the catalogue used to be
  // listed — some fifty entries, stretches included, for a chart most of them
  // could never fill.
  const roadHolds = useMemo(
    () =>
      stepsOf(viewSkill)
        .map((step) => EXERCISE_BY_ID[step.keyExerciseId])
        .filter((exercise, index, all) => exercise !== undefined && all.indexOf(exercise) === index),
    [viewSkill],
  )
  const otherHolds = useMemo(() => {
    const onRoad = new Set(roadHolds.map((exercise) => exercise.id))
    const logged = new Set(
      whole.sessions.flatMap((session) =>
        session.sets
          // Training holds only: a cool-down stretch is logged at its prescribed
          // time every session and has no trend worth a chart.
          .filter((set) => set.kind === 'hold' && set.value > 0 && set.section !== 'warmup' && set.section !== 'cooldown')
          .map((set) => set.exerciseId),
      ),
    )
    return EXERCISES.filter(
      (e) =>
        e.type === 'hold' && !onRoad.has(e.id) && (logged.has(e.id) || e.id === chartEx),
    )
  }, [roadHolds, whole.sessions, chartEx])
  const chartStep = stepForKeyExercise(chartEx)
  // Training movements only. Warm-up drills, wrist prep and stretches are
  // logged at their prescribed counts, so the board filled with "records" of
  // ten arm circles and a thirty-second stretch. The planche line leads.
  const trackedPrs = useMemo(
    () =>
      Object.entries(state.prs)
        .map(([id, pr]) => ({ ex: EXERCISE_BY_ID[id], pr }))
        .filter((x) => x.ex && !UNTRACKED_RECORD_CATEGORIES.has(x.ex.category))
        .sort(
          (a, b) =>
            Number(isSkillHold(b.ex)) - Number(isSkillHold(a.ex)) || b.pr.at - a.pr.at,
        ),
    [state.prs],
  )

  // A skill's badges are listed for an athlete who trains it or has earned
  // one — not thirty locked badges for roads nobody is on.
  const listedAchievements = useMemo(
    () =>
      ACHIEVEMENTS.filter(
        (achievement) => !achievement.skill || skills.includes(achievement.skill) || whole.achievements[achievement.id],
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skills.join(','), whole.achievements],
  )
  const achievementCards = useMemo(
    () =>
      listedAchievements.map((achievement, order) => {
        const at = state.achievements[achievement.id]
        const progress = !at && achievement.progress ? achievement.progress(state) : null
        return {
          achievement,
          order,
          at,
          progress,
          ratio: progress ? Math.min(1, progress.current / Math.max(1, progress.target)) : 0,
        }
      }),
    [state, listedAchievements],
  )
  const unlockedCount = achievementCards.filter((card) => card.at).length
  const lockedCount = listedAchievements.length - unlockedCount
  const nextAchievementCards = useMemo(
    () =>
      achievementCards
        .filter((card) => !card.at && card.progress)
        .sort((a, b) => b.ratio - a.ratio || a.order - b.order),
    [achievementCards],
  )
  const visibleAchievementCards = useMemo(() => {
    if (achievementFilter === 'earned') {
      return achievementCards.filter((card) => card.at).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    }
    if (achievementFilter === 'next') return nextAchievementCards.slice(0, 8)
    if (achievementFilter === 'locked') {
      return achievementCards
        .filter((card) => !card.at)
        .sort((a, b) => b.ratio - a.ratio || a.order - b.order)
    }
    return [...achievementCards].sort((a, b) => {
      if (Boolean(a.at) !== Boolean(b.at)) return a.at ? -1 : 1
      if (a.at && b.at) return b.at - a.at
      return b.ratio - a.ratio || a.order - b.order
    })
  }, [achievementCards, achievementFilter, nextAchievementCards])

  return (
    <div className="animate-rise">
      <h1 className="font-display text-[28px] font-bold text-ink">Progress</h1>
      <p className="mt-0.5 text-body text-ink2">Charts, records, history and trophies.</p>
      <div className="mt-4">
        <WeeklySummary />
      </div>
      {skills.length > 1 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Skill shown">
          {skills.map((skill) => {
            const on = skill === viewSkill
            return (
              <button
                key={skill}
                aria-pressed={on}
                onClick={() => setPickedSkill(skill)}
                className={`min-h-11 rounded-full border px-3.5 py-1.5 text-footnote font-semibold transition ${
                  on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-surface text-ink2 hover:text-ink'
                }`}
              >
                {SKILLS[skill].name}
              </button>
            )
          })}
          <span className="text-caption text-ink3">Trends and the coach's findings are per skill; history and records are all of you.</span>
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sessions" value={<span className="tnum">{state.sessions.length}</span>} />
        <Stat label="Total sets" value={<span className="tnum">{totalSets(state)}</span>} />
        <Stat label="Time under tension" value={fmtDuration(totalHoldSec(state))} />
        <Stat
          label="Achievements"
          value={
            <span className="tnum">
              {unlockedCount}
              <span className="text-body text-ink3">/{listedAchievements.length}</span>
            </span>
          }
        />
      </div>

      <nav
        aria-label="Progress sections"
        className="mt-3 flex gap-1.5 overflow-x-auto rounded-inner border border-line bg-surface/70 p-1.5 shadow-card"
      >
        {[
          ['trends', 'Trends'],
          ['form-trend', 'Form over time'],
          ['insights', 'Coach insights'],
          ['records', 'Records'],
          ['achievements', 'Achievements'],
          ['history', 'History'],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="shrink-0 rounded-control px-3 py-2 text-footnote font-medium text-ink2 transition hover:bg-raised hover:text-ink"
          >
            {label}
          </a>
        ))}
      </nav>

      {/* Hold trend */}
      <div id="trends" className="mt-4 scroll-mt-5 rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-display text-title3 font-semibold text-ink">
              {chartIsCredit ? 'Form-qualified credit per session' : 'Best hold per session'}
            </div>
            <div className="text-footnote text-ink2">
              {EXERCISE_BY_ID[chartEx]?.name}
              {chartIsPlanche && chartSurface !== 'all' ? ` · ${surfaceLabel(chartSurface)}` : ''}
            </div>
          </div>
          <select
            value={chartEx}
            onChange={(e) => setChartEx(e.target.value)}
            aria-label="Exercise shown in hold trend"
            className="rounded-control border border-line bg-raised px-3 py-2 text-footnote text-ink outline-none focus:border-accent"
          >
            <optgroup label={`${SKILLS[viewSkill].name} road`}>
              {roadHolds.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </optgroup>
            {otherHolds.length ? (
              <optgroup label="Other holds you have logged">
                {otherHolds.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>
        {chartIsPlanche ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => setChartSurface('all')}
              aria-pressed={chartSurface === 'all'}
              className={`rounded-full border px-3 py-1 text-caption font-medium ${
                chartSurface === 'all' ? 'border-transparent bg-accent text-on-accent' : 'border-line text-ink2'
              }`}
            >
              All surfaces
            </button>
            {TRAINING_SURFACES.map((item) => (
              <button
                key={item.id}
                onClick={() => setChartSurface(item.id)}
                disabled={item.id === 'parallettes' && !state.profile.equipment.includes('parallettes')}
                aria-pressed={chartSurface === item.id}
                className={`rounded-full border px-3 py-1 text-caption font-medium disabled:opacity-35 ${
                  chartSurface === item.id
                    ? 'border-transparent bg-accent text-on-accent'
                    : 'border-line text-ink2'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-3">
          <HoldLineChart
            points={series}
            goal={chartStep?.unlockSec}
            emptyHint={chartEmptyHint}
            label={chartIsCredit ? 'Form-qualified credit per session' : 'Best hold per session'}
          />
        </div>
      </div>

      {/* What the camera has measured about one position over weeks */}
      <FormTrendCard key={viewSkill} skill={viewSkill} />

      {/* Weekly volume */}
      <div id="insights" className="mt-4 scroll-mt-5 rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="font-display text-title3 font-semibold text-ink">Weekly hold volume</div>
        <div className="text-footnote text-ink2">Seconds accumulated in holds, last 12 weeks</div>
        <div className="mt-3">
          <VolumeBarChart weeks={volume} />
        </div>
      </div>

      {/* Where the key hold stands — the coach's own plateau verdict, so this
          screen and Home can never disagree about whether you are stuck. */}
      <div className="mt-4 rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-display text-title3 font-semibold text-ink">Why am I stuck?</div>
          <span
            className={`rounded-full px-3 py-1 text-footnote font-semibold ${
              diag.status === 'progressing'
                ? 'bg-ok-soft text-ok-text'
                : diag.status === 'stalled' || diag.status === 'regressing'
                  ? 'bg-danger-soft text-danger-text'
                  : 'bg-line text-ink2'
            }`}
          >
            {diag.status === 'progressing'
              ? 'Progressing'
              : diag.status === 'stalled'
                ? `Flat ~${diag.plateau?.weeksFlat ?? 0} week${diag.plateau?.weeksFlat === 1 ? '' : 's'}`
                : diag.status === 'regressing'
                  ? 'Going backwards'
                  : diag.status === 'noisy'
                    ? 'Too noisy to call'
                    : 'Too early to call'}
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-footnote leading-relaxed text-ink2">{diag.summary}</p>
        {diag.plateau ? (
          <div className="mt-3 rounded-inner border border-line bg-raised p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body font-semibold text-ink">{PLATEAU_LABEL[diag.plateau.cause]}</span>
              <span className="text-footnote text-ink3">
                {diag.plateau.confidence === 'good'
                  ? 'confident read'
                  : diag.plateau.confidence === 'moderate'
                    ? 'likely cause'
                    : 'best guess'}
              </span>
            </div>
            <p className="mt-1 text-footnote leading-relaxed text-ink2">{diag.plateau.evidence}</p>
            <p className="mt-1 text-footnote leading-relaxed text-ink">
              {coachPick.loadPermission === 'none'
                ? 'Worth fixing, but not today — what you reported in your check-in comes first.'
                : diag.plateau.intervention}
            </p>
          </div>
        ) : null}
        {diag.causes.length > 0 ? (
          <div className="mt-3 space-y-2">
            {diag.causes.map((c) => (
              <div key={c.id} className="rounded-inner border border-line bg-raised p-3.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      c.severity === 'high' ? 'bg-danger' : c.severity === 'medium' ? 'bg-accent' : 'bg-ink3'
                    }`}
                  />
                  <span className="text-body font-semibold text-ink">{c.title}</span>
                </div>
                <p className="mt-1 text-footnote leading-relaxed text-ink2">{c.detail}</p>
                <p className="mt-1 text-footnote leading-relaxed text-ink">
                  <span className="font-medium text-accent-text">Do this:</span> {c.fix}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Bodyweight */}
      {weightNow ? (
        <div className="mt-4 rounded-card border border-line bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-display text-title3 font-semibold text-ink">Bodyweight</div>
            <div className="text-footnote text-ink2 tnum">
              Now {fmtWeight(weightNow.value, state.settings.units)}
            </div>
          </div>
          <p className="mt-1 text-footnote leading-relaxed text-ink2">
            Holding the same clean seconds at a heavier bodyweight can be useful strength-to-weight context. The
            progression bar itself still uses form-qualified seconds.
          </p>
        </div>
      ) : null}

      {/* What the coach learned */}
      <div className="mt-4 rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-display text-title3 font-semibold text-ink">
              What your coach has learned{skills.length > 1 ? ` · ${SKILLS[viewSkill].name}` : ''}
            </div>
            <div className="max-w-xl text-footnote leading-relaxed text-ink2">
              It tries different ways of shaping your main sets, then looks at how your key hold moved in the sessions
              after each. The approach with the best measured results gets used most, and untested ones get their turn —
              these are observations from your log, not proof of what caused a gain.
            </div>
          </div>
          <span className="rounded-full bg-accent-soft px-3 py-1 text-footnote font-semibold text-accent-text">
            Today: {STRATEGY_BY_ID[coachPick.strategy].name}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-caption font-medium text-ink2">
          <span className="rounded-full border border-line bg-raised px-2.5 py-1 tnum">{triedArms}/5 tried</span>
          <span className="rounded-full border border-line bg-raised px-2.5 py-1 tnum">{measuredArms}/5 measured</span>
          {arms.some((arm) => arm.attempts > arm.n) ? (
            <span className="text-ink3">A try becomes measurable after a later key-hold session.</span>
          ) : null}
        </div>
        {/* A ranking with no leader says so, and why — it is not left to the
            absence of a badge. */}
        {standing.leader === null ? (
          <p className="mt-2 text-footnote leading-relaxed text-ink2" role="status">
            {NO_LEADER[standing.why]}
          </p>
        ) : null}

        <div className="mt-4 space-y-2.5">
          {arms.map((a) => {
            const def = STRATEGY_BY_ID[a.id]
            const isLeading = standing.leader === a.id
            return (
              <div key={a.id} className="rounded-inner border border-line bg-raised p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-body font-semibold text-ink">{def.name}</span>
                    {isLeading ? (
                      // "Leading", not "fastest": ranked first by the coach,
                      // clear of the next, with the biggest observed gain — and
                      // still an observation, not a cause.
                      <span
                        className="rounded-full bg-ok-soft px-2 py-0.5 text-caption font-bold uppercase tracking-wide text-ok-text"
                        title="Ranked first by the coach, clear of the next, with the biggest observed gain so far — not proof it causes faster gains"
                      >
                        leading
                      </span>
                    ) : null}
                    {a.id === coachPick.strategy ? (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-caption font-bold uppercase tracking-wide text-accent-text">
                        today
                      </span>
                    ) : null}
                  </div>
                  <span className="text-footnote font-medium text-ink2 tnum">
                    {formatStrategyEvidence(a)}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full rounded-full ${
                      (a.secPerWeek ?? 0) < 0 ? 'bg-danger/60' : isLeading ? 'bg-ok' : 'bg-accent/60'
                    }`}
                    style={{
                      width: `${
                        a.n === 0 || a.secPerWeek === null ? 0 : Math.max(3, (Math.abs(a.secPerWeek) / maxArmRate) * 100)
                      }%`,
                    }}
                  />
                </div>
                <div className="mt-1.5 text-footnote leading-relaxed text-ink3">{def.blurb}</div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 space-y-1 text-footnote leading-relaxed text-ink3">
          <p>
            Rates are measured on your current step's key hold and recomputed from your history — deleting a session
            updates them honestly.
          </p>
          <p>
            Noise is handled deliberately: averages are pulled toward the overall mean until a strategy has real
            evidence behind it, targets anchor on your typical hold rather than your single best, and session-to-session
            swings of more than ~22% around your own trend pause changes instead of driving them.
            {' '}
            {state.settings.phoneWithinReach
              ? `Timed holds have your ${state.settings.stopLatencySec.toFixed(1)}s calibrated stop delay taken off`
              : `Main Path holds — all but the ones held within reach of the phone, such as a lean — have ${Math.max(state.settings.walkBackSec ?? PROGRESSION_STOP_LATENCY_SEC, state.settings.stopLatencySec).toFixed(
                  1,
                )}s taken off for getting back to the phone, and other timed holds your ${state.settings.stopLatencySec.toFixed(
                  1,
                )}s calibrated delay`}
            {' '}— each set can be corrected on the rest screen, and a hold timed from its video has nothing taken off.
          </p>
        </div>
      </div>

      {/* Consistency heatmap */}
      <div className="mt-4 rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="font-display text-title3 font-semibold text-ink">Consistency</div>
        <div className="text-footnote text-ink2">Every training day of the last 16 weeks — darker means more hold time</div>
        <div className="mt-4">
          <TrainingHeatmap sessions={state.sessions} />
        </div>
      </div>

      {/* The pressing ladder: the push-up versions as a road of their own */}
      {skills.includes('planche') ? <PressingLadder /> : null}

      {/* PR board */}
      <section id="records" className="scroll-mt-5">
      <SectionTitle>Personal records</SectionTitle>
      {trackedPrs.length === 0 ? (
        <div className="rounded-card border border-dashed border-line-strong">
          <EmptyState icon="trophy" title="No records yet">
            Records appear as soon as you log sets.
          </EmptyState>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {trackedPrs.map(({ ex, pr }) => (
            <div key={ex.id} className="rounded-inner border border-line bg-surface p-4 shadow-card">
              <div className="truncate text-footnote font-medium text-ink2">{ex.name}</div>
              <div className="mt-0.5 font-display text-[22px] font-semibold text-ink tnum">
                {ex.type === 'hold' ? fmtHold(pr.value) : `${pr.value}`}
                {ex.type === 'reps' ? <span className="text-footnote font-normal text-ink3"> reps</span> : null}
              </div>
              <div className="text-caption text-ink3">{fmtDate(pr.at)}</div>
              {pr.bySurface ? (
                <div className="mt-2 space-y-1 border-t border-line pt-2">
                  {TRAINING_SURFACES.flatMap((item) => {
                    const mark = pr.bySurface?.[item.id]
                    return mark
                      ? [
                          <div key={item.id} className="flex items-center justify-between gap-2 text-caption">
                            <span className="text-ink3">{item.label}</span>
                            <span className="font-medium text-ink2 tnum">
                              {ex.type === 'hold' ? fmtHold(mark.value) : `${mark.value}`}
                            </span>
                          </div>,
                        ]
                      : []
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      </section>

      {/* Achievements */}
      <section id="achievements" className="scroll-mt-5">
      <SectionTitle
        right={<span className="text-footnote text-ink3 tnum">{lockedCount} still to earn</span>}
      >
        Achievements
      </SectionTitle>
      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div className="card-sheen bg-gradient-to-br from-accent-soft to-transparent p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-caption font-semibold uppercase tracking-wider text-accent-text">Trophy cabinet</div>
              <div className="mt-1 font-display text-[25px] font-semibold text-ink tnum">
                {unlockedCount} <span className="text-body font-normal text-ink3">of {listedAchievements.length} earned</span>
              </div>
            </div>
            <Icon name="trophy" size={28} className="text-accent-text" />
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${(unlockedCount / Math.max(1, listedAchievements.length)) * 100}%` }}
            />
          </div>
          {nextAchievementCards.length > 0 ? (
            <div className="mt-4">
              <div className="mb-2 text-caption font-medium text-ink3">Closest unlocks</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {nextAchievementCards.slice(0, 3).map(({ achievement, progress, ratio }) => (
                  <button
                    key={achievement.id}
                    onClick={() => setAchievementFilter('next')}
                    className="flex items-center gap-2.5 rounded-control border border-line bg-surface/75 p-2.5 text-left transition hover:border-line-strong"
                  >
                    <BadgeGlyph icon={achievement.icon} size={32} earned={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-footnote font-semibold text-ink">{achievement.name}</span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${ratio * 100}%` }} />
                      </span>
                      {progress ? (
                        <span className="mt-1 block text-caption text-ink3 tnum">
                          {achievementProgressText(progress)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex gap-1 overflow-x-auto border-t border-line p-2">
          {([
            ['next', 'Next up', nextAchievementCards.length],
            ['earned', 'Earned', unlockedCount],
            ['locked', 'Locked', lockedCount],
            ['all', 'All', listedAchievements.length],
          ] as const).map(([filter, label, count]) => (
            <button
              key={filter}
              onClick={() => setAchievementFilter(filter)}
              aria-pressed={achievementFilter === filter}
              className={`shrink-0 rounded-control px-3 py-2 text-footnote font-medium transition ${
                achievementFilter === filter ? 'bg-accent text-on-accent' : 'text-ink2 hover:bg-raised hover:text-ink'
              }`}
            >
              {label} <span className="ml-0.5 opacity-70 tnum">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {visibleAchievementCards.length > 0 ? (
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {visibleAchievementCards.map(({ achievement: a, at, progress: prog }) => {
          return (
            <div
              key={a.id}
              className={`flex min-h-[150px] flex-col rounded-inner border p-4 ${
                at ? 'card-sheen border-accent/30 bg-surface shadow-card' : 'border-line bg-surface/40'
              }`}
            >
              <BadgeGlyph icon={a.icon} size={44} earned={!!at} />
              <div className={`mt-1.5 text-footnote font-semibold ${at ? 'text-ink' : 'text-ink3'}`}>{a.name}</div>
              <div className="mt-0.5 text-caption leading-snug text-ink3">{a.desc}</div>
              {at ? (
                <div className="mt-auto pt-2 text-caption font-medium text-accent-text">Earned {fmtDate(at)}</div>
              ) : prog ? (
                <div className="mt-auto pt-3">
                  <div className="h-1 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-accent/60"
                      style={{ width: `${Math.min(100, (prog.current / prog.target) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-caption text-ink3 tnum">
                    {achievementProgressText(prog)}
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      ) : (
        <div className="mt-3 rounded-inner border border-dashed border-line-strong p-6 text-center text-footnote text-ink3">
          Nothing in this view yet — keep training and it will fill up.
        </div>
      )}
      </section>

      {/* History */}
      <section id="history" className="scroll-mt-5">
      <SectionTitle>History</SectionTitle>
      {sessions.length === 0 ? (
        <div className="rounded-card border border-dashed border-line-strong">
          <EmptyState icon="calendar" title="No sessions yet">
            Your session log will live here.
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => {
            const open = expanded === s.id
            const panelId = `session-${s.id}`
            return (
              <div key={s.id} data-session={s.id} className="overflow-hidden rounded-inner border border-line bg-surface shadow-card">
                <button
                  onClick={() => setExpanded(open ? null : s.id)}
                  aria-expanded={open}
                  aria-controls={panelId}
                  className="flex w-full items-center gap-3 p-4 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2.5">
                      <span className="text-body font-semibold text-ink">{s.workoutName}</span>
                      <span className="text-footnote text-ink3">
                        {fmtDate(s.startedAt)} · {fmtTime(s.startedAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-footnote text-ink2 tnum">
                      {s.sets.length} set{s.sets.length === 1 ? '' : 's'} · {sessionHoldSec(s)}s held ·{' '}
                      {fmtClock(sessionDurationSec(s))}
                      {s.rpe ? ` · RPE ${s.rpe}` : ''}
                      {s.completion === 'partial' ? (
                        <span className="ml-1.5 rounded-full border border-line bg-raised px-2 py-0.5 text-caption font-medium text-ink3">
                          finished early{s.plannedRounds ? ` · ${s.sets.length}/${s.plannedRounds}` : ''}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Icon name="chevronD" size={16} className={`shrink-0 text-ink3 transition ${open ? 'rotate-180' : ''}`} />
                </button>
                {open ? (
                  <div id={panelId} className="border-t border-line px-4 pb-4 pt-3">
                    {s.notes ? <div className="mb-3 rounded-control bg-raised p-3 text-footnote italic text-ink2">“{s.notes}”</div> : null}
                    <div className="grid gap-1 sm:grid-cols-2">
                      {s.sets.map((set, i) => {
                        const ex = EXERCISE_BY_ID[set.exerciseId]
                        const tags = [
                          set.side ? (set.side === 'left' ? 'left' : 'right') : null,
                          set.assist && set.assist !== 'none' ? ASSIST_LABEL[set.assist].toLowerCase() : null,
                          set.timing?.method === 'edited' ? 'entered by hand' : null,
                          set.timing?.method === 'interrupted' ? 'interrupted' : null,
                          set.endReason ? END_REASON_LABEL[set.endReason].toLowerCase() : null,
                          // What the set stands on: full evidence, or only the athlete's rating.
                          isQualifyingSet(set, set.exerciseId)
                            ? 'verified'
                            : verifiedReps(set) > 0
                              ? 'replay checked'
                              : set.form?.confirmed === true
                                ? `rated ${set.form.rating === 'broke' ? 'broke down' : set.form.rating}`
                                : null,
                        ].filter(Boolean)
                        return (
                          <div key={i} className="flex items-baseline justify-between gap-3 text-footnote">
                            <span className="min-w-0 text-ink2">
                              {ex?.name ?? set.exerciseId}
                              {tags.length ? <span className="ml-1.5 text-caption text-ink3">· {tags.join(' · ')}</span> : null}
                            </span>
                            <span className="shrink-0 text-ink tnum">
                              {set.kind === 'hold' ? fmtHold(set.value) : `${set.value} reps`}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <button
                      onClick={() => setConfirmDelete(s.id)}
                      className="mt-3 inline-flex items-center gap-1.5 text-footnote font-medium text-danger-text/80 hover:text-danger-text"
                    >
                      <Icon name="trash" size={14} /> Delete session
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      </section>

      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} label="Delete session">
        <div className="p-6">
          <h2 className="font-display text-[19px] font-semibold text-ink">Delete this session?</h2>
          <p className="mt-1.5 text-body text-ink2">
            Records, unlocks and achievements will be recalculated from the remaining history.
          </p>
          <div className="mt-5 flex gap-2.5">
            <button
              onClick={() => setConfirmDelete(null)}
              className="flex-1 rounded-control border border-line bg-surface py-3 text-body font-medium text-ink"
            >
              Keep it
            </button>
            <button
              onClick={() => {
                if (confirmDelete) dispatch({ type: 'DELETE_SESSION', id: confirmDelete })
                setConfirmDelete(null)
                setExpanded(null)
                pushToast('Session deleted.', 'info')
              }}
              className="flex-1 rounded-control bg-danger-solid py-3 text-body font-semibold text-white"
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
