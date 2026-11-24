import type { AppState, Block, BodyRegion, CheckIn, LineupRole, SetLog, SkillId, WorkoutRequest } from '../types'
import { skillOfStep } from '../data/progressions'
import { skillOfExercise, SKILLS } from '../data/skills'
import { fullParts, roomIn, shortDoses } from './sessionRoom'
import { readinessTimeline } from './signals'
import { activeSkills, focusSkill, missingSkillKit, wholeState } from './skills'
import { todaysDay, WEEKDAY_NAMES } from './weekPlan'

/**
 * Which skills today's session trains, and how much of each.
 *
 * Nothing peer-reviewed tests a multi-skill calisthenics programme (ledger
 * §13): every rule here — how many, which pairs, what order, how much — is
 * coaching convention or this app's own planning heuristic, and the screens
 * that show a line-up say so. What the coaches broadly agree on, and what this
 * encodes:
 *
 * - **The priority skill leads, every session.** It goes first among the
 *   strength work and gets the fullest dose. (For dynamic lifts "first gets the
 *   most" is well supported; for holds it is inference.) The one exception is
 *   a niggle named today: when the priority skill loads that area and another
 *   skill does not, the other leads — the rule that keeps a sore family out of
 *   a gym day's opener.
 * - **Push pairs with pull.** The second slot prefers a skill from a different
 *   family — the planche with the front lever is the textbook pair — and is
 *   marked down when it loads the same joints as the lead.
 * - **Everything else rotates, by priority.** The second full part goes to the
 *   skill that has waited longest for one, weighted by its place in the
 *   athlete's order: the second priority gets it about twice as often as the
 *   third. A couple of maintenance sets do not count as having been trained —
 *   they once did, and with four or five skills the lower ones were held at
 *   two sets a week for good, their targets and their steps never moving.
 * - **A short dose keeps a position between full parts** — two sets at the
 *   current step, or for a balance skill a few minutes of practice at the
 *   start of the session, while fresh. It goes by the same rule: longest
 *   waiting, weighted by the athlete's order. Balance practice once rode along
 *   in *every* session regardless — so an athlete who ranked the handstand
 *   last saw it in thirty sessions of thirty and their third priority in
 *   seven. The order is the athlete's; nothing here outranks it.
 *
 * How much fits is a function of the time available, nothing cleverer: one
 * skill under 25 minutes, two in full from there, plus one short dose from 30
 * minutes and two beyond 50.
 *
 * **The athlete's own week comes first.** A weekday they have assigned
 * (`lib/weekPlan.ts`) is trained as written — their first skill leads, a
 * second gets the other full part, a third a short dose — and only the time
 * available can leave one out. Everything above is what happens on a day they
 * left to the coach.
 */

/**
 * What a skill's share of a mixed session is for: `lead` is the priority
 * skill, first and fullest; `partner` the second strength skill, a full part
 * at a smaller share of the time; `maintenance` its key hold at the current
 * step, a couple of sets, nothing else; `practice` balance practice only, at
 * the start of the session.
 */
export type { LineupRole }

export interface LineupEntry {
  skill: SkillId
  role: LineupRole
  /** Why it is in today's session, in the athlete's words. */
  reason: string
}

const DAY = 86_400_000

/** A skill that has never been trained is treated as this many days overdue. */
const NEVER_TRAINED_DAYS = 30

/** Days since a skill was last trained (any work on its road past the warm-up); null when never. */
export function daysSinceSkill(stateIn: AppState, skill: SkillId, now = Date.now()): number | null {
  const state = wholeState(stateIn)
  let last: number | null = null
  for (const session of state.sessions) {
    if (session.startedAt > now) continue
    const trained = session.sets.some(
      (set) =>
        set.section !== 'warmup' && set.section !== 'cooldown' && set.value > 0 && skillOfExercise(set.exerciseId) === skill,
    )
    if (trained && (last === null || session.startedAt > last)) last = session.startedAt
  }
  if (last === null) return null
  const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((startOfDay(now) - startOfDay(last)) / DAY))
}

/**
 * Days since a skill last had a full part of a session — led it or partnered
 * it — rather than a maintenance dose or balance practice. Sessions from
 * before roles were kept count any work on the skill as a full part. Null
 * when it never has.
 */
