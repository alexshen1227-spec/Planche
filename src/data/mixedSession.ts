import type { AppState, Block, SkillId, Workout, WorkoutSkillMeta } from '../types'
import { EXERCISE_BY_ID } from './exercises'
import { STEP_BY_ID } from './progressions'
import { SKILLS } from './skills'
import type { CoachPlan } from '../lib/coach'
import type { LineupEntry, LineupRole } from '../lib/lineup'
import { isBarAttempt } from '../lib/progression'
import { skillView, stepOfSkill } from '../lib/skills'
import { estimateMinutes, fitToBudget, joinWords } from './workouts'

/**
 * One session, several skills.
 *
 * Each skill in today's line-up is built as its own session — by the same
 * builder that makes its single-skill days, from its own plan — and the parts
 * are then laid into one running order:
 *
 *   warm-up → balance practice → the lead skill's holds → its partner's holds
 *   → strength work, alternating between the two → core → cooldown
 *
 * That order is the one coaches describe (skill practice while fresh, the
 * priority strength skill first, push alternated with pull); none of it has
 * been tested in a trial on these skills, and the session says so where it
 * explains itself (ledger §13).
 *
 * **What goes in is decided by priority, not by trimming.** Every part's holds
 * are in — that is what "training the skill today" means. After them the time
 * left is filled in a fixed order: the moving version of each skill's step
 * (lead first), one shared core block, each skill's support work, then second
 * strength movements and back-off work. Whatever does not fit is left out and
 * named. The earlier version let each part trim itself to a share of the time,
 * and every part gave up its core first — a mixed session had none at all.
 *
 * What a part keeps also depends on its role. A maintenance skill keeps its
 * key hold at the current step and nothing else — the progression, not the
 * volume, is what a maintenance dose holds on to. Balance practice keeps its
 * holds and its balance drill.
 *
 * One maximal effort a session: if the lead has an unlock attempt or a re-test
 * queued, the other skills' attempts wait for another day.
 */

/** Never trimmed against the clock: built with room for everything, then chosen from. */
const UNTRIMMED_MIN = 240

/** What a part's blocks are for, in the order the mixed session wants them. */
type Tier =
  | 'always' // warm-up, holds at the dose a short session keeps, balance practice, cooldown
  | 'twin' // the moving version of the step
  | 'limiter' // the coach's measured limiter
  | 'core'
  | 'support' // straight-arm and support work
  | 'bridge' // the drill that teaches the next shape; the shape with help
  | 'strength' // a second strength movement
  | 'extra' // back-off work, more core, mobility

function tierOf(block: Block, role: LineupRole): Tier | null {
  if (block.section === 'warmup' || block.section === 'cooldown') {
    // Goal mobility is a nice-to-have; the standard cooldown always runs.
    return block.role === 'mobility' ? 'extra' : 'always'
  }
  if (block.section === 'main') {
    if (role === 'lead' || role === 'partner') return 'always'
    // A maintenance or practice part is its key hold — and its max effort, on
    // the day it holds the session's one; next-shape practice waits for a day
    // the skill has a full part.
    return block.role === 'skill' || block.role === 'attempt' ? 'always' : null
  }
  if (block.role === 'balance') return role === 'maintenance' ? null : 'always'
  if (role === 'maintenance' || role === 'practice') return null
  if (block.emphasis) return 'limiter'
  switch (block.role) {
    case 'press':
      return 'twin'
    case 'core':
      return 'core'
    case 'straight-arm':
      return 'support'
    case 'bridge':
    case 'assisted':
      return 'bridge'
    case 'pressing':
      return 'strength'
    default:
      return 'extra'
  }
}

/** The order optional work is added in, most worth keeping first. */
const FILL_ORDER: { tier: Tier; who: 'lead' | 'partner' }[] = [
  { tier: 'twin', who: 'lead' },
  { tier: 'twin', who: 'partner' },
  { tier: 'limiter', who: 'lead' },
  { tier: 'core', who: 'lead' },
  { tier: 'support', who: 'lead' },
  { tier: 'limiter', who: 'partner' },
  { tier: 'support', who: 'partner' },
  { tier: 'bridge', who: 'lead' },
  { tier: 'strength', who: 'lead' },
  { tier: 'core', who: 'partner' },
  { tier: 'bridge', who: 'partner' },
  { tier: 'strength', who: 'partner' },
  { tier: 'extra', who: 'lead' },
  { tier: 'extra', who: 'partner' },
]

/** Stretches a mixed session keeps: the lead's standard pair and one for each other skill. */
const COOLDOWN_PER_OTHER = 1

type Phase = 0 | 1 | 2 | 3 | 4

