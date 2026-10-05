import type { AppState } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { EXERCISE_BY_ID } from '../data/exercises'
import { qualifyingSeries } from './forecast'
import { readSignals } from './signals'
import { diagnosePlateau, FLAT_RATE, PLATEAU_MIN_DAYS, PLATEAU_MIN_SESSIONS, type PlateauVerdict } from './plateau'
import { fmtWeight } from './units'

/**
 * "Why am I stuck?" on the Progress screen.
 *
 * Whether the key hold has stalled, and why, is `diagnosePlateau` — the verdict
 * the coach acts on and Home shows. This screen used to run an older detector of
 * its own on the stopwatch series, so the two screens could disagree about
 * whether you were stuck at all, and it reported a rate even through noise too
 * wide to read one from.
 *
 * What stays here is what the plateau module does not do: habits in the log
 * worth tightening while things are still moving. Each is listed only when the
 * log supports it, and one that the plateau verdict already names is left to
 * that verdict rather than said twice.
 */

export interface Cause {
  id: string
  title: string
  detail: string
  fix: string
  severity: 'high' | 'medium' | 'low'
}

/**
 * Where the key hold stands. `insufficient` and `noisy` are the "don't know"
 * answers, and both are reachable: a rate is only claimed when there is enough
 * verified history and the swing between sessions is narrower than the trend.
 */
export type ProgressStatus = 'insufficient' | 'noisy' | 'progressing' | 'stalled' | 'regressing'

export interface Diagnosis {
  status: ProgressStatus
  /** The plateau verdict, when the key hold has stalled or is going backwards. */
  plateau: PlateauVerdict | null
  /** Seconds a week on the key hold — only when `status` is `progressing`. */
  gainPerWeek: number | null
  causes: Cause[]
  summary: string
}

const DAY = 86_400_000

/**
 * @param plateau the verdict already computed for this state (the coach's
 *   `plan.plateau`), so the screen shows exactly what the plan acted on. Left
 *   out, it is computed here.
 */
