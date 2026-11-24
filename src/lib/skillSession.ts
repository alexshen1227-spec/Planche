import { SKILL_IDS, type Block, type Session, type SetLog, type SkillRemainder, type Workout } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { MUSCLE_BY_ID, type Joint, type Muscle } from '../data/gym/catalog'
import type { GymFocus } from './gym/builder'
import type { GymPreset } from './plan/screens'
import { dayKey } from './time'

const isWorking = (section: Block['section']) => section !== 'warmup' && section !== 'cooldown'

export function skillPlanVersion(session: Session): number {
  return Math.max(session.endedAt, session.prescriptionUpdatedAt ?? 0)
}

/** Record a decision about a saved workout without manufacturing a set or any training time. */
export function reviseSkillRemainder(session: Session, remaining: SkillRemainder | undefined, skipped: number, at: number): Session {
  if (!session.remaining) return session
  const count = session.remaining.blocks.reduce((n, b) => n + b.sets, 0)
  const version = Math.max(at, skillPlanVersion(session) + 1)
  const { remaining: _old, ...original } = session
  return { ...original, completion: 'partial', ...(remaining ? { remaining } : {}),
    skippedRounds: (session.skippedRounds ?? 0) + Math.min(count, Math.max(0, skipped)),
    prescriptionUpdatedAt: version, updatedAt: Math.max(version, session.updatedAt ?? 0) }
}

/** Apply reviews to the latest prescription. A later camera edit on an old
 * copy must not reopen rounds or erase work logged since that copy was made. */
export function mergeSkillSession(a: Session, b: Session): Session {
  if (a === b) return a
  const lastEdit = (s: Session) => Math.max(s.updatedAt ?? 0, s.savedAt ?? 0, skillPlanVersion(s))
  const delta = skillPlanVersion(b) - skillPlanVersion(a)
  const base = (delta || lastEdit(b) - lastEdit(a)) > 0 ? b : a
  const other = base === a ? b : a
  if (!other.updatedAt) return base
  // Earlier backups kept one edit time for the whole session. Only a recorded
  // form, clip, or explicit retime can supply a missing legacy field clock.
  const legacy = (s: Session) => !s.prescriptionUpdatedAt && (s.updatedAt ?? 0) > (s.savedAt ?? s.endedAt) &&
    !s.sets.some((x) => x.timingEditedAt || x.formEditedAt || x.clipEditedAt) ? s.updatedAt! : 0
  const otherLegacy = legacy(other), baseLegacy = legacy(base)
  if (!otherLegacy && !other.sets.some((s) => s.formEditedAt || s.timingEditedAt || s.clipEditedAt)) return base
  const byTime = new Map(other.sets.map((s) => [s.at, s]))
  let changed = false
  const sets = base.sets.map((s) => {
    const peer = byTime.get(s.at)
    if (!peer || peer.exerciseId !== s.exerciseId || peer.kind !== s.kind) return s
    let out = s
    const wins = (incoming: number, current: number, value: unknown, before: unknown) =>
      incoming > current || (incoming > 0 && incoming === current && JSON.stringify(value) > JSON.stringify(before))
    const ft = peer.formEditedAt ?? (peer.form ? otherLegacy : 0)
    if (peer.form && wins(ft, s.formEditedAt ?? (s.form ? baseLegacy : 0), peer.form, s.form)) out = { ...out, form: peer.form, formEditedAt: ft }
    const ct = peer.clipEditedAt ?? (peer.clipKey ? otherLegacy : 0)
    if (peer.clipKey && wins(ct, s.clipEditedAt ?? (s.clipKey ? baseLegacy : 0), peer.clipKey, s.clipKey)) out = { ...out, clipKey: peer.clipKey, clipEditedAt: ct }
    const retimed = (set: SetLog) => set.timing?.method === 'edited' || set.timing?.method === 'video'
    const tt = peer.timingEditedAt ?? (retimed(peer) ? otherLegacy : 0)
    if (peer.timing && wins(tt, s.timingEditedAt ?? (retimed(s) ? baseLegacy : 0), [peer.value, peer.timing], [s.value, s.timing]))
      out = { ...out, timing: peer.timing, value: peer.value, timingEditedAt: tt }
    if (out !== s) changed = true
    return out
  })
  return changed ? { ...base, sets, updatedAt: Math.max(lastEdit(a), lastEdit(b)) } : base
}

/** A legacy attendance-only record can have no set detail. A modern partial says exactly what was done. */
export function countsSkillDay(session: Session): boolean {
  if (session.workoutKind === 'micro') return false
  if (!session.sets?.length) return session.completion === undefined
  return session.sets.some((set) => isWorking(set.section) && set.value > 0)
}