/** Where a block sits in the mixed running order. */
function phaseOf(block: Block): Phase {
  if (block.section === 'warmup') return 0
  // Balance practice is done fresh, with the holds, wherever its part listed it.
  if (block.section === 'main' || block.role === 'balance') return 1
  if (block.section === 'strength') return 2
  if (block.section === 'core') return 3
  return 4
}

/**
 * A part's block as its role wants it. Every key hold starts at the dose a
 * short session keeps; the lead's reach toward its full practice time
 * (`Block.reach`) is added back last, if the session has room — the same order
 * a time budget gives it up in on a single-skill day.
 */
function shapeForRole(block: Block, role: LineupRole): Block {
  if (block.role !== 'skill') return block
  const perSide = EXERCISE_BY_ID[block.exerciseId]?.perSide ? 2 : 1
  const { reach: _reach, ...rest } = block
  const kept = Math.max(2 * perSide, block.sets - (block.reach ?? 0))
  if (role === 'lead' || role === 'partner') return { ...rest, sets: kept }
  if (role === 'practice') return { ...rest, sets: Math.min(kept, 3 * perSide) }
  return {
    ...rest,
    sets: 2 * perSide,
    note: 'Maintenance dose: a couple of clean holds at your current step keep the position while another skill leads. Come down at the target call.',
  }
}

interface Candidate {
  block: Block
  skill: SkillId
  role: LineupRole
  tier: Tier
  /** Position in its own part, so a part's internal order survives. */
  index: number
}

/**
 * Assemble a mixed session.
 *
 * `build` makes one skill's session from its view and plan at a time budget —
 * `todaysSession`, handed in so this module does not import its own caller.
 */
