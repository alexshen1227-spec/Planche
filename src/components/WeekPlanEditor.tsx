import { useMemo, useState } from 'react'
import type { DayPlan, SkillId, WeekPlan, Weekday } from '../types'
import { useStore } from '../lib/store'
import { SKILLS } from '../data/skills'
import { activeSkills, wholeState } from '../lib/skills'
import { roomIn } from '../lib/lineup'
import {
  coverageNotes,
  MAX_SKILLS_PER_DAY,
  planCoverage,
  plannedTrainingDays,
  readDay,
  sanitizeWeekPlan,
  WEEK_ORDER,
  WEEKDAY_NAMES,
  weekdayOf,
} from '../lib/weekPlan'
import { pushToast } from '../lib/toast'
import { Modal } from './ui'
import { coverageSummary, unavailableClause } from './weekPlanCopy'

/**
 * Edit the athlete's own week: which skills each weekday is for.
 *
 * Every day is one of three things, and exactly one is always marked: left to
 * the coach, a planned rest day, or up to three skills in the order tapped —
 * the first leads, a second gets a full part, a third a short dose. Nothing is
 * written until Save, and what Save will change beyond the plan itself (the
 * weekly goal follows the number of training days) is said before it is pressed.
 *
 * It is the athlete's plan. The copy never calls a split good; it says what
 * the app will do with it, including where it cannot follow it — a session too
 * short for three skills, a skill waiting for kit.
 */
export function WeekPlanEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} label="Plan your week">
      {/* Mounted with the dialog, so every opening starts from what is saved. */}
      {open ? <WeekPlanForm onClose={onClose} /> : null}
    </Modal>
  )
}