export function latestSkillPartial(sessions: Session[], now = Date.now()): Session | undefined {
  let latest: Session | undefined
  for (const session of sessions) {
    if (session.workoutKind === 'micro' || session.startedAt > now ||
        (dayKey(session.startedAt) !== dayKey(now) && (!session.endedAt || session.endedAt > now || dayKey(session.endedAt) !== dayKey(now)))) continue
    if (!latest || session.startedAt > latest.startedAt) latest = session
  }
  return latest?.completion === 'partial' && latest.remaining ? latest : undefined
}

/** Map work to its block (the same hold can occur twice), including drafts made before the player kept block timestamps. */
export function remainingSkillWork(workout: Workout, logs: SetLog[], byBlock: Record<number, number[]>,
  skippedByBlock: Record<number, number> = {}, startingSide: 'left' | 'right' = 'left'): SkillRemainder | undefined {
  const assigned = new Set(Object.values(byBlock).flat())
  const unassigned = logs.filter((set) => !assigned.has(set.at))
  const byTime = new Map(logs.map((set) => [set.at, set]))
  const blocks: Block[] = []
  workout.blocks.forEach((block, i) => {
    const done = (byBlock[i] ?? []).map((at) => byTime.get(at)).filter((set): set is SetLog => Boolean(set))
    for (let n = 0; n < unassigned.length && done.length < block.sets;) {
      const set = unassigned[n]
      if (set.exerciseId === block.exerciseId && set.section === block.section) done.push(...unassigned.splice(n, 1))
      else n++
    }
    const skipped = skippedByBlock[i] ?? 0
    const sets = block.sets - done.length - skipped
    if (sets < 1) return
    if (EXERCISE_BY_ID[block.exerciseId]?.perSide) {
      const first = block.firstSide ?? done.find((s) => s.side)?.side ?? startingSide
      const firstSide = (done.length + skipped) % 2 === 0 ? first : first === 'left' ? 'right' : 'left'
      blocks.push({ ...block, sets, firstSide })
    } else blocks.push({ ...block, sets })
  })
  blocks.push(...(workout.deferredBlocks ?? []))
  if (!blocks.some((block) => isWorking(block.section))) return undefined
  const req = workout.request
  const recovery = workout.id.startsWith('pain-safe-recovery')
  return { blocks, ...(workout.skills?.length ? { skills: workout.skills } : {}), ...(workout.lineup?.length ? { lineup: workout.lineup } : {}),
    ...(recovery ? { recovery: true } : {}), ...(req?.placeId ? { placeId: req.placeId } : {}), ...(req?.gymAfter && !recovery ? { gymAfter: req.gymAfter } : {}),
    ...(req?.focus ? { focus: req.focus } : {}) }
}

/** Keep the original denominator even after an athlete skips a block or
 * continues a partial. Max attempts and diagnostic retests are separate. */
export function plannedMainRounds(blocks: Block[]): Record<string, number> {
  const rounds: Record<string, number> = {}
  for (const b of blocks) {
    if (b.section !== 'main' || b.retest || b.role === 'attempt' || b.role === 'assisted') continue
    rounds[b.exerciseId] = (rounds[b.exerciseId] ?? 0) + b.sets
  }
  return rounds
}

const sections = new Set<Block['section']>(['warmup', 'main', 'strength', 'core', 'cooldown'])
const roles = new Set<Block['role']>(['attempt', 'bridge', 'skill', 'backoff', 'assisted', 'balance', 'press', 'pressing', 'straight-arm', 'core', 'mobility'])
const gymFocus: GymFocus[] = ['full', 'upper', 'lower', 'push', 'pull', 'athletic']
const joints: Joint[] = ['wrists', 'elbows', 'shoulders', 'lower-back', 'knees', 'hips', 'ankles']
const inRange = (n: unknown, low: number, high: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high
const muscles = (raw: unknown): Muscle[] => Array.isArray(raw) ? raw.filter((m): m is Muscle => typeof m === 'string' && Object.hasOwn(MUSCLE_BY_ID, m)) : []

function readLifts(raw: unknown): GymPreset | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const g = raw as Partial<GymPreset>
  if (!g.focus || !gymFocus.includes(g.focus) || !inRange(g.minutes, 1, 240)) return undefined
  return { focus: g.focus, minutes: g.minutes, volumeFactor: inRange(g.volumeFactor, 0, 2) ? g.volumeFactor : 1,
    avoidJoints: joints.filter((j) => Array.isArray(g.avoidJoints) && g.avoidJoints.includes(j)), musclesOff: muscles(g.musclesOff),
    ...(inRange(g.warmUpMin, 0, 30) ? { warmUpMin: g.warmUpMin } : {}), ...(g.priority ? { priority: muscles(g.priority) } : {}),
    ...(g.spare ? { spare: muscles(g.spare) } : {}), ...(typeof g.placeId === 'string' ? { placeId: g.placeId } : {}) }
}

