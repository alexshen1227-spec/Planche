import { useMemo, useState } from 'react'
import type { SkillId } from '../types'
import { useStore } from '../lib/store'
import { STEP_BY_ID } from '../data/progressions'
import { missingKit, SKILL_LIST, SKILLS } from '../data/skills'
import { kitNeedsPhrase } from '../data/equipment'
import { activeSkills, hasTrack, stepOfSkill } from '../lib/skills'
import {
  ladderItem,
  levelItem,
  placementRecord,
  placeSkill,
  PULLUPS_ITEM,
  type InterviewAnswers,
  type InterviewItem,
} from '../lib/placement'
import { pushToast } from '../lib/toast'
import { Icon } from './Icon'
import { Figure } from './Figure'

/**
 * Start training another skill: choose it, answer where you are on its road,
 * and see the placement before anything changes. Answers already given at
 * setup — wrists, push-ups, pull-ups — are reused, so the same caps apply.
 */
export function AddSkill({ onClose, onAdded }: { onClose: () => void; onAdded: (skill: SkillId) => void }) {
  const { state, dispatch } = useStore()
  const current = activeSkills(state)
  const choices = SKILL_LIST.filter((def) => !current.includes(def.id))
  const [skill, setSkill] = useState<SkillId | null>(null)
  const [answers, setAnswers] = useState<InterviewAnswers>({})
  // What is already known about this athlete, from any earlier placement.
  const known = useMemo(() => {
    const out: InterviewAnswers = { ...(state.assessment?.answers ?? {}) }
    for (const track of Object.values(state.tracks ?? {})) Object.assign(out, track?.assessment?.answers ?? {})
    return out
  }, [state.assessment, state.tracks])
  const merged = useMemo(() => ({ ...known, ...answers }), [known, answers])
  const questions: InterviewItem[] = useMemo(() => {
    if (!skill) return []
    const list: InterviewItem[] = []
    if ((skill === 'frontlever' || skill === 'flag') && known.pullups === undefined) list.push(PULLUPS_ITEM)
    list.push(levelItem(skill))
    const ladder = ladderItem(skill)
    if (ladder) list.push(ladder)
    return list
  }, [skill, known.pullups])
  const question = questions.find((item) => answers[item.id] === undefined)

  if (!skill) {
    return (
      <div className="p-6 sm:p-8">
        <h2 className="pr-10 font-display text-[22px] font-bold text-ink">Add a skill</h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">
          It joins the end of your list and rotates into sessions behind your main skill. Reorder or drop it any time
          in Settings.
        </p>
        <div className="mt-4 space-y-2.5">
          {choices.map((def) => {
            const gap = missingKit(def.id, state.profile.equipment)
            return (
              <button
                key={def.id}
                onClick={() => {
                  setSkill(def.id)
                  setAnswers({})
                }}
                className="flex w-full items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-accent hover:bg-accent-soft"
              >
                <Figure step={def.steps[def.steps.length - 1].id} className="h-14 w-[70px] shrink-0 text-ink2" />
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-ink">{def.name}</div>
                  <div className="mt-0.5 text-[13px] leading-relaxed text-ink2">{def.tagline}</div>
                  {gap.length ? (
                    <div className="mt-1 text-[12px] leading-relaxed text-accent-text">
                      Needs {kitNeedsPhrase(gap)} — not on your equipment list yet.
                    </div>
                  ) : null}
                </div>
                <Icon name="chevronR" size={16} className="ml-auto shrink-0 text-ink3" />
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const def = SKILLS[skill]
  // Trained before and dropped: its road, records and placement are all still
  // here, so it comes back where it was left rather than being placed again.
  if (hasTrack(state, skill)) {
    const step = STEP_BY_ID[stepOfSkill(state, skill)]
    return (
      <div className="p-6 sm:p-8">
        <div className="pr-10 text-[12.5px] font-semibold uppercase tracking-wider text-accent-text">{def.name}</div>
        <div className="mt-3 flex items-center gap-4">
          <Figure step={step.id} tone="accent" className="h-20 w-24 shrink-0 text-ink" />
          <div className="min-w-0">
            <h2 className="font-display text-[22px] font-bold text-ink">{step.name}</h2>
            <div className="text-[13.5px] text-ink2">{step.tagline}</div>
          </div>
        </div>
        <p className="mt-3 text-[13.5px] leading-relaxed text-ink2">
          You have trained this before, so it comes back where you left it. Nothing was lost while it was off your
          list — though after a long break the first sessions will feel harder than the step says.
        </p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <button
            onClick={() => setSkill(null)}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-[14px] font-medium text-ink2"
          >
            Back
          </button>
          <button
            onClick={() => {
              dispatch({ type: 'SET_SKILLS', skills: [...current, skill] })
              pushToast(`${def.name} is back in your sessions, at ${step.name}.`, 'success', 5000)
              onAdded(skill)
            }}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 font-display text-[15px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            <Icon name="check" size={16} /> Bring it back
          </button>
        </div>
      </div>
    )
  }
  if (question) {
    return (
      <div className="p-6 sm:p-8">
        <div className="pr-10 text-[12.5px] font-semibold uppercase tracking-wider text-accent-text">{def.name}</div>
        <h2 className="mt-1 font-display text-[20px] font-bold leading-snug text-ink">{question.question}</h2>
        {question.standard ? <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink2">{question.standard}</p> : null}
        <div className="mt-4 space-y-2" role="group" aria-label={question.question}>
          {question.options.map((option) => (
            <button
              key={`${question.id}:${option.label}`}
              onClick={() => setAnswers((prev) => ({ ...prev, [question.id]: option.value }))}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 text-left transition hover:border-accent hover:bg-accent-soft"
            >
              <span className="min-w-0">
                <span className="block text-[14.5px] font-medium text-ink">{option.label}</span>
                {option.hint ? <span className="mt-0.5 block text-[12.5px] text-ink2">{option.hint}</span> : null}
              </span>
              <Icon name="chevronR" size={16} className="shrink-0 text-ink3" />
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            const asked = Object.keys(answers)
            if (!asked.length) {
              setSkill(null)
              return
            }
            const next = { ...answers }
            delete next[asked[asked.length - 1]]
            setAnswers(next)
          }}
          className="mt-4 rounded-xl border border-line bg-surface px-4 py-2.5 text-[13.5px] font-medium text-ink2 hover:text-ink"
        >
          Back
        </button>
      </div>
    )
  }

  const placement = placeSkill(skill, merged)
  const step = STEP_BY_ID[placement.stepId]
  const gap = missingKit(skill, state.profile.equipment)
  return (
    <div className="p-6 sm:p-8">
      <div className="pr-10 text-[12.5px] font-semibold uppercase tracking-wider text-accent-text">
        {def.name} · where you start
      </div>
      <div className="mt-3 flex items-center gap-4">
        <Figure step={step.id} tone="accent" className="h-20 w-24 shrink-0 text-ink" />
        <div className="min-w-0">
          <h2 className="font-display text-[22px] font-bold text-ink">{step.name}</h2>
          <div className="text-[13.5px] text-ink2">{step.tagline}</div>
        </div>
      </div>
      <p className="mt-3 text-[13.5px] leading-relaxed text-ink2">{placement.reason}</p>
      {placement.inconsistencies.concat(placement.caveats).map((line) => (
        <p key={line} className="mt-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] leading-relaxed text-ink2">
          {line}
        </p>
      ))}
      {gap.length ? (
        <p className="mt-2 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-[13px] leading-relaxed text-ink">
          {def.requiresNote} It will wait in your list until you add the kit under Settings → Equipment.
        </p>
      ) : null}
      <details className="mt-3 rounded-xl border border-line bg-raised px-3 py-2">
        <summary className="cursor-pointer text-[12.5px] font-semibold text-ink">Worth knowing before you start</summary>
        <ul className="mt-2 space-y-1.5">
          {[...def.prerequisites, ...def.safety].map((line) => (
            <li key={line} className="text-[12.5px] leading-relaxed text-ink2">
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] leading-relaxed text-ink3">{def.sourcing}</p>
      </details>
      <div className="mt-5 flex flex-wrap gap-2.5">
        <button
          onClick={() => {
            const asked = Object.keys(answers)
            const next = { ...answers }
            if (asked.length) delete next[asked[asked.length - 1]]
            setAnswers(next)
          }}
          className="rounded-xl border border-line bg-surface px-4 py-3 text-[14px] font-medium text-ink2"
        >
          Back
        </button>
        <button
          onClick={() => {
            dispatch({
              type: 'ADD_SKILL',
              skill,
              stepId: placement.stepId,
              assessment: placementRecord(skill, merged, Date.now()),
              goalStepId: def.defaultGoal,
            })
            pushToast(`${def.name} added. It starts at ${step.name}.`, 'success', 5000)
            onAdded(skill)
          }}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-3 font-display text-[15px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
          style={{ background: 'var(--t-btn-accent)' }}
        >
          <Icon name="check" size={16} /> Start training it
        </button>
        <button onClick={onClose} className="rounded-xl px-3 py-3 text-[14px] font-medium text-ink3 hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  )
}