function WeekPlanForm({ onClose }: { onClose: () => void }) {
  const { state: stored, dispatch } = useStore()
  const state = wholeState(stored)
  const skills = activeSkills(state)
  const several = skills.length > 1
  const saved = state.settings.weekPlan
  const [draft, setDraft] = useState<WeekPlan>(() => ({ ...saved }))
  const [confirmingClear, setConfirmingClear] = useState(false)
  const today = weekdayOf(Date.now())
  // The athlete as they would be with this draft saved, so each row is read
  // by the same rule the sessions use: which of its skills can train now.
  const drafted = useMemo(() => ({ ...state, settings: { ...state.settings, weekPlan: draft } }), [state, draft])

  // Exactly what the store will keep, so what is said about saving is what happens.
  const toSave = sanitizeWeekPlan(draft)
  const days = plannedTrainingDays(toSave)
  const goal = state.settings.weeklyGoal
  const goalChanges = days > 0 && days !== goal
  const minutes = state.settings.sessionMinutes
  // How the edited plan spreads the week, and what is worth knowing about that
  // before it is saved. An emptied plan is passed as `{}`: left undefined, both
  // functions fall back to the plan already saved and would describe that.
  const edited = toSave ?? {}
  const summary = coverageSummary(planCoverage(state, edited))
  const coverage = coverageNotes(state, edited)

  const setDay = (day: Weekday, change: (current: DayPlan | undefined) => DayPlan | undefined) =>
    setDraft((current) => {
      const value = change(current[day])
      const next = { ...current }
      // A day with nothing picked is a day left to the coach, not an empty list.
      if (value === undefined || (value !== 'rest' && value.length === 0)) delete next[day]
      else next[day] = value
      return next
    })
  const toggleSkill = (day: Weekday, skill: SkillId) =>
    setDay(day, (current) => {
      const picked = Array.isArray(current) ? current : []
      if (picked.includes(skill)) return picked.filter((id) => id !== skill)
      return picked.length < MAX_SKILLS_PER_DAY ? [...picked, skill] : picked
    })

  const save = () => {
    dispatch({ type: 'SET_WEEK_PLAN', plan: toSave ?? {} })
    pushToast(
      toSave
        ? `Your week is saved.${goalChanges ? ` Weekly goal: ${days} session${days === 1 ? '' : 's'} a week.` : ''}`
        : 'Your week plan is cleared. The coach decides every day again.',
      'success',
    )
    onClose()
  }
  const clear = () => {
    dispatch({ type: 'SET_WEEK_PLAN', plan: {} })
    pushToast('Your week plan is cleared. The coach decides every day again.', 'success')
    onClose()
  }

  const note = goalChanges
    ? `Your weekly goal becomes ${days} session${days === 1 ? '' : 's'} a week to match. Weeks you have already trained are still measured against the goal you had then.`
    : toSave
      ? null
      : saved
        ? 'Nothing is assigned: saving clears your plan, and the coach decides every day again.'
        : 'Give at least one day a skill or Rest to save a plan.'

  return (
    <>
      <div className="px-5 pb-1 pt-6 sm:px-7 sm:pt-7">
        <h2 className="pr-10 font-display text-[22px] font-bold text-ink">Your week</h2>
        {several ? (
          <>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink2">
              Tap a day’s skills in the order you want them. The first leads the session, a second gets a full part and
              a third a short dose. Session length still decides how many fit: your {minutes}-minute sessions have room
              for {roomIn(minutes)}.
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink3">
              A day left on Coach decides is shared between your skills by priority and by what has waited longest. This
              is your plan: the app follows it as written and does not rate one split against another.
            </p>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink2">
              Mark the days you mean to train and the days you rest. With one skill every session is a{' '}
              {SKILLS[skills[0]].name.toLowerCase()} session whatever the day says, so the plan only marks your training
              days, and your weekly goal follows it.
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink3">
              A day left on Coach decides stays open: train or rest as it comes.
            </p>
          </>
        )}
        <div className="mt-3">
          {WEEK_ORDER.map((day) => {
            const reading = readDay(drafted, day)
            return (
              <DayRow
                key={day}
                day={day}
                plan={draft[day]}
                skills={skills}
                isToday={day === today}
                unavailable={reading.kind === 'rest' ? [] : reading.unavailable}
                backToCoach={reading.kind === 'open'}
                onChange={(value) => setDay(day, () => value)}
                onToggle={(skill) => toggleSkill(day, skill)}
              />
            )
          })}
        </div>
      </div>

      {/* Pinned to the bottom of the sheet: seven rows are taller than a phone,
          and neither Save nor what the plan adds up to should be a scroll away
          from the day just changed. The solid shadow is a skirt in the sheet's
          own colour, clipped at the sheet's edge: in an emulated phone at a
          fractional scale the pinned footer was drawn a few pixels short of
          that edge and the rows showed under it. Where that does not happen
          it draws nothing. */}
      <div className="sticky bottom-0 border-t border-line bg-surface px-5 pb-[max(env(safe-area-inset-bottom),14px)] pt-3 shadow-[0_12px_0_0_var(--t-surface)] sm:px-7 sm:pb-5">
        {confirmingClear ? null : (
          <div aria-live="polite">
            {/* Capped, so a long list of notes can never push the days off a small screen. */}
            {summary ? (
              <div className="mb-2 max-h-[34vh] overflow-y-auto" data-week-plan-coverage>
                <p className="text-[12.5px] leading-relaxed text-ink2">
                  <span className="font-semibold text-ink">A week of this plan:</span> {summary}
                </p>
                {coverage.map((line) => (
                  <p key={line} className="mt-1 text-[12px] leading-relaxed text-ink3">
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
            {note ? <p className="mb-2 text-[12.5px] leading-relaxed text-ink2">{note}</p> : null}
          </div>
        )}
        {confirmingClear ? (
          <div>
            <p className="text-[13px] leading-relaxed text-ink">
              Clear every day? The coach decides each session again, and your weekly goal stays at {goal}.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                className="min-h-11 flex-1 rounded-xl border border-line bg-raised px-4 text-[14px] font-medium text-ink"
              >
                Keep my plan
              </button>
              <button
                type="button"
                onClick={clear}
                className="min-h-11 flex-1 rounded-xl bg-danger-solid px-4 text-[14px] font-semibold text-white"
              >
                Clear it
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {saved ? (
              <button
                type="button"
                onClick={() => setConfirmingClear(true)}
                className="min-h-11 rounded-xl px-2 text-[13.5px] font-medium text-ink3 transition hover:text-ink"
              >
                Clear plan
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="ml-auto min-h-11 rounded-xl border border-line bg-raised px-4 text-[14px] font-medium text-ink2 transition hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!toSave && !saved}
              className="min-h-11 min-w-[7rem] rounded-xl px-5 font-display text-[15px] font-semibold text-on-accent shadow-card transition hover:brightness-105 disabled:opacity-40"
              style={{ background: 'var(--t-btn-accent)' }}
            >
              Save
            </button>
          </div>
        )}
      </div>
    </>
  )
}

/** One weekday: left to the coach, a rest day, or skills in the order tapped. */
function DayRow({
  day,
  plan,
  skills,
  isToday,
  unavailable,
  backToCoach,
  onChange,
  onToggle,
}: {
  day: Weekday
  plan: DayPlan | undefined
  /** The skills the athlete trains, in their order. */
  skills: SkillId[]
  isToday: boolean
  /** Skills picked for this day that cannot train right now (`readDay`). */
  unavailable: SkillId[]
  /** None of the picked skills can train, so the day goes back to the coach. */
  backToCoach: boolean
  onChange: (value: DayPlan | undefined) => void
  onToggle: (skill: SkillId) => void
}) {
  const name = WEEKDAY_NAMES[day]
  const picked: SkillId[] = Array.isArray(plan) ? plan : []
  const resting = plan === 'rest'
  const open = !resting && picked.length === 0
  // The athlete's skills, then any the day still names that has since left
  // their list: shown, so it can be seen and taken off, never silently kept.
  const chips = [...skills, ...picked.filter((skill) => !skills.includes(skill))]
  const full = picked.length >= MAX_SKILLS_PER_DAY
  const headingId = `week-plan-day-${day}`
  return (
    <div role="group" aria-labelledby={headingId} className="border-t border-line py-3.5 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 id={headingId} className="text-[15px] font-semibold text-ink">
          {name}
          {/* A real space as well as the margin: read aloud, the two are one string. */}
          {isToday ? (
            <>
              {' '}
              <span className="ml-1 text-[11px] font-bold uppercase tracking-wider text-accent-text">Today</span>
            </>
          ) : null}
        </h3>
        <div className="flex gap-1.5">
          <ModeButton label="Coach decides" day={name} pressed={open} onClick={() => onChange(undefined)} />
          <ModeButton label="Rest" day={name} pressed={resting} onClick={() => onChange(resting ? undefined : 'rest')} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((skill) => {
          const position = picked.indexOf(skill)
          const on = position >= 0
          // The number is the order tapped; with one skill there is no order to show.
          const label = `${on && chips.length > 1 ? `${position + 1}. ` : ''}${SKILLS[skill].name}`
          return (
            <button
              key={skill}
              type="button"
              aria-pressed={on}
              aria-label={`${name}: ${label}`}
              disabled={!on && full}
              onClick={() => onToggle(skill)}
              className={`min-h-10 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition disabled:opacity-40 ${
                on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2 hover:text-ink'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
      {full && chips.length > picked.length ? (
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink3">
          That is the most one day takes: a lead, a second skill in full and one short dose.
        </p>
      ) : null}
      {unavailable.length ? (
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink3">
          {unavailableClause(unavailable, skills)}
          {backToCoach
            ? ', so the coach decides this day until that changes.'
            : `, so this day runs without ${unavailable.length === 1 ? 'it' : 'them'} until that changes.`}
        </p>
      ) : null}
    </div>
  )
}

/** "Coach decides" or "Rest": the two ways a day has no skills of its own. */
function ModeButton({ label, day, pressed, onClick }: { label: string; day: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={`${day}: ${label}`}
      onClick={onClick}
      className={`min-h-10 rounded-xl border px-2.5 py-1.5 text-[13px] font-semibold transition ${
        pressed ? 'border-accent-text bg-accent-soft text-accent-text' : 'border-line bg-raised text-ink2 hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}