export function diagnose(state: AppState, now = Date.now(), plateau?: PlateauVerdict | null): Diagnosis {
  const sig = readSignals(state, now)
  const verdict = plateau === undefined ? diagnosePlateau(state, sig, now) : plateau
  const step = STEP_BY_ID[state.stepId]
  const keyName = (EXERCISE_BY_ID[step.keyExerciseId]?.name ?? step.name).toLowerCase()

  const series = qualifyingSeries(state, state.stepId)
  const spanDays = series.length > 1 ? (series[series.length - 1].at - series[0].at) / DAY : 0
  const enough = series.length >= PLATEAU_MIN_SESSIONS && spanDays >= PLATEAU_MIN_DAYS && sig.trendPerWeek !== null

  const status: ProgressStatus = verdict
    ? verdict.status
    : !enough
      ? 'insufficient'
      : sig.noisy
        ? 'noisy'
        : (sig.trendPerWeek ?? 0) > FLAT_RATE
          ? 'progressing'
          : // Not reachable while diagnosePlateau owns every flat case, but a
            // flat rate with no verdict must never be reported as progress.
            'insufficient'
  const gainPerWeek = status === 'progressing' ? sig.trendPerWeek : null
  const named = verdict?.cause

  const causes: Cause[] = []

  // Gated on evidence: one honestly-rated set on day one should not greet a
  // new athlete with a red high-severity warning.
  if (named !== 'form-limited' && sig.formRatedCount >= 4 && (sig.formDegrading || (sig.formCleanRate ?? 1) < 0.55)) {
    causes.push({
      id: 'form',
      title: 'Form is slipping',
      detail:
        sig.formCleanRate !== null
          ? `Only ${Math.round(sig.formCleanRate * 100)}% of your recent main sets were rated clean.`
          : 'Your ratings show the position breaking down under load.',
      fix: 'Ease the target until the sets come out clean, and count only the clean seconds. Film one from the side to see where the position goes.',
      severity: 'high',
    })
  }

  if (named !== 'under-stimulated' && sig.sessionsPerWeek < state.settings.weeklyGoal * 0.7 && state.sessions.length >= 6) {
    causes.push({
      id: 'frequency',
      title: 'Training less than you planned',
      detail: `You have averaged ${sig.sessionsPerWeek.toFixed(1)} sessions a week against a goal of ${state.settings.weeklyGoal}.`,
      fix: 'Coaches generally favour frequent, shorter sessions for a skill — a short session you do beats a long one you keep skipping. Try the 15-minute version on busy days.',
      severity: 'medium',
    })
  }

  if (named !== 'under-recovered' && (sig.lastLoadedRpe ?? 0) >= 9 && sig.daysSinceLoaded <= 1) {
    causes.push({
      id: 'recovery',
      title: 'Training hard on short rest',
      detail: 'Your last hard session was RPE 9+ and you are back within a day.',
      fix: 'The coach makes a day like this a technique day. A genuine rest day or a technique day between hard sessions means each hard one starts fresh rather than tired.',
      severity: 'medium',
    })
  }

  if (named !== 'under-recovered' && sig.readinessLoad !== null && sig.readinessLoad > 1.5) {
    causes.push({
      id: 'overload',
      title: 'Load is piling up faster than usual',
      detail: 'Your last few days carry noticeably more training than your own four-week normal.',
      // Describes load; must never claim to predict injury (CLAUDE.md).
      fix: 'The coach is already letting the next day or two run easier. This compares your load with your own recent normal — a description of the load, not a measure of injury risk.',
      severity: 'medium',
    })
  }

  if (sig.weightTrendPerWeek !== null && sig.weightTrendPerWeek > 0.15 && sig.weightKg) {
    const monthly = fmtWeight(sig.weightTrendPerWeek * 4, state.settings.units)
    causes.push({
      id: 'weight',
      title: 'Bodyweight is trending up',
      detail: `Up roughly ${monthly} over the last month. Planche is strength-to-weight, so this shows up directly in your holds.`,
      fix: 'Nothing to panic about — just be aware that holding steady while gaining weight is itself a strength gain. Judge the trend against it.',
      severity: 'low',
    })
  }

  if (sig.warmupRate < 0.7 && state.sessions.length >= 5) {
    causes.push({
      id: 'warmup',
      title: 'Warm-ups are getting skipped',
      detail:
        sig.warmupRate === 0
          ? 'None of your recent sessions included the warm-up.'
          : `Only ${Math.round(sig.warmupRate * 100)}% of recent sessions included the warm-up.`,
      fix: 'The full warm-up costs about three minutes. Warming up tends to help performance on the day — it has not been shown to prevent injury — and it is the moment to notice how your wrists feel before loading them.',
      severity: 'low',
    })
  }

  if (sig.daysSinceMaxTest !== null && sig.daysSinceMaxTest > 35 && state.sessions.length >= 10) {
    causes.push({
      id: 'testing',
      title: 'You have not tested in a while',
      detail: `Last max test was about ${sig.daysSinceMaxTest} days ago, so your working targets may be based on stale numbers.`,
      fix: 'Run a Max Test on a fresh day. You may already be stronger than the plan assumes.',
      severity: 'low',
    })
  }

  const order = { high: 0, medium: 1, low: 2 }
  causes.sort((a, b) => order[a.severity] - order[b.severity])

  const tighten =
    causes.length === 0 ? '' : ` ${causes.length === 1 ? 'One thing' : `${causes.length} things`} worth tightening below.`
  const summary =
    status === 'stalled' || status === 'regressing'
      ? `${status === 'regressing' ? 'Going backwards' : 'Flat'} for about ${verdict!.weeksFlat} week${
          verdict!.weeksFlat === 1 ? '' : 's'
        }.${tighten}`
      : status === 'noisy'
        ? `Your recent ${keyName} holds swing about ±${Math.round(
            (sig.variability ?? 0) * 100,
          )}% from session to session — wider than any trend, so whether you are progressing cannot be read yet. The same setup every time is the cheapest fix.${tighten}`
        : status === 'progressing'
          ? `Your ${keyName} is moving at about ${(gainPerWeek ?? 0).toFixed(1)}s a week.${
              causes.length === 0 ? ' Nothing here needs tightening.' : tighten
            }`
          : `Too early to call. Progress is read from verified ${keyName} holds — at least ${PLATEAU_MIN_SESSIONS} sessions across ${Math.round(
              PLATEAU_MIN_DAYS / 7,
            )} weeks — ${
              series.length < PLATEAU_MIN_SESSIONS
                ? `and you have ${series.length} so far.`
                : spanDays < PLATEAU_MIN_DAYS
                  ? `and yours span ${Math.floor(spanDays)} day${Math.floor(spanDays) === 1 ? '' : 's'} so far.`
                  : 'and there is not yet a comparable run of sessions to measure a rate from.'
            }${tighten}`

  return { status, plateau: verdict, gainPerWeek, causes, summary }
}