export function mixedSession(
  state: AppState,
  lineup: LineupEntry[],
  plans: Partial<Record<SkillId, CoachPlan>>,
  build: (view: AppState, plan: CoachPlan, minutes: number) => Workout,
  minutesOverride?: number,
): Workout {
  const lead = lineup.find((entry) => entry.role === 'lead') ?? lineup[0]
  const leadPlan = plans[lead.skill]!
  const light = leadPlan.dayType === 'technique' || leadPlan.dayType === 'deload'
  const baseBudget = light ? Math.min(30, state.settings.sessionMinutes) : state.settings.sessionMinutes
  const budget = minutesOverride !== undefined ? Math.min(baseBudget, Math.max(8, minutesOverride)) : baseBudget

  // ——— One maximal effort a session ———
  // The lead's by default. But a skill that never leads still has to be
  // measured: its targets are only ever raised by a max effort, and when every
  // one of them waited on the lead, a second skill's re-test could be due for
  // months — simulated, its working hold fell from 15s to 1s and stayed there.
  // So the effort alternates: when the lead held it last session and another
  // skill has one queued, that skill takes today's — the partner first.
  const wantsEffort = (entry: LineupEntry) => {
    const plan = plans[entry.skill]!
    return (plan.queueUnlockAttempt || plan.queueRetest) && plan.challengeAllowed
  }
  const leadAttempts = wantsEffort(lead)
  const roleOrder: LineupRole[] = ['partner', 'practice', 'maintenance']
  const waiting = lineup
    .filter((entry) => entry !== lead && wantsEffort(entry))
    .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role))
  const lastSession = [...state.sessions].sort((a, b) => b.startedAt - a.startedAt)[0]
  const leadStepId = stepOfSkill(state, lead.skill)
  const leadHadLast = Boolean(
    lastSession?.sets.some((set) => set.exerciseId === STEP_BY_ID[leadStepId].keyExerciseId && isBarAttempt(set, leadStepId)),
  )
  const effortSkill: SkillId | undefined =
    leadAttempts && !(waiting.length && leadHadLast) ? lead.skill : (waiting[0]?.skill ?? (leadAttempts ? lead.skill : undefined))
  const planFor = (entry: LineupEntry): CoachPlan => {
    const plan = plans[entry.skill]!
    const holdsEffort = entry.skill === effortSkill
    const effort = holdsEffort ? {} : { queueUnlockAttempt: false, queueRetest: false }
    if (entry === lead) return { ...plan, ...effort }
    // The lead's warm-up carries the general preparation; the others add only
    // what their own skill needs — in full on the day they hold a max effort.
    const warmup = plan.warmup === 'extended' || holdsEffort ? 'standard' : 'short'
    return { ...plan, warmup, ...effort }
  }

  // Practice first after the warm-up, then the lead, its partner, maintenance.
  const order: LineupRole[] = ['practice', 'lead', 'partner', 'maintenance']
  const running = [...lineup].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))
  const built = new Map<SkillId, Workout>()
  const candidates: Candidate[] = []
  for (const entry of running) {
    const workout = build(skillView(state, entry.skill), planFor(entry), UNTRIMMED_MIN)
    built.set(entry.skill, workout)
    workout.blocks.forEach((raw, index) => {
      const tier = tierOf(raw, entry.role)
      if (!tier) return
      const block = { ...shapeForRole(raw, entry.role), skill: raw.skill ?? entry.skill }
      candidates.push({ block, skill: entry.skill, role: entry.role, tier, index })
    })
  }

  // ——— Assemble: everything that always runs, then fill by priority ———
  const estimate = (blocks: Block[]) => estimateMinutes(blocks, state.settings.stopLatencySec, state.settings.phoneWithinReach)
  const runningOrder = (chosen: Candidate[]): Block[] => {
    const out: Block[] = []
    const merged = new Map<string, Block>()
    const once = (block: Block) => {
      const twin = merged.get(block.exerciseId)
      if (twin) {
        // The same preparation, core or stretch asked for by two skills is done once.
        twin.sets = Math.max(twin.sets, block.sets)
        return
      }
      const copy = { ...block }
      // Shared work belongs to the session, not to one skill.
      if (!EXERCISE_BY_ID[block.exerciseId]?.skill) delete copy.skill
      merged.set(block.exerciseId, copy)
      out.push(copy)
    }
    const ofPhase = (phase: Phase) => chosen.filter((c) => phaseOf(c.block) === phase)
    const bySkillOrder = (a: Candidate, b: Candidate) =>
      running.findIndex((e) => e.skill === a.skill) - running.findIndex((e) => e.skill === b.skill) || a.index - b.index
    // Preparation and stretches lead with the lead skill's, which carry the
    // general work; the others add what their own skill needs.
    const leadFirst = (a: Candidate, b: Candidate) =>
      Number(b.skill === lead.skill) - Number(a.skill === lead.skill) || bySkillOrder(a, b)

    for (const c of ofPhase(0).sort(leadFirst)) once(c.block)
    merged.clear()
    for (const c of ofPhase(1).sort(bySkillOrder)) out.push({ ...c.block })
    // Strength: alternate between the parts, so a push is followed by a pull.
    const queues = running.map((entry) =>
      ofPhase(2)
        .filter((c) => c.skill === entry.skill)
        .sort((a, b) => a.index - b.index),
    )
    for (let i = 0; queues.some((q) => i < q.length); i++) {
      for (const q of queues) if (i < q.length) out.push({ ...q[i].block })
    }
    for (const c of ofPhase(3).sort(leadFirst)) once(c.block)
    merged.clear()
    for (const c of ofPhase(4).sort(leadFirst)) once(c.block)
    return out
  }

  // The standard cooldown of every part would be a long list of stretches:
  // the lead keeps its own, each other skill adds one.
  const cooldownCount = new Map<SkillId, number>()
  const chosen: Candidate[] = candidates.filter((c) => {
    if (c.tier !== 'always') return false
    if (c.block.section !== 'cooldown' || c.skill === lead.skill) return true
    const n = cooldownCount.get(c.skill) ?? 0
    cooldownCount.set(c.skill, n + 1)
    return n < COOLDOWN_PER_OTHER
  })
  const leftOut: Candidate[] = []
  for (const slot of FILL_ORDER) {
    const role: LineupRole = slot.who
    for (const candidate of candidates.filter((c) => c.tier === slot.tier && c.role === role)) {
      // Whole, or — for work that scales by sets — at two sets, or not at all.
      const perSide = EXERCISE_BY_ID[candidate.block.exerciseId]?.perSide ? 2 : 1
      const options: Block[] = [candidate.block]
      if (candidate.block.sets > 2 * perSide) options.push({ ...candidate.block, sets: 2 * perSide })
      const fitting = options.find((block) => estimate(runningOrder([...chosen, { ...candidate, block }])) <= budget)
      if (fitting) chosen.push({ ...candidate, block: fitting })
      else leftOut.push(candidate)
    }
  }

  // Last, the lead's reach toward its full practice time: one set at a time
  // while the session still has room.
  const leadBuilt = built.get(lead.skill)?.blocks.find((b) => b.role === 'skill')
  const leadHold = chosen.find((c) => c.skill === lead.skill && c.block.role === 'skill')
  if (leadBuilt && leadHold) {
    const step = EXERCISE_BY_ID[leadBuilt.exerciseId]?.perSide ? 2 : 1
    for (let sets = leadHold.block.sets + step; sets <= leadBuilt.sets; sets += step) {
      const trial = { ...leadHold, block: { ...leadHold.block, sets } }
      if (estimate(runningOrder(chosen.map((c) => (c === leadHold ? trial : c)))) > budget) break
      leadHold.block = trial.block
    }
  }

  // The holds alone can run over a short budget; the usual trimmer then takes
  // sets off them, floors first.
  const fit = fitToBudget(runningOrder(chosen), budget, false, state.settings.stopLatencySec, state.settings.phoneWithinReach)
  const blocks = fit.blocks
  const minutes = estimate(blocks)

  // ——— What the session says about itself ———
  const present = new Set(blocks.map((b) => b.exerciseId))
  const adjustments: string[] = []
  for (const entry of running) {
    for (const note of built.get(entry.skill)?.adjustments ?? []) {
      // A note about work this session does not contain describes another day.
      const mentioned = [...present].some((id) => {
        const name = EXERCISE_BY_ID[id]?.name
        return name ? note.toLowerCase().includes(name.toLowerCase()) : false
      })
      if ((mentioned || note.startsWith('Easy day')) && !adjustments.includes(note)) adjustments.push(note)
    }
  }
  for (const entry of running) {
    if (entry.role !== 'lead' && entry.role !== 'partner') continue
    const names = [
      ...new Set(
        [...leftOut.filter((c) => c.skill === entry.skill).map((c) => c.block.exerciseId), ...fit.dropped]
          .filter((id) => !present.has(id) && (EXERCISE_BY_ID[id]?.skill ?? entry.skill) === entry.skill)
          .map((id) => EXERCISE_BY_ID[id]?.name.toLowerCase())
          .filter((name): name is string => Boolean(name)),
      ),
    ]
    if (names.length) {
      const skillName = SKILLS[entry.skill].name.toLowerCase()
      adjustments.push(
        `Left out of the ${skillName} work to fit ${budget} minutes across today's skills: ${joinWords(names)}. ${
          names.length === 1 ? 'It comes' : 'They come'
        } back on a day ${skillName} trains alone, or with a longer session.`,
      )
    }
  }

  const skills = [lead.skill, ...lineup.filter((entry) => entry !== lead).map((entry) => entry.skill)]
  const skillMeta: Partial<Record<SkillId, WorkoutSkillMeta>> = {}
  let plancheStrategy: Workout['strategy']
  let plancheBase: number | undefined
  for (const entry of lineup) {
    const workout = built.get(entry.skill)!
    // A maintenance or practice dose was not shaped by a strategy worth
    // crediting: its holds are kept, not trialled.
    const shaped = entry.role === 'lead' || entry.role === 'partner'
    const retest = blocks.some((b) => b.retest && b.skill === entry.skill)
    // The base target is kept for every part, whatever its role: it is what
    // stops a completed prescription from lowering the next one. Without it a
    // maintenance dose — two sets, done exactly as asked — came back 40%
    // shorter each session.
    if (entry.skill === 'planche') {
      if (shaped) plancheStrategy = workout.strategy
      plancheBase = workout.baseTargetSec
      continue
    }
    skillMeta[entry.skill] = {
      ...(shaped && workout.strategy ? { strategy: workout.strategy } : {}),
      ...(workout.baseTargetSec !== undefined ? { baseTargetSec: workout.baseTargetSec } : {}),
      ...(retest ? { retest: true } : {}),
    }
  }

  const leadStep = STEP_BY_ID[stepOfSkill(state, lead.skill)]
  const leadKey = EXERCISE_BY_ID[leadStep.keyExerciseId]?.name.toLowerCase() ?? leadStep.name.toLowerCase()
  const describe = (entry: LineupEntry) => {
    const name = SKILLS[entry.skill].holdName
    return entry.role === 'partner'
      ? `${name} as its partner`
      : entry.role === 'maintenance'
        ? `a maintenance dose of ${name}`
        : `${name} balance practice`
  }
  const others = running.filter((entry) => entry !== lead)
  return {
    id: `auto-mix-${skills.join('+')}-${leadPlan.dayType}-${leadPlan.strategy}`,
    name: skills.map((skill) => SKILLS[skill].name).join(' + '),
    focus: `${leadPlan.dayReason} Which skills share a session, and in what order, follows common coaching practice — no trial has tested it for these skills.`,
    minutes,
    kind: 'auto',
    blocks,
    skills,
    lineup: lineup.map(({ skill, role, reason }) => ({ skill, role, reason })),
    ...(Object.keys(skillMeta).length ? { skillMeta } : {}),
    ...(plancheStrategy ? { strategy: plancheStrategy } : {}),
    ...(plancheBase !== undefined ? { baseTargetSec: plancheBase } : {}),
    ...(leadPlan.dayType === 'deload' ? { plannedDeload: true } : {}),
    purpose: `Lead with ${leadKey} at ${light ? 'an easy dose' : 'a working dose'}, with ${joinWords(others.map(describe))}.`,
    ...(adjustments.length ? { adjustments } : {}),
  }
}