/** Old backups may predate continuation. An unreadable prescription leaves the logged work intact. */
export function readSkillRemainder(raw: unknown): SkillRemainder | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Partial<SkillRemainder>
  if (!Array.isArray(r.blocks) || r.blocks.length > 100) return undefined
  const blocks: Block[] = []
  for (const b of r.blocks) {
    if (!b || !Object.hasOwn(EXERCISE_BY_ID, b.exerciseId) || !sections.has(b.section) || !Number.isInteger(b.sets) || !inRange(b.sets, 1, 100) || !inRange(b.restSec, 0, 1200)) return undefined
    const target = b.target
    if (!target || !(target.kind === 'hold' && inRange(target.sec, 1, 3600) || target.kind === 'reps' && inRange(target.reps, 1, 1000))) return undefined
    blocks.push({ exerciseId: b.exerciseId, section: b.section, sets: b.sets, restSec: b.restSec, target,
      ...(b.skill && SKILL_IDS.includes(b.skill) ? { skill: b.skill } : {}), ...(b.role && roles.has(b.role) ? { role: b.role } : {}),
      ...(b.firstSide === 'left' || b.firstSide === 'right' ? { firstSide: b.firstSide } : {}),
      ...(typeof b.note === 'string' ? { note: b.note.slice(0, 2000) } : {}),
      ...(b.light === true ? { light: true } : {}), ...(b.retest === true ? { retest: true } : {}) })
  }
  if (!blocks.some((b) => isWorking(b.section))) return undefined
  const skills = Array.isArray(r.skills) ? [...new Set(r.skills.filter((s) => SKILL_IDS.includes(s)))] : []
  const lineup = Array.isArray(r.lineup) ? r.lineup.filter((item) => item && SKILL_IDS.includes(item.skill) && ['lead', 'partner', 'maintenance', 'practice'].includes(item.role) && typeof item.reason === 'string').slice(0, SKILL_IDS.length) : []
  const gymAfter = readLifts(r.gymAfter)
  return { blocks, ...(skills.length ? { skills } : {}), ...(lineup.length ? { lineup } : {}),
    ...(r.recovery === true ? { recovery: true } : gymAfter ? { gymAfter } : {}),
    ...(typeof r.placeId === 'string' ? { placeId: r.placeId } : {}), ...(r.focus === 'ladder' ? { focus: r.focus } : {}) }
}

/** Keep corrections and clips on the old sets. Time away from the workout stays out of active duration. */
export function continueSkillSession(previous: Session, part: Session): Session {
  const known = new Set(previous.sets.map((set) => set.at))
  const added = part.sets.filter((set) => !known.has(set.at))
  if (!added.length) return previous
  const rank = { practice: 0, maintenance: 1, partner: 2, lead: 3 }
  const roles = { ...previous.roles }
  for (const skill of SKILL_IDS) {
    const role = part.roles?.[skill]
    if (role && (!roles[skill] || rank[role] > rank[roles[skill]!])) roles[skill] = role
  }
  const { remaining: _remaining, ...original } = previous
  const skipped = (previous.skippedRounds ?? 0) + (part.skippedRounds ?? 0)
  const endedAt = Math.max(previous.endedAt + 1, part.endedAt)
  return { ...original, sets: [...previous.sets, ...added], endedAt, prescriptionUpdatedAt: Math.max(endedAt, skillPlanVersion(previous) + 1),
    pausedMs: (previous.pausedMs ?? 0) + Math.max(0, part.startedAt - previous.endedAt) + (part.pausedMs ?? 0),
    savedAt: part.savedAt, updatedAt: Math.max(part.savedAt ?? part.endedAt, (previous.updatedAt ?? 0) + 1),
    completion: skipped ? 'partial' : part.completion, ...(skipped ? { skippedRounds: skipped } : {}), ...(part.remaining ? { remaining: part.remaining } : {}),
    ...(Object.keys(roles).length ? { roles } : {}), ...(part.rpe !== undefined ? { rpe: part.rpe } : {}),
    ...(part.checkIn ? { checkIn: part.checkIn } : {}),
    ...(part.notes && part.notes !== previous.notes ? { notes: [previous.notes, part.notes].filter(Boolean).join('\n') } : {}) }
}
