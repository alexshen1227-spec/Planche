import type { AppState } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { readSignals } from './signals'
import { bestSeries } from './stats'
import { fmtWeight } from './units'

/**
 * "Why am I stuck?" — answered from the athlete's own log rather than generic
 * advice. Each cause is only listed when the data actually supports it, and
 * they are ranked by how much they are likely costing.
 */

export interface Cause {
  id: string
  title: string
  detail: string
  fix: string
  severity: 'high' | 'medium' | 'low'
}

export interface Diagnosis {
  plateaued: boolean
  weeksFlat: number
  gainPerWeek: number | null
  causes: Cause[]
  summary: string
}

const DAY = 86_400_000

export function diagnose(state: AppState, now = Date.now()): Diagnosis {
  const sig = readSignals(state, now)
  const step = STEP_BY_ID[state.stepId]
  const series = bestSeries(state, step.keyExerciseId)
  const causes: Cause[] = []

  // How long has the key hold been flat?
  let weeksFlat = 0
  if (series.length >= 3) {
    const best = Math.max(...series.map((p) => p.value))
    const firstBestAt = series.find((p) => p.value >= best)?.at ?? now
    weeksFlat = Math.max(0, Math.floor((now - firstBestAt) / (7 * DAY)))
  }
  const gainPerWeek = sig.trendPerWeek
  const plateaued = series.length >= 4 && (gainPerWeek === null || gainPerWeek <= 0.15) && weeksFlat >= 2

  // Gated on evidence: one honestly-rated set on day one should not greet a
  // new athlete with a red high-severity warning.
  if (sig.formRatedCount >= 4 && (sig.formDegrading || (sig.formCleanRate ?? 1) < 0.55)) {
    causes.push({
      id: 'form',
      title: 'Form is slipping',
      detail:
        sig.formCleanRate !== null
          ? `Only ${Math.round(sig.formCleanRate * 100)}% of your recent main sets were rated clean.`
          : 'Your ratings show the position breaking down under load.',
      fix: 'Drop the target ~20% for two weeks and only count clean reps. Film a set from the side and compare it against your reference clip.',
      severity: 'high',
    })
  }

  if (sig.sessionsPerWeek < state.settings.weeklyGoal * 0.7 && state.sessions.length >= 6) {
    causes.push({
      id: 'frequency',
      title: 'Training less than you planned',
      detail: `You have averaged ${sig.sessionsPerWeek.toFixed(1)} sessions a week against a goal of ${state.settings.weeklyGoal}.`,
      fix: 'Planche responds to frequency more than to heroic single sessions. Two short sessions beat one long one you keep skipping.',
      severity: 'high',
    })
  }

  if (sig.weeksSinceDeload >= 6 && state.sessions.length >= 12) {
    causes.push({
      id: 'deload',
      title: 'No easy week in a long time',
      detail: `It has been about ${sig.weeksSinceDeload} weeks since a deliberately light week.`,
      fix: 'Take a Deload Flow week at roughly half volume. Strength is expressed after recovery, not during accumulation.',
      severity: 'high',
    })
  }

  if (sig.pressingLags) {
    causes.push({
      id: 'pressing',
      title: 'Pressing strength has flattened too',
      detail: 'Your push-up and pseudo-planche numbers are as flat as your holds, which points at a strength ceiling rather than a skill one.',
      fix: 'Add a dedicated Push Strength session each week and keep the planche work submaximal while it catches up.',
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
      severity: 'medium',
    })
  }

  if (sig.noisy) {
    causes.push({
      id: 'noise',
      title: 'Your numbers are too noisy to read',
      detail: `Recent holds swing about ±${Math.round((sig.variability ?? 0) * 100)}%, which usually means the setup is changing between sessions.`,
      fix: 'Keep it identical: same surface, same hand position, parallettes or floor but not both, and stop each hold on the same cue.',
      severity: 'medium',
    })
  }

  if (sig.warmupRate < 0.7 && state.sessions.length >= 5) {
    causes.push({
      id: 'warmup',
      title: 'Warm-ups are getting skipped',
      detail: `Only ${Math.round(sig.warmupRate * 100)}% of recent sessions included the warm-up.`,
      fix: 'Cold tissue holds less and complains more. The full warm-up costs three minutes and protects the wrists that all of this runs on.',
      severity: 'medium',
    })
  }

  if ((sig.lastLoadedRpe ?? 0) >= 9 && sig.daysSinceLoaded <= 1) {
    causes.push({
      id: 'recovery',
      title: 'Training hard on short rest',
      detail: 'Your last hard session was RPE 9+ and you are back within a day.',
      fix: 'Straight-arm work is neural — it wants a fresh nervous system. Put a genuine rest day, or a technique day, between hard sessions.',
      severity: 'medium',
    })
  }

  if (sig.readinessLoad !== null && sig.readinessLoad > 1.5) {
    causes.push({
      id: 'overload',
      title: 'Load is piling up faster than usual',
      detail: 'Your last few days carry noticeably more training than your own four-week normal.',
      fix: 'Spikes like this are where progress stalls and joints complain. Let the next day or two run easy — the coach is already planning for it.',
      severity: 'medium',
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

  const summary = !plateaued
    ? gainPerWeek && gainPerWeek > 0.15
      ? causes.length === 0
        ? `You are progressing at about ${gainPerWeek.toFixed(1)}s per week. Nothing here needs fixing.`
        : `You are progressing at about ${gainPerWeek.toFixed(1)}s per week — good. ${
            causes.length === 1 ? 'One thing' : `${causes.length} things`
          } worth tightening before it stalls.`
      : 'Not enough history yet to call a plateau — keep logging and this will sharpen up.'
    : causes.length === 0
      ? `Flat for about ${weeksFlat} weeks, but nothing in your log stands out as the cause. That usually means it is sleep, stress or nutrition — the things this app cannot see.`
      : `Flat for about ${weeksFlat} weeks. ${causes.length} likely cause${causes.length > 1 ? 's' : ''} found in your log, most important first.`

  return { plateaued, weeksFlat, gainPerWeek, causes, summary }
}

// ————————————————————————— Weak-link testing —————————————————————————

export interface WeakLinkTest {
  id: string
  exerciseId: string
  name: string
  what: string
  /** Below this you are likely limited by this quality rather than by planche strength. */
  benchmark: number
  unit: 's' | 'reps'
}

/**
 * The four qualities that most often cap a planche. Testing them tells you
 * whether you need strength, mobility, or just more planche practice.
 */
export const WEAK_LINK_TESTS: WeakLinkTest[] = [
  {
    id: 'core',
    exerciseId: 'hollow-hold',
    name: 'Hollow body hold',
    what: 'Trunk stiffness. A weak hollow makes the hips sag no matter how strong the shoulders are.',
    benchmark: 45,
    unit: 's',
  },
  {
    id: 'scap',
    exerciseId: 'ppp-hold',
    name: 'Pseudo planche plank',
    what: 'Straight-arm scapular strength — the engine every planche runs on.',
    benchmark: 45,
    unit: 's',
  },
  {
    id: 'press',
    exerciseId: 'pppu',
    name: 'Pseudo planche push-ups',
    what: 'Dynamic pressing strength in the planche line.',
    benchmark: 8,
    unit: 'reps',
  },
  {
    id: 'mobility',
    exerciseId: 'pancake-stretch',
    name: 'Pancake hold',
    what: 'Straddle width. A wider pancake shortens the lever and makes the straddle planche cheaper.',
    benchmark: 45,
    unit: 's',
  },
]

export interface WeakLinkResult extends WeakLinkTest {
  best: number | null
  ratio: number | null
  status: 'untested' | 'limiting' | 'adequate' | 'strong'
}

export function weakLinks(state: AppState): WeakLinkResult[] {
  return WEAK_LINK_TESTS.map((t) => {
    const best = state.prs[t.exerciseId]?.value ?? null
    const ratio = best === null ? null : best / t.benchmark
    const status: WeakLinkResult['status'] =
      ratio === null ? 'untested' : ratio < 0.6 ? 'limiting' : ratio < 1 ? 'adequate' : 'strong'
    return { ...t, best, ratio, status }
  })
}
