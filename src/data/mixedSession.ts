import type { AppState, Block, SkillId, Workout, WorkoutSkillMeta } from '../types'
import { EXERCISE_BY_ID } from './exercises'
import { STEP_BY_ID } from './progressions'
import { SKILLS } from './skills'
import type { CoachPlan } from '../lib/coach'
import type { LineupEntry, LineupRole } from '../lib/lineup'
import { isBarAttempt } from '../lib/progression'
import { focusSkill, skillView, stepOfSkill } from '../lib/skills'
import { estimateMinutes, fitToBudget, joinWords, LIGHT_DOSE_SHARE } from './workouts'

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
 * **What goes in is decided by priority, not by trimming.** Every part's key
 * hold is in, at a floor: that is what "training the skill today" means. After
 * that the time left is filled in a fixed order (`FILL`): the moving version of
 * each full part's step, the lead's next-shape attempts, more sets of the
 * holds, one shared core block, each skill's support work, then second
 * strength movements and back-off work. Whatever does not fit is left out and
 * named. A lead that is the athlete's first priority takes its full key-hold
 * dose, then the core block, before the partner's extra holds: a second skill
 * is not allowed to cost the first its practice time.
 *
 * Two earlier versions got this wrong in opposite ways. The first let each part
 * trim itself to a share of the time, and every part gave up its core first —
 * a mixed session had none at all. The second put every hold of every full
 * part in before anything else: a second skill's five or ten holds then took
 * the room its strength movement needed, and over a simulated season the front
 * lever as second skill got a pulling movement in four sessions of thirteen,
 * the flag in none of seven. A full part is its hold *and* the strength work
 * behind it, so both parts get the second before either gets more of the first.
 *
 * What a part keeps also depends on its role. A short dose — maintenance — is
 * the key hold at the current step, two sets, nothing else: the progression,
 * not the volume, is what it holds on to. Balance practice keeps its holds, and
 * its balance drill when there is room.
 *
 * One maximal effort a session: if the lead has an unlock attempt or a re-test
 * queued, the other skills' attempts wait for another day.
 */

/** Never trimmed against the clock: built with room for everything, then chosen from. */
const UNTRIMMED_MIN = 240

/** What a part's blocks are for, in the order the mixed session wants them. */
type Tier =
  | 'always' // warm-up, each part's key hold at its floor, the session's max effort, cooldown
  | 'twin' // the moving version of the step
  | 'nextshape' // attempts at the next step's hold (the bridge)
  | 'drill' // a balance skill's balance drill
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
    // Next-shape practice belongs to a full part, and waits its turn for room.
    if (block.role === 'bridge') return role === 'lead' || role === 'partner' ? 'nextshape' : null
    if (role === 'lead' || role === 'partner') return 'always'
    // A short dose is its key hold — and its max effort, on the day it holds
    // the session's one.
    return block.role === 'skill' || block.role === 'attempt' ? 'always' : null
  }
  if (block.role === 'balance') return role === 'maintenance' ? null : 'drill'
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

/**
 * How the time after the floors is spent, most worth having first.
 *
 * `add` brings a block in — at two sets, or whole where that fits. `raise`
 * gives an already-chosen block one more set at a time, toward the number its
 * own session built it with (`full`) or its role's cap for a key hold (`cap`).
 * The lead comes first at every level; the point of the order is that the
 * second skill's strength movement comes before anybody's extra holds.
 */
type Who = 'lead' | 'partner' | 'practice'
type FillStep =
  | {
      op: 'add'
      tier: Tier
      who: Who
      start: 'two' | 'whole'
      /** Only when the lead is the athlete's first priority. */
      firstPriority?: true
    }
  | {
      op: 'raise'
      what: 'hold' | Tier
      who: Who
      to: 'cap' | 'full'
      /** Only when the lead is the athlete's first priority. */
      firstPriority?: true
    }