export function daysSinceFullPart(stateIn: AppState, skill: SkillId, now = Date.now()): number | null {
  const state = wholeState(stateIn)
  let last: number | null = null
  for (const session of state.sessions) {
    if (session.startedAt > now) continue
    const role = session.roles?.[skill]
    const full = session.roles
      ? role === 'lead' || role === 'partner'
      : session.sets.some(
          (set) =>
            set.section !== 'warmup' && set.section !== 'cooldown' && set.value > 0 && skillOfExercise(set.exerciseId) === skill,
        )
    if (full && (last === null || session.startedAt > last)) last = session.startedAt
  }
  if (last === null) return null
  const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((startOfDay(now) - startOfDay(last)) / DAY))
}

/**
 * What each skill's part of a session turned out to be — from what was logged,
 * not from what was planned.
 *
 * The plan says who leads and who partners. Saved as planned, a session ended
 * after the first skill's holds still recorded its partner as trained in full,
 * so the skill that got nothing lost its turn as well; and a pain-safe session
 * went down as a full day for the lead. A skill with none of its holds done has
 * no part. A full part with fewer than half its planned holds done is a short
 * dose, which is what it was.
 */
export function rolesTrained(
  planned: readonly { skill: SkillId; role: LineupRole }[],
  blocks: readonly Pick<Block, 'exerciseId' | 'sets' | 'section' | 'skill'>[],
  logs: readonly Pick<SetLog, 'exerciseId' | 'section' | 'value'>[],
): Partial<Record<SkillId, LineupRole>> {
  const roles: Partial<Record<SkillId, LineupRole>> = {}
  for (const { skill, role } of planned) {
    const plannedHolds = blocks
      .filter((block) => block.section === 'main' && (block.skill ?? skillOfExercise(block.exerciseId)) === skill)
      .reduce((sum, block) => sum + block.sets, 0)
    const done = logs.filter((set) => set.section === 'main' && set.value > 0 && skillOfExercise(set.exerciseId) === skill).length
    if (done === 0) continue
    const full = role === 'lead' || role === 'partner'
    roles[skill] = full && done * 2 < plannedHolds ? (SKILLS[skill].family === 'balance' ? 'practice' : 'maintenance') : role
  }
  return roles
}

export { fullParts, roomIn, shortDoses }

/** Skills the athlete trains *and* has the kit for, focus first. */
export function trainableActiveSkills(stateIn: AppState): SkillId[] {
  const state = wholeState(stateIn)
  const active = activeSkills(state)
  const trainable = active.filter((skill) => missingSkillKit(state, skill).length === 0)
  // A focus skill the kit no longer supports is still the athlete's choice;
  // the session builder then says what is missing rather than training nothing.
  return trainable.length ? trainable : [active[0]]
}

function joinNames(skills: SkillId[]): string {
  const names = skills.map((skill) => SKILLS[skill].name.toLowerCase())
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const capitalised = (text: string) => `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`

/** What the standing niggle means for who leads: the regions, which skills load them, and when it was named. */
interface Sore {
  regions: BodyRegion[]
  /** The niggle was named today: the coach's niggle rails ease the session (an older one only asks at the check-in). */
  fresh: boolean
  loads: (skill: SkillId) => boolean
  /** "wrist", "wrist and shoulder". */
  words: string
  /** "today", "on Monday": when the athlete named it. */
  when: string
}

/**
 * The niggle the skill side still steers round: the latest joint report at or
 * before `now`, while it is a niggle — however old, until a later check-in or
 * report supersedes it. It is the memory the coach's open-concern rail and the
 * lifts read (`soreJoints`'s standing report), so the line-up, the coach and
 * the lifts agree on one report. A later "all good" ends it here; the lifts
 * keep their 72-hour union. Pain is not here: it takes loaded work off
 * altogether, so there is nothing left to steer. Neither is the elbow, which
 * does the same on its own. Read from today's report only, a Monday wrist
 * niggle with no check-in since left Wednesday's session led by the planche
 * with handstand push-ups beside it, the front lever — the one skill here
 * that spares the wrist — cut to a short dose, under a reason that said the
 * day steered round the wrist.
 */
export function standingNiggle(state: AppState, now = Date.now(), freshCheckIn?: CheckIn): { regions: BodyRegion[]; at?: number } {
  let latest: ReturnType<typeof readinessTimeline>[number] | undefined
  for (const answer of readinessTimeline(state, now, freshCheckIn)) if (answer.at <= now && (!latest || answer.at >= latest.at)) latest = answer
  if (!latest || latest.joints !== 'niggle') return { regions: [] }
  return { regions: (latest.regions ?? []).filter((region) => region !== 'other' && region !== 'elbow'), at: latest.at }
}

/** "eased like the rest of the session", only while the coach's niggle rails ease it: a niggle named today. */
const easedWords = (sore: Sore, lead = ', ') => (sore.fresh ? `${lead}eased like the rest of the session` : '')

function soreToday(state: AppState, now: number, freshCheckIn?: CheckIn): Sore {
  const { regions, at } = standingNiggle(state, now, freshCheckIn)
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0)
  const days = at === undefined ? 0 : Math.round((day(now) - day(at)) / 86_400_000)
  return {
    regions,
    loads: (skill) => regions.some((region) => SKILLS[skill].loads.includes(region)),
    words: regions.map((region) => region.replace('-', ' ')).join(' and '),
    fresh: at === undefined || days <= 0,
    when: at === undefined || days <= 0 ? 'today' : days < 7 ? `on ${WEEKDAY_NAMES[new Date(at).getDay() as keyof typeof WEEKDAY_NAMES]}` : 'in your last joint report',
  }
}

/**
 * The order with today's niggle taken into account: when the first skill loads
 * the area named today and another does not, the first of those that does not
 * goes first and the rest keep their order. When every skill loads it, nothing
 * moves — the first leads, under the coach's niggle rails. The same rule keeps
 * a sore family out of a gym day's opener.
 */
function niggleOrder(skills: SkillId[], sore: Sore): SkillId[] {
  if (!sore.regions.length || !skills.length || !sore.loads(skills[0])) return skills
  const clear = skills.find((skill) => !sore.loads(skill))
  return clear ? [clear, ...skills.filter((skill) => skill !== clear)] : skills
}

/** Why the first skill does not lead today, in the lead's reason. */
function movedLeadWords(first: SkillId, lead: SkillId, sore: Sore): string {
  return `the ${SKILLS[first].holdName} loads the ${sore.words} you flagged ${sore.when}, and the ${SKILLS[lead].holdName} leaves it alone`
}

/**
 * Today's line-up for a coach-built session, lead first.
 *
 * Depends only on the saved history, the athlete's priorities and kit, and the
 * time available — so the preview and the session started from it agree, and a
 * re-plan after a check-in keeps the same skills.
 */
export function todaysLineup(stateIn: AppState, now = Date.now(), minutesOverride?: number, freshCheckIn?: CheckIn): LineupEntry[] {
  const state = wholeState(stateIn)
  const skills = trainableActiveSkills(state)
  const lead = skills[0]
  // ——— A niggle named today ———
  // It moves the lead off a skill that loads the area, when another skill
  // leaves it alone, and sends the second part and the short doses round it.
  // The first priority once led a wrist-niggle day regardless — six sets of
  // advanced tuck instead of seven — while the same report kept the planche
  // out of a gym day's opener and the handstand out of the session.
  const sore = soreToday(state, now, freshCheckIn)
  if (skills.length === 1) {
    // The only skill there is — even when its kit is missing, in which case
    // the session says so and holds support work only.
    const waiting = missingSkillKit(state, lead).length > 0
    return [
      {
        skill: lead,
        role: 'lead',
        reason: waiting
          ? `${SKILLS[lead].name} is waiting for kit, so today is support work only.`
          : `Your ${SKILLS[lead].name.toLowerCase()} session.`,
      },
    ]
  }

  const minutes = minutesOverride ?? state.settings.sessionMinutes
  const slots = fullParts(minutes)

  // ——— A day the athlete has assigned is trained as written ———
  const day = todaysDay(state, now)
  if (day.kind === 'skills') {
    const dayName = WEEKDAY_NAMES[day.weekday]
    // The day as written — unless what it puts first loads the area flagged today.
    const ordered = niggleOrder(day.skills, sore)
    const [first, ...rest] = ordered
    const moved = first !== day.skills[0]
    const partnerSkill = slots >= 2 ? rest[0] : undefined
    // Short doses are optional work: none for a skill that loads what is sore today.
    const doses = rest
      .slice(partnerSkill ? 1 : 0)
      .filter((skill) => slots >= 2 && !sore.loads(skill))
      .slice(0, shortDoses(minutes))
    const included = [first, ...(partnerSkill ? [partnerSkill] : []), ...doses]
    const squeezed = ordered.filter((skill) => !included.includes(skill))
    const planned: LineupEntry[] = [
      {
        skill: first,
        role: 'lead',
        reason:
          day.skills.length === 1
            ? `${dayName} is your ${SKILLS[first].name.toLowerCase()} day in your week plan, so the whole session is built around it.`
            : `${dayName} is set to ${joinNames(day.skills)} in your week plan, ${
                moved
                  ? `${SKILLS[day.skills[0]].name.toLowerCase()} first — but ${movedLeadWords(day.skills[0], first, sore)}, so it leads.`
                  : `${SKILLS[first].name.toLowerCase()} first.`
              }${
                squeezed.length
                  ? ` ${capitalised(joinNames(squeezed))} ${squeezed.length === 1 ? 'is' : 'are'} left out today: a ${minutes}-minute session has room for ${roomIn(minutes)}${
                      sore.regions.length && squeezed.some(sore.loads)
                        ? ', and a short dose is not given to a skill that loads the joint you flagged'
                        : ''
                    }.`
                  : ''
              }`,
      },
    ]
    if (partnerSkill) {
      planned.push({
        skill: partnerSkill,
        role: 'partner',
        reason: `${SKILLS[partnerSkill].name} is ${moved && partnerSkill === day.skills[0] ? 'first' : 'the second skill'} in your plan for ${dayName}: ${
          moved && partnerSkill === day.skills[0]
            ? `today it is a full part after the ${SKILLS[first].holdName}${easedWords(sore)}.`
            : `a full part after the ${SKILLS[first].holdName}.`
        }`,
      })
    }
    for (const skill of doses) {
      const def = SKILLS[skill]
      if (def.family === 'balance') {
        planned.splice(1, 0, {
          skill,
          role: 'practice',
          reason: `A few minutes of ${def.holdName} balance practice first, while you are fresh — it is in your plan for ${dayName}.`,
        })
      } else {
        planned.push({
          skill,
          role: 'maintenance',
          reason: `${def.name} gets a short dose — a couple of sets at your current step — as the third skill in your plan for ${dayName}.`,
        })
      }
    }
    return planned
  }

  // ——— Sessions that only ever fit one skill ———
  // "The priority skill leads every session" then means the others are never
  // trained at all: simulated, a second skill went thirty sessions untouched.
  // So the one slot rotates too — the first priority's claim counts double, and
  // each skill after it for less — which gives the main skill about two
  // sessions in three with one other, and the rest their turn in between.
  // (A one-off short version of a longer session is still the main skill's.)
  if (fullParts(state.settings.sessionMinutes) === 1) {
    const turns = skills
      .map((skill, rank) => {
        const sinceFull = daysSinceFullPart(state, skill, now)
        const weight = rank === 0 ? 2 : 1 / rank
        return { skill, rank, sinceFull, score: ((sinceFull ?? NEVER_TRAINED_DAYS) + 1) * weight }
      })
      .sort((a, b) => b.score - a.score || a.rank - b.rank)
    // Today's niggle: the turn goes to a skill that leaves the area alone, when one does.
    const due = turns[0]
    const turn = sore.loads(due.skill) ? (turns.find((t) => !sore.loads(t.skill)) ?? due) : due
    const def = SKILLS[turn.skill]
    const others = skills.filter((skill) => skill !== lead)
    const fits = `${minutes}-minute sessions fit one skill at a time`
    if (turn !== due) {
      return [
        {
          skill: turn.skill,
          role: 'lead',
          reason: `${def.name} takes today's session: your ${fits}, and ${movedLeadWords(due.skill, turn.skill, sore)}. ${
            due.skill === lead
              ? `${SKILLS[lead].name} — your first priority — still takes most of them.`
              : `${SKILLS[due.skill].name}, next in line, sits this one out.`
          }`,
        },
      ]
    }
    if (turn.skill === lead) {
      return [
        {
          skill: lead,
          role: 'lead',
          reason: `${def.name} is your first priority, so it takes most sessions. Your ${fits}; ${joinNames(others)} ${
            others.length === 1 ? 'takes' : 'take'
          } a turn in between.`,
        },
      ]
    }
    const when =
      turn.sinceFull === null
        ? 'has not had a session of its own yet'
        : `last had a session of its own ${turn.sinceFull} day${turn.sinceFull === 1 ? '' : 's'} ago`
    return [
      {
        skill: turn.skill,
        role: 'lead',
        reason: `${def.name} takes today's session: your ${fits}, and it ${when}. ${SKILLS[lead].name} — your first priority — still takes most of them.`,
      },
    ]
  }

  // ——— A niggle named today steers the session round it ———
  // A skill that leaves the area alone leads when the first priority loads it;
  // with every skill loading it, the first priority leads, eased by its own
  // plan's niggle rails. The second part and the short doses go to skills that
  // do not load the area — the check-in says the session changes, and a wrist
  // niggle once kept the handstand and dropped the front lever, the one skill
  // here that leaves the wrist alone.
  const leading = niggleOrder(skills, sore)[0]
  const moved = leading !== lead
  const leadDef = SKILLS[leading]
  const lineup: LineupEntry[] = [
    {
      skill: leading,
      role: 'lead',
      reason: moved
        ? `${leadDef.name} leads today: ${movedLeadWords(lead, leading, sore)}.`
        : `${leadDef.name} is your first priority, so it leads every session and gets the fullest dose.`,
    },
  ]
  const loadsSore = sore.loads
  const soreWords = sore.words

  // ——— The other strength slots: most due first, weighted by priority and fit ———
  const chosen: SkillId[] = [leading]
  // In the athlete's order: a first priority moved off the lead is first among them.
  const candidates = skills.filter((skill) => skill !== leading)
  const scored = candidates
    .map((skill, rank) => {
      const def = SKILLS[skill]
      const since = daysSinceSkill(state, skill, now)
      // Due for a full part, not for any appearance: maintenance sets keep a
      // position, they do not train it.
      const sinceFull = daysSinceFullPart(state, skill, now)
      const due = (sinceFull ?? NEVER_TRAINED_DAYS) + 1
      // Second priority counts for more than fourth.
      const priority = 1 / (rank + 1)
      // A different family complements the lead (push with pull); the same
      // joints under two skills in one session is marked down.
      const complement = def.family !== leadDef.family ? 1.4 : 1
      const sharedJoints = def.loads.slice(0, 2).filter((region) => leadDef.loads.slice(0, 2).includes(region)).length
      const overlap = sharedJoints >= 2 ? 0.7 : sharedJoints === 1 ? 0.85 : 1
      // Worth saying only when the two really are a push and a pull.
      const complements = def.family !== leadDef.family && def.words.strength !== leadDef.words.strength
      return { skill, since, sinceFull, score: due * priority * complement * overlap, complements }
    })
    .sort(
      (a, b) =>
        Number(loadsSore(a.skill)) - Number(loadsSore(b.skill)) ||
        b.score - a.score ||
        candidates.indexOf(a.skill) - candidates.indexOf(b.skill),
    )

  // ——— The second full part ———
  const partner = slots >= 2 ? scored[0] : undefined
  const steered = Boolean(partner) && sore.regions.length > 0 && !loadsSore(partner!.skill) && scored.some((c) => loadsSore(c.skill))
  // The first priority, moved off the lead, can still take the second part —
  // eased like every part today. Said, so the order is not a mystery.
  const eased = Boolean(partner) && moved && partner!.skill === lead
  if (partner) {
    const def = SKILLS[partner.skill]
    // The partner slot is about full training days, not any appearance.
    const days = partner.sinceFull
    const what = partner.since !== null && partner.sinceFull !== partner.since ? 'trained in full' : 'trained'
    const when =
      days === null
        ? partner.since === null
          ? 'has not been trained yet'
          : 'has only had short doses so far'
        : days === 0
          ? `was ${what} earlier today`
          : days === 1
            ? `was last ${what} yesterday`
            : `was last ${what} ${days} days ago`
    lineup.push({
      skill: partner.skill,
      role: 'partner',
      reason: `${def.name} is today's second skill: it ${when}${
        partner.complements ? `, and its ${def.words.strength} pairs with the ${leadDef.holdName}'s ${leadDef.words.strength}` : ''
      }.${steered ? ` It also keeps the second part off the ${soreWords} you flagged ${sore.when}.` : ''}${
        eased ? ` It is your first priority, and goes second today for the ${soreWords} you flagged ${sore.when}${easedWords(sore, ' — ')}.` : ''
      }`,
    })
    chosen.push(partner.skill)
  }

  // ——— Short doses: whoever has waited longest, weighted by the athlete's order ———
  // Two sets at the current step — or, for a balance skill, a few minutes of
  // practice at the start of the session. A skill already practised today is
  // not given another.
  const dosed = candidates
    .map((skill, rank) => {
      const since = daysSinceSkill(state, skill, now)
      return { skill, rank, since, score: ((since ?? NEVER_TRAINED_DAYS) + 1) / (rank + 1) }
    })
    // A short dose is optional work: none for a skill that loads what is sore today.
    .filter((candidate) => !chosen.includes(candidate.skill) && candidate.since !== 0 && !loadsSore(candidate.skill))
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .slice(0, shortDoses(minutes))
  for (const candidate of dosed) {
    const def = SKILLS[candidate.skill]
    const when =
      candidate.since === null
        ? 'has not been trained yet'
        : candidate.since === 1
          ? 'was last trained yesterday'
          : `was last trained ${candidate.since} days ago`
    if (def.family === 'balance') {
      // Practice comes first in the running order, straight after the warm-up.
      lineup.splice(1, 0, {
        skill: candidate.skill,
        role: 'practice',
        reason: `A few minutes of ${def.holdName} balance practice first, while you are fresh: it ${when}, and balance practice is light enough to sit beside strength work.`,
      })
    } else {
      lineup.push({
        skill: candidate.skill,
        role: 'maintenance',
        reason: `${def.name} gets a short dose — a couple of sets at your current step, to keep the position — because it ${when}.`,
      })
    }
    chosen.push(candidate.skill)
  }

  const waiting = candidates.filter((skill) => !chosen.includes(skill))
  if (waiting.length) {
    // No promise of a day: when a skill comes back depends on how the next
    // sessions go. What is true is the rule that decides it — and a skill kept
    // out for the area flagged today is out for that, not for want of room.
    const forSore = waiting.filter(loadsSore)
    const forRoom = waiting.filter((skill) => !loadsSore(skill))
    const parts: string[] = []
    if (forSore.length) {
      parts.push(
        `${capitalised(joinNames(forSore))} ${forSore.length === 1 ? 'sits' : 'sit'} this one out: ${
          forSore.length === 1 ? 'it loads' : 'they load'
        } the ${soreWords} you flagged ${sore.when}.`,
      )
    }
    if (forRoom.length) {
      parts.push(
        `${capitalised(joinNames(forRoom))} ${forRoom.length === 1 ? 'sits' : 'sit'} this one out — a ${minutes}-minute session has room for ${roomIn(minutes)}, and the skill that has waited longest, weighted by your order, comes in next.`,
      )
    }
    lineup[0] = { ...lineup[0], reason: `${lineup[0].reason} ${parts.join(' ')}` }
  }
  return lineup
}

/**
 * The line-up a request resolves to. An explicit list is honoured in the
 * athlete's order (lead, partner, then maintenance); a test, a minimum dose and
 * a template are single-skill by nature.
 */
export function lineupFor(stateIn: AppState, request: WorkoutRequest, now = Date.now(), freshCheckIn?: CheckIn): LineupEntry[] {
  const state = wholeState(stateIn)
  if (request.source === 'test') {
    const skill = request.stepId ? skillOfStep(request.stepId) : (request.skills?.[0] ?? focusSkill(state))
    return [{ skill, role: 'lead', reason: `A max test on your ${SKILLS[skill].name.toLowerCase()}.` }]
  }
  if (request.source === 'micro' || request.source === 'template') {
    const skill = request.skills?.[0] ?? focusSkill(state)
    return [{ skill, role: 'lead', reason: `Your ${SKILLS[skill].name.toLowerCase()} is the focus.` }]
  }
  const asked = request.skills?.filter((skill, i, all) => SKILLS[skill] && all.indexOf(skill) === i).slice(0, 3)
  if (asked?.length) {
    // The skills asked for are the session's; a niggle named today can only
    // change which goes first. A planned day's list is written before the
    // check-in, and rebuilt from it the planche still led a wrist-niggle day.
    const sore = soreToday(state, now, freshCheckIn)
    const ordered = niggleOrder(asked, sore)
    const moved = ordered[0] !== asked[0]
    return ordered.map((skill, i) => ({
      skill,
      // A third skill gets its short form: practice for a balance skill, two sets otherwise.
      role: i === 0 ? 'lead' : i === 1 ? 'partner' : SKILLS[skill].family === 'balance' ? 'practice' : 'maintenance',
      reason:
        asked.length === 1
          ? `You chose a ${SKILLS[skill].name.toLowerCase()} session.`
          : `You chose ${joinNames(asked)} for this session.${
              moved && i === 0 ? ` ${capitalised(movedLeadWords(asked[0], skill, sore))}, so it goes first today.` : ''
            }${moved && skill === asked[0] ? ` It goes after the ${SKILLS[ordered[0]].holdName} today${easedWords(sore)}.` : ''}`,
    }))
  }
  return todaysLineup(state, now, request.minutes, freshCheckIn)
}