const FILL: FillStep[] = [
  // A full part is the hold and the strength work behind it.
  { op: 'add', tier: 'twin', who: 'lead', start: 'two' },
  { op: 'add', tier: 'drill', who: 'lead', start: 'two' },
  { op: 'add', tier: 'nextshape', who: 'lead', start: 'two' },
  { op: 'add', tier: 'twin', who: 'partner', start: 'two' },
  { op: 'add', tier: 'drill', who: 'partner', start: 'two' },
  // Next-shape attempts are how a step opens early. Left behind the extra
  // holds, a second skill never got them and sat on its first step all season.
  { op: 'add', tier: 'nextshape', who: 'partner', start: 'two' },
  // Then more of the holds, the lead's first. A lead that is the athlete's
  // first priority goes all the way to its full practice time (`Block.reach`)
  // before the partner's extras: left last, it lost two of its six
  // advanced-tuck sets to a partner in 45 minutes (measured: 6 alone, 4
  // beside the front lever; 5 against 3 on an intensity day), so training a
  // second skill cost the first priority a third of its dose. The partner
  // keeps what the order above protects: its key hold at its floor, its
  // moving version and its next-shape attempts. The session's one core block
  // comes straight after the reach, still ahead of the partner's extra holds:
  // left where it was, behind them, it fell out of four mixed sessions in
  // five once the reach went in first (measured on the review's athlete at 45
  // minutes: in 57% of sessions before, 21% after, 61% here).
  { op: 'raise', what: 'hold', who: 'lead', to: 'cap' },
  { op: 'raise', what: 'hold', who: 'lead', to: 'full', firstPriority: true },
  { op: 'add', tier: 'core', who: 'lead', start: 'whole', firstPriority: true },
  { op: 'raise', what: 'hold', who: 'partner', to: 'cap' },
  { op: 'add', tier: 'core', who: 'lead', start: 'whole' },
  { op: 'raise', what: 'twin', who: 'lead', to: 'full' },
  { op: 'raise', what: 'twin', who: 'partner', to: 'full' },
  { op: 'raise', what: 'nextshape', who: 'lead', to: 'full' },
  { op: 'raise', what: 'drill', who: 'lead', to: 'full' },
  { op: 'raise', what: 'drill', who: 'partner', to: 'full' },
  // Then everything a longer session has room for.
  { op: 'add', tier: 'limiter', who: 'lead', start: 'whole' },
  { op: 'add', tier: 'support', who: 'lead', start: 'whole' },
  { op: 'add', tier: 'drill', who: 'practice', start: 'whole' },
  { op: 'raise', what: 'hold', who: 'practice', to: 'cap' },
  { op: 'add', tier: 'limiter', who: 'partner', start: 'whole' },
  { op: 'add', tier: 'support', who: 'partner', start: 'whole' },
  { op: 'add', tier: 'bridge', who: 'lead', start: 'whole' },
  { op: 'add', tier: 'strength', who: 'lead', start: 'whole' },
  { op: 'add', tier: 'core', who: 'partner', start: 'whole' },
  { op: 'raise', what: 'nextshape', who: 'partner', to: 'full' },
  { op: 'add', tier: 'bridge', who: 'partner', start: 'whole' },
  { op: 'add', tier: 'strength', who: 'partner', start: 'whole' },
  { op: 'add', tier: 'extra', who: 'lead', start: 'whole' },
  { op: 'add', tier: 'extra', who: 'partner', start: 'whole' },
  // Last, any other lead's reach toward its full practice time.
  { op: 'raise', what: 'hold', who: 'lead', to: 'full' },
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

/** A unilateral hold's sets are stored doubled, a side each. */
const sidesOf = (block: Block) => (EXERCISE_BY_ID[block.exerciseId]?.perSide ? 2 : 1)

/**
 * A part's key hold as its role wants it: the sets it always gets (`floor`),
 * and the most the session will raise it to when there is room (`cap`).
 *
 * The lead's cap is the dose a short single-skill session keeps; its reach
 * toward its full practice time (`Block.reach`) is added back straight after,
 * before the partner's extras, so a second skill does not cost the first its
 * dose. A partner's cap is four sets: past that, more of the same hold is worth
 * less to it than the strength movement the time would otherwise go to.
 */
function shapeForRole(block: Block, role: LineupRole): { block: Block; cap: number } {
  if (block.role !== 'skill') return { block, cap: block.sets }
  const sides = sidesOf(block)
  const { reach: _reach, ...rest } = block
  const kept = Math.max(2 * sides, block.sets - (block.reach ?? 0))
  // Three sets for the lead, two a side for a unilateral hold; two for a partner.
  if (role === 'lead') return { block: { ...rest, sets: Math.min(kept, sides === 2 ? 4 : 3) }, cap: kept }
  if (role === 'partner') return { block: { ...rest, sets: Math.min(kept, 2 * sides) }, cap: Math.min(kept, 4) }
  if (role === 'practice') return { block: { ...rest, sets: Math.min(kept, 2 * sides) }, cap: Math.min(kept, 3 * sides) }
  return {
    block: {
      ...rest,
      sets: 2 * sides,
      note: 'Short dose: a couple of clean holds at your current step keep the position while other skills take the session. Come down at the target call.',
    },
    cap: 2 * sides,
  }
}

interface Candidate {
  block: Block
  skill: SkillId
  role: LineupRole
  tier: Tier
  /** Position in its own part, so a part's internal order survives. */
  index: number
  /** Sets its own session built it with. */
  full: number
  /** For a key hold: the most its role is raised to before the lead's reach. */
  cap: number
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
  /** Said by an earlier pass that had to leave a short dose out. */
  carried: string[] = [],
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
      const shaped = shapeForRole(raw, entry.role)
      const block = { ...shaped.block, skill: raw.skill ?? entry.skill }
      candidates.push({ block, skill: entry.skill, role: entry.role, tier, index, full: raw.sets, cap: shaped.cap })
    })
  }

  // ——— Assemble: everything that always runs, then fill by priority ———
  const estimate = (blocks: Block[]) => estimateMinutes(blocks, state.settings.stopLatencySec, state.settings.phoneWithinReach)
  const runningOrder = (chosen: Candidate[]): Block[] => {
    const out: Block[] = []
    const merged = new Map<string, Block>()
    const once = (block: Block, shared = true) => {
      const twin = merged.get(block.exerciseId)
      if (twin) {
        // The same preparation, core or stretch asked for by two skills is done once.
        twin.sets = Math.max(twin.sets, block.sets)
        return
      }
      const copy = { ...block }
      // Shared work belongs to the session, not to one skill — but a strength
      // movement stays its part's: a pull-up is the front lever's work today.
      if (shared && !EXERCISE_BY_ID[block.exerciseId]?.skill) delete copy.skill
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
    // A movement two parts both ask for is done once — pike push-ups for the
    // handstand and again, at another count, for the flag was two blocks of
    // the same thing with a note that matched neither.
    const queues = running.map((entry) =>
      ofPhase(2)
        .filter((c) => c.skill === entry.skill)
        .sort((a, b) => a.index - b.index),
    )
    for (let i = 0; queues.some((q) => i < q.length); i++) {
      for (const q of queues) if (i < q.length) once(q[i].block, false)
    }
    merged.clear()
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
  const fits = (trial: Candidate[]) => estimate(runningOrder(trial)) <= budget

  // The floors alone can overrun a short session. A short dose is then the
  // first thing to go — whole, and said — before either full part loses a set:
  // the line-up it came from only knew the minutes, not what the parts weigh.
  if (!fits(chosen)) {
    const spare =
      [...lineup].reverse().find((entry) => entry.role === 'maintenance' && entry.skill !== effortSkill) ??
      [...lineup].reverse().find((entry) => entry.role === 'practice' && entry.skill !== effortSkill)
    if (spare) {
      const others = lineup.filter((entry) => entry !== spare)
      const note = `${SKILLS[spare.skill].name} was due a short dose, but today's two full parts fill the ${budget} minutes — it is left for another session.`
      return mixedSession(state, others, plans, build, minutesOverride, [...carried, note])
    }
  }

  // Whose dose the order protects first: the athlete's first priority, when it leads.
  const leadIsFirst = lead.skill === focusSkill(state)
  for (const step of FILL) {
    if (step.firstPriority && !leadIsFirst) continue
    if (step.op === 'add') {
      for (const candidate of candidates.filter((c) => c.tier === step.tier && c.role === step.who)) {
        // A block an earlier step already brought in is not brought in twice.
        if (chosen.some((c) => c.skill === candidate.skill && c.index === candidate.index)) continue
        // Whole, or — for work that scales by sets — at two sets, or not at all.
        const two = Math.min(candidate.block.sets, 2 * sidesOf(candidate.block))
        const options = step.start === 'two' || two === candidate.block.sets ? [two] : [candidate.block.sets, two]
        const sets = options.find((n) => fits([...chosen, { ...candidate, block: { ...candidate.block, sets: n } }]))
        if (sets !== undefined) chosen.push({ ...candidate, block: { ...candidate.block, sets } })
        else leftOut.push(candidate)
      }
      continue
    }
    // One set at a time while the session still has room.
    const raised = chosen.filter(
      (c) => c.role === step.who && (step.what === 'hold' ? c.tier === 'always' && c.block.role === 'skill' : c.tier === step.what),
    )
    for (const candidate of raised) {
      const limit = step.to === 'cap' ? candidate.cap : candidate.full
      const by = sidesOf(candidate.block)
      while (candidate.block.sets + by <= limit) {
        const trial = { ...candidate, block: { ...candidate.block, sets: candidate.block.sets + by } }
        if (!fits(chosen.map((c) => (c === candidate ? trial : c)))) break
        candidate.block = trial.block
      }
    }
  }

  // The holds alone can run over a short budget; the usual trimmer then takes
  // sets off them, floors first.
  const fit = fitToBudget(runningOrder(chosen), budget, false, state.settings.stopLatencySec, state.settings.phoneWithinReach)
  const blocks = fit.blocks
  const minutes = estimate(blocks)

  // ——— What the session says about itself ———
  const present = new Set(blocks.map((b) => b.exerciseId))
  // Whose version of a movement the session shows: the first part to bring it,
  // in the running order. A note from another part's version — "Pike Push-Up
  // set to 7 reps" beside the block that says 3×5 — describes a block that is
  // not here.
  const shownFrom = new Map<string, SkillId>()
  for (const entry of [lead, ...running.filter((e) => e !== lead)]) {
    for (const c of chosen) {
      if (c.skill === entry.skill && present.has(c.block.exerciseId) && !shownFrom.has(c.block.exerciseId)) {
        shownFrom.set(c.block.exerciseId, c.skill)
      }
    }
  }
  const adjustments: string[] = [...carried]
  let easyDaySaid = false
  for (const entry of running) {
    for (const note of built.get(entry.skill)?.adjustments ?? []) {
      if (note.startsWith('Easy day')) {
        // Each part says it in its own words; once is enough for the session.
        if (!easyDaySaid) {
          adjustments.push(
            `Easy day: strength and support work at about ${Math.round(LIGHT_DOSE_SHARE * 100)}% of your usual dose — keep the pattern, leave the fatigue. These sets do not change your accessory targets.`,
          )
          easyDaySaid = true
        }
        continue
      }
      // A note about work this session does not contain describes another day.
      const mentioned = [...present].some((id) => {
        const name = EXERCISE_BY_ID[id]?.name
        return name && shownFrom.get(id) === entry.skill ? note.toLowerCase().includes(name.toLowerCase()) : false
      })
      if (mentioned && !adjustments.includes(note)) adjustments.push(note)
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
      // Only what is true: there is no day a second skill trains alone unless
      // the athlete picks one, and nothing here knows which session is next.
      adjustments.push(
        `Left out of the ${skillName} work to fit ${budget} minutes across today's skills: ${joinWords(names)}. ${
          names.length === 1 ? 'It fits' : 'They fit'
        } in a longer session (Settings → session length), or when you pick ${skillName} on its own under Train → Choose today’s skills.`,
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
        ? `a short dose of ${name}`
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
