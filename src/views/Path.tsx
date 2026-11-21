import { useEffect, useMemo, useRef, useState } from 'react'
import type { SkillId, StepDef, StepId, WorkoutRequest } from '../types'
import { useStore } from '../lib/store'
import { STEP_BY_ID, stepBefore, stepsOf } from '../data/progressions'
import { EXERCISE_BY_ID } from '../data/exercises'
import { missingKit, SKILL_LIST, SKILLS } from '../data/skills'
import { equipmentLabel } from '../data/equipment'
import { activeSkills, skillView, viewForStep } from '../lib/skills'
import { ladderStatus, type LadderStatus } from '../lib/repLadder'
import { goalChoices } from '../lib/placement'
import { AddSkill } from '../components/AddSkill'
import { daysAtBar } from '../lib/progression'
import { challengeBlockedReason } from '../data/workouts'
import { buildPlan } from '../lib/coach'
import { fmtHold, fmtDate } from '../lib/time'
import { pushToast } from '../lib/toast'
import { Icon } from '../components/Icon'
import { Figure } from '../components/Figure'
import { Modal } from '../components/ui'
import { qualifyingProgress } from '../lib/progression'
import { BridgeCard } from '../components/BridgeCard'
import { twinOf } from '../data/pressing'
import { readJourney, type JourneyStop } from '../lib/journey'
import { ShareProgress } from '../components/ShareProgress'
import { MilestoneClips } from '../components/MilestoneClips'

/** How long a step took, or how long it has been going — only when both ends have dates. */
function stopLine(stop: JourneyStop | undefined, next: JourneyStop | undefined): string | null {
  if (!stop || stop.days === undefined) return null
  const sessions = stop.sessions !== undefined ? ` · ${stop.sessions} session${stop.sessions === 1 ? '' : 's'}` : ''
  if (stop.current && next?.openedAt === undefined) return `Day ${stop.days + 1} on this step${sessions}`
  const took = stop.days === 0 ? 'Took under a day' : `Took ${stop.days} day${stop.days === 1 ? '' : 's'}`
  return `${took}${sessions}${next?.via === 'next-shape' ? ' · opened the next step early' : ''}`
}

/**
 * The road as a strip of figures: what is behind, where you are, what is
 * ahead. Dates come from replaying history (lib/journey); a step that was
 * placed rather than trained through has none.
 */
function RoadSoFar({ stops, firstSessionAt, totalSessions, road }: ReturnType<typeof readJourney> & { road: StepDef[] }) {
  const byId = new Map(stops.map((stop) => [stop.stepId, stop]))
  // Bring the current step into view inside the strip, without scrolling the page.
  const stripRef = useRef<HTMLOListElement | null>(null)
  const currentId = stops.find((stop) => stop.current)?.stepId
  useEffect(() => {
    const strip = stripRef.current
    const item = strip?.querySelector<HTMLElement>('[aria-current="step"]')
    if (!strip || !item) return
    strip.scrollLeft = Math.max(0, item.offsetLeft - (strip.clientWidth - item.clientWidth) / 2)
  }, [currentId])
  const earned = stops.filter((stop) => stop.via === 'bar' || stop.via === 'next-shape').length
  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4 shadow-card" aria-labelledby="road-so-far">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="road-so-far" className="text-[13px] font-semibold text-ink">
            Your road so far
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink3 tnum">
            {firstSessionAt === undefined
              ? 'It starts with your first logged session.'
              : `Training since ${fmtDate(firstSessionAt)} · ${totalSessions} session${totalSessions === 1 ? '' : 's'}${
                  earned ? ` · ${earned} step${earned === 1 ? '' : 's'} earned` : ''
                }`}
          </p>
        </div>
        <ShareProgress skill={road[0]?.skill} />
      </div>
      <ol ref={stripRef} className="relative -mx-1 mt-3 flex snap-x gap-0.5 overflow-x-auto px-1 pb-1">
        {road.map((step) => {
          const stop = byId.get(step.id)
          const current = stop?.current === true
          const reached = stop !== undefined
          const label = current
            ? stop?.days !== undefined
              ? `day ${stop.days + 1}`
              : 'now'
            : !reached
              ? ''
              : stop.via === 'bar' || stop.via === 'next-shape'
                ? stop.openedAt !== undefined
                  ? fmtDate(stop.openedAt)
                  : ''
                : stop.via === 'placed'
                  ? 'placed'
                  : 'start'
          return (
            <li
              key={step.id}
              className={`w-[80px] shrink-0 snap-start rounded-xl px-1 py-1.5 text-center ${current ? 'bg-accent-soft' : ''}`}
              aria-current={current ? 'step' : undefined}
            >
              <Figure
                step={step.id}
                tone={current ? 'accent' : 'plain'}
                className={`mx-auto h-10 w-12 ${current ? 'text-ink' : reached ? 'text-ink2' : 'text-ink3 opacity-40'}`}
              />
              <div className={`mt-0.5 truncate text-[11px] font-semibold ${current ? 'text-accent-text' : reached ? 'text-ink2' : 'text-ink3'}`}>
                {step.short}
              </div>
              <div className="h-4 truncate text-[10.5px] text-ink3 tnum">
                {label || (reached ? '' : <Icon name="lock" size={10} className="mx-auto mt-0.5" />)}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** Destinations worth aiming at; the early steps are waypoints, not goals. */
const GOAL_CHOICES: StepId[] = ['tuck', 'advtuck', 'straddle', 'full']

export function Path({ startWorkout }: { startWorkout: (request: WorkoutRequest) => void }) {
  const { state: whole, dispatch } = useStore()
  const [detail, setDetail] = useState<StepDef | null>(null)
  const [adding, setAdding] = useState(false)
  // One road on screen at a time, read through the same per-skill view the coach uses.
  const skills = activeSkills(whole)
  const [pickedSkill, setPickedSkill] = useState<SkillId | null>(null)
  const viewSkill: SkillId = pickedSkill && skills.includes(pickedSkill) ? pickedSkill : skills[0]
  const state = useMemo(() => skillView(whole, viewSkill), [whole, viewSkill])
  const skillDef = SKILLS[viewSkill]
  const STEPS = stepsOf(viewSkill)
  const notTraining = SKILL_LIST.filter((def) => !skills.includes(def.id))
  const kitGap = missingKit(viewSkill, whole.profile.equipment)

  const currentOrder = STEPS.find((s) => s.id === state.stepId)?.order ?? 0
  const goalStepId = state.profile.goalStepId ?? skillDef.defaultGoal
  // A full replay of history: only when the history or the step changes.
  const journey = useMemo(
    () => readJourney(whole, Date.now(), viewSkill),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [whole.sessions, whole.stepId, whole.baseStepId, whole.grandfatheredStepId, whole.unlocked, whole.tracks, viewSkill],
  )
  const stopById = new Map(journey.stops.map((stop) => [stop.stepId, stop]))
  const ladder = useMemo(() => ladderStatus(whole, viewSkill), [whole, viewSkill])

  return (
    <div className="animate-rise">
      <h1 className="font-display text-[28px] font-bold text-ink">
        {viewSkill === 'planche' ? 'The Road to Planche' : `The road to ${skillDef.words.summit}`}
      </h1>
      <p className="mt-0.5 max-w-2xl text-[14px] leading-relaxed text-ink2">
        {viewSkill === 'planche'
          ? 'Eight steps from first plank to full flight. Tap any step for coaching, form cues and a max test.'
          : `${skillDef.blurb} Tap any step for coaching, form cues and a max test.`}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Skill shown">
        {skills.length > 1
          ? skills.map((skill, index) => {
              const on = skill === viewSkill
              return (
                <button
                  key={skill}
                  aria-pressed={on}
                  onClick={() => setPickedSkill(skill)}
                  className={`min-h-10 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${
                    on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-surface text-ink2 hover:text-ink'
                  }`}
                >
                  {SKILLS[skill].name}
                  {index === 0 ? <span className={`ml-1.5 text-[11px] font-medium ${on ? 'opacity-80' : 'text-ink3'}`}>main</span> : null}
                </button>
              )
            })
          : null}
        {notTraining.length ? (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3.5 py-1.5 text-[13px] font-semibold text-ink2 transition hover:text-ink"
          >
            <Icon name="plus" size={14} /> Add a skill
          </button>
        ) : null}
      </div>

      {kitGap.length ? (
        <p className="mt-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-[13px] leading-relaxed text-ink" role="status">
          <span className="font-semibold">{skillDef.name} is waiting for kit.</span>{' '}
          {skillDef.requiresNote ??
            `It needs ${kitGap.map((options) => options.map((id) => equipmentLabel(id)).join(' or ')).join(', and ')}.`}{' '}
          Add it under Settings → Equipment and it joins your sessions; until then it is left out of them.
        </p>
      ) : null}

      <RoadSoFar {...journey} road={STEPS} />

      {viewSkill !== 'planche' ? (
        <details className="mt-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
          <summary className="cursor-pointer text-[13px] font-semibold text-ink">
            About this road: what it rests on, and what to know first
          </summary>
          <p className="mt-2 text-[13px] leading-relaxed text-ink2">{skillDef.sourcing}</p>
          <div className="mt-3 text-[12.5px] font-semibold text-ink">Before you start</div>
          <ul className="mt-1 space-y-1.5">
            {[...skillDef.prerequisites, ...skillDef.safety].map((line) => (
              <li key={line} className="text-[12.5px] leading-relaxed text-ink2">
                {line}
              </li>
            ))}
          </ul>
          <div className="mt-3 text-[12.5px] font-semibold text-ink">How often</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">{skillDef.frequency}</p>
          <div className="mt-3 text-[12.5px] font-semibold text-ink">What the camera can tell you</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">
            {skillDef.camera.placement} {skillDef.camera.honesty}
          </p>
        </details>
      ) : null}

      {/* Goal picker. Deliberately here rather than buried in Settings: the
          goal decides which cooldown mobility appears and how far the app
          says you have to go, so it belongs beside the road it describes. */}
      <div className="mt-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <div className="text-[13px] font-semibold text-ink" id="path-goal">
          What are you aiming at?
        </div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink3">
          Your destination, not your current step. It shapes the mobility work in your sessions and how the app
          measures the distance left.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-labelledby="path-goal">
          {(viewSkill === 'planche' ? GOAL_CHOICES : goalChoices(viewSkill)).map((id) => {
            const on = goalStepId === id
            return (
              <button
                key={id}
                aria-pressed={on}
                onClick={() =>
                  viewSkill === 'planche'
                    ? dispatch({ type: 'SET_PROFILE', patch: { goalStepId: id } })
                    : dispatch({ type: 'SET_GOAL', stepId: id })
                }
                className={`rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
                  on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2 hover:text-ink'
                }`}
              >
                {STEP_BY_ID[id].name}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/25 bg-ok-soft px-3 py-1.5 font-medium text-ok-text">
          <Icon name="check" size={13} /> Clean hold
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft px-3 py-1.5 font-medium text-accent-text">
          <Icon name="monitor" size={13} /> Camera pass
        </span>
        <details className="group">
          <summary className="cursor-pointer list-none rounded-full border border-line bg-surface px-3 py-1.5 font-medium text-ink2 transition hover:text-ink">
            How unlocks work <span className="ml-1 inline-block transition group-open:rotate-180">⌄</span>
          </summary>
          <p className="mt-2 max-w-2xl rounded-2xl border border-line bg-surface p-3.5 leading-relaxed text-ink2 shadow-card">
            Reach the bar with a hold you rate Clean and a passing filmed form check. Already training farther along?
            Open a locked step to place yourself there after the three-part safety check.
          </p>
        </details>
      </div>

      <div className="relative mt-7 pb-2">
        {/* Spine, with a gradient fill up to the current step */}
        <div className="absolute bottom-6 left-[27px] top-2 w-0.5 rounded bg-line sm:left-[31px]" />
        <div
          className="absolute left-[27px] top-2 w-0.5 rounded sm:left-[31px]"
          style={{
            height: `${(currentOrder / (STEPS.length - 1)) * 92}%`,
            background: 'linear-gradient(to bottom, var(--t-ok), var(--t-accent))',
          }}
        />
        <div className="space-y-3">
          {STEPS.map((step) => {
            const unlocked = state.unlocked.includes(step.id)
            const isCurrent = state.stepId === step.id
            const best = qualifyingProgress(state, step.id).value
            const done = unlocked && step.order < currentOrder && best >= step.unlockSec
            const available = unlocked && step.order < currentOrder && !done
            const pct = Math.min(1, best / step.unlockSec)
            const keyEx = EXERCISE_BY_ID[step.keyExerciseId]
            return (
              <button
                key={step.id}
                onClick={() => setDetail(step)}
                className={`card-int relative flex w-full items-center gap-2.5 rounded-2xl border p-3 text-left min-[480px]:gap-4 sm:gap-5 sm:p-5 sm:pl-4 ${
                  isCurrent
                    ? 'card-sheen border-accent/40 bg-surface shadow-card'
                    : unlocked
                      ? 'border-line bg-surface shadow-card'
                      : 'border-line bg-surface/40 opacity-80 hover:opacity-100'
                }`}
              >
                {/* Node */}
                <div
                  className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 sm:h-9 sm:w-9 ${
                    done
                      ? 'border-ok bg-ok-soft text-ok-text'
                      : isCurrent
                        ? 'border-accent bg-accent-soft text-accent-text'
                        : unlocked
                          ? 'border-line-strong bg-raised text-ink2'
                          : 'border-line bg-raised text-ink3'
                  }`}
                >
                  {isCurrent ? (
                    <span className="absolute inset-[-5px] rounded-full border-2 border-accent/50 animate-ping-soft" />
                  ) : null}
                  {done ? (
                    <Icon name="check" size={15} strokeWidth={2.5} />
                  ) : unlocked ? (
                    <span className="font-display text-[13px] font-bold tnum">{step.order + 1}</span>
                  ) : (
                    <Icon name="lock" size={14} />
                  )}
                </div>
                <Figure
                  step={step.id}
                  tone={isCurrent ? 'accent' : 'plain'}
                  className={`hidden h-14 w-16 shrink-0 min-[480px]:block sm:h-16 sm:w-20 ${unlocked ? 'text-ink' : 'text-ink3'}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <span className={`font-display text-[17px] font-semibold ${unlocked ? 'text-ink' : 'text-ink2'}`}>
                      {step.name}
                    </span>
                    {isCurrent ? (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-on-accent">
                        current
                      </span>
                    ) : done ? (
                      <span className="text-[12px] font-medium text-ok-text">cleared</span>
                    ) : available ? (
                      <span className="text-[12px] font-medium text-ink3">available</span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[13.5px] leading-snug text-ink2">{step.tagline}</div>
                  <div className="mt-2 space-y-1.5">
                    <div className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-line">
                      <div
                        className={`h-full rounded-full ${done || pct >= 1 ? 'bg-ok' : 'bg-accent'}`}
                        style={{ width: `${pct * 100}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-x-1.5 text-[12px] leading-snug text-ink3 tnum">
                      {best ? fmtHold(best) : '0s'} / {step.unlockSec}s verified
                      {keyEx.perSide ? <span>· both sides</span> : null}
                      {step.repeatDays && step.repeatDays > 1 ? (
                        // A balance is owned when it can be shown again, not once.
                        <span>
                          · {Math.min(step.repeatDays, daysAtBar(state, step.id))} of {step.repeatDays} days at the bar
                        </span>
                      ) : null}
                      <span className="hidden sm:inline">· {keyEx.name.toLowerCase()}</span>
                    </div>
                    {(() => {
                      const line = stopLine(stopById.get(step.id), STEPS[step.order + 1] && stopById.get(STEPS[step.order + 1].id))
                      return line ? (
                        <div className={`text-[12px] leading-snug tnum ${isCurrent ? 'text-accent-text' : 'text-ink3'}`}>{line}</div>
                      ) : null
                    })()}
                  </div>
                </div>
                <Icon name="chevronR" size={17} className="shrink-0 text-ink3" />
              </button>
            )
          })}
        </div>
      </div>

      {ladder ? <LadderCard status={ladder} skill={viewSkill} /> : null}

      <Modal open={adding} onClose={() => setAdding(false)} label="Add a skill" wide>
        {adding ? (
          <AddSkill
            onClose={() => setAdding(false)}
            onAdded={(skill) => {
              setAdding(false)
              setPickedSkill(skill)
            }}
          />
        ) : null}
      </Modal>

      {/* Detail modal */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        label={detail ? `${detail.name} progression details` : 'Progression details'}
        wide
      >
        {detail ? <StepDetail step={detail} onClose={() => setDetail(null)} startWorkout={startWorkout} /> : null}
      </Modal>
    </div>
  )
}

function StepDetail({
  step,
  onClose,
  startWorkout,
}: {
  step: StepDef
  onClose: () => void
  startWorkout: (request: WorkoutRequest) => void
}) {
  const { state: whole, dispatch } = useStore()
  // The step's own road: the same athlete, read as the skill this step belongs to.
  const state = useMemo(() => viewForStep(whole, step.id), [whole, step.id])
  const skillDef = SKILLS[step.skill]
  const road = stepsOf(step.skill)
  // Decided now, so the button never offers a test today's readiness rules out.
  const testBlocked = useMemo(() => challengeBlockedReason(buildPlan(state)), [state])
  const unlocked = state.unlocked.includes(step.id)
  const isCurrent = state.stepId === step.id
  const pr = state.prs[step.keyExerciseId]
  const keyEx = EXERCISE_BY_ID[step.keyExerciseId]
  const [skipStage, setSkipStage] = useState<0 | 1 | 2 | 3>(0)
  const [skipAcknowledged, setSkipAcknowledged] = useState(false)

  if (skipStage > 0) {
    return (
      <SkipStepFlow
        step={step}
        stage={skipStage as 1 | 2 | 3}
        acknowledged={skipAcknowledged}
        setAcknowledged={setSkipAcknowledged}
        setStage={setSkipStage}
        onCancel={() => {
          setSkipAcknowledged(false)
          setSkipStage(0)
        }}
        onConfirm={() => {
          dispatch({ type: 'SKIP_TO_STEP', stepId: step.id })
          pushToast(`Moved to ${step.name}. Verified progress was left unchanged.`, 'success', 5000)
          onClose()
        }}
      />
    )
  }

  return (
    <div className="p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-5 pr-10">
        <Figure step={step.id} tone="accent" className="h-24 w-28 text-ink" />
        <div>
          <div className="text-[12.5px] font-semibold uppercase tracking-wider text-accent-text">
            {step.skill === 'planche' ? '' : `${skillDef.name} · `}Step {step.order + 1} of {road.length}
          </div>
          <h2 className="font-display text-[26px] font-bold text-ink">{step.name}</h2>
          <div className="text-[14px] text-ink2">{step.tagline}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
        <span className="rounded-full border border-line bg-raised px-3 py-1.5 text-ink2">
          Key hold: <span className="font-medium text-ink">{keyEx.name}</span>
        </span>
        <span className="rounded-full border border-line bg-raised px-3 py-1.5 text-ink2 tnum">
          Unlock bar: <span className="font-medium text-ink">{step.unlockSec}s</span>
          {step.repeatDays && step.repeatDays > 1 ? ` on ${step.repeatDays} separate days` : ''}
        </span>
        <span className="rounded-full border border-line bg-raised px-3 py-1.5 text-ink2 tnum">
          Your best:{' '}
          <span className="font-medium text-ink">{pr ? `${fmtHold(pr.value)} (${fmtDate(pr.at)})` : '—'}</span>
        </span>
      </div>

      <MilestoneClips stepId={step.id} />

      <p className="mt-4 text-[14.5px] leading-relaxed text-ink2">{step.description}</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-raised p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ok-text">
            <Icon name="check" size={14} /> Form checklist
          </div>
          <ul className="space-y-1.5 text-[13.5px] leading-relaxed text-ink2">
            {step.formChecks.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink3" />
                {c}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-raised p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-danger-text">
            <Icon name="x" size={14} /> Common mistakes
          </div>
          <ul className="space-y-1.5 text-[13.5px] leading-relaxed text-ink2">
            {step.mistakes.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink3" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-accent/25 bg-accent-soft p-4">
        <div className="text-[13px] font-semibold text-accent-text">Why it matters</div>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink">{step.whyItMatters}</p>
        <div className="mt-2.5 text-[13px] text-ink2">
          <span className="font-semibold text-ink">Suggested dose:</span> {step.scheme}
        </div>
        {EXERCISE_BY_ID[twinOf(step.id) ?? ''] ? (
          <div className="mt-1.5 text-[13px] text-ink2">
            <span className="font-semibold text-ink">
              {step.skill === 'planche' ? 'Its push-up version:' : 'Its moving version:'}
            </span>{' '}
            {EXERCISE_BY_ID[twinOf(step.id) ?? '']?.name}
            {' — '}
            {step.skill === 'planche'
              ? 'trained after the main holds at every level, alongside pseudo planche push-ups and leans.'
              : `the ${skillDef.words.strength} that shares this shape, trained after the main holds.`}
          </div>
        ) : null}
      </div>

      {isCurrent ? (
        <div className="mt-4">
          <BridgeCard state={state} stepId={step.id} />
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2.5">
        {isCurrent ? (
          testBlocked ? (
            <p className="w-full rounded-xl border border-line bg-raised px-4 py-3 text-[13.5px] leading-relaxed text-ink2">
              No max test today — {testBlocked}. It comes back on a day you can test fresh.
            </p>
          ) : (
            <button
              onClick={() => {
                onClose()
                startWorkout({ source: 'test', stepId: step.id })
              }}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-3 font-display text-[15px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
              style={{ background: 'var(--t-btn-accent)' }}
            >
              <Icon name="target" size={16} /> Take the max test
            </button>
          )
        ) : unlocked ? (
          <button
            onClick={() => {
              dispatch({ type: 'SET_STEP', stepId: step.id })
              pushToast(`Current step set to ${step.name}.`, 'success')
              onClose()
            }}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 font-display text-[15px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            <Icon name="check" size={16} /> Make this my current step
          </button>
        ) : (
          <div className="w-full space-y-2.5">
            <div className="flex items-center gap-2 rounded-xl border border-line bg-raised px-4 py-3 text-[13.5px] text-ink2">
              <Icon name="lock" size={15} className="text-ink3" />
              Unlocks automatically at{' '}
              {(() => {
                const prev = stepBefore(step.id)
                return prev ? (
                  <span>
                    <span className="font-semibold text-ink tnum">{prev.unlockSec}s</span>{' '}
                    {EXERCISE_BY_ID[prev.keyExerciseId].name.toLowerCase()}
                  </span>
                ) : null
              })()}
            </div>
            <button
              onClick={() => setSkipStage(1)}
              className="inline-flex items-center gap-2 rounded-xl border border-accent/35 bg-accent-soft px-5 py-3 font-display text-[14.5px] font-semibold text-accent-text transition hover:border-accent/60"
            >
              <Icon name="skip" size={16} /> Skip ahead to {step.name}
            </button>
            <p className="text-[12.5px] leading-relaxed text-ink3">
              For athletes who already train this progression. Three confirmations appear before anything changes.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function SkipStepFlow({
  step,
  stage,
  acknowledged,
  setAcknowledged,
  setStage,
  onCancel,
  onConfirm,
}: {
  step: StepDef
  stage: 1 | 2 | 3
  acknowledged: boolean
  setAcknowledged: (value: boolean) => void
  setStage: (stage: 0 | 1 | 2 | 3) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="p-6 sm:p-8">
      <div className="pr-10 text-[12.5px] font-semibold uppercase tracking-wider text-accent-text">
        Safety check {stage} of 3
      </div>
      <div className="mt-4 flex items-center gap-4">
        <Figure step={step.id} className="h-20 w-24 shrink-0 text-ink" />
        <div>
          <div className="text-[13px] text-ink3">Jumping to</div>
          <h2 className="font-display text-[24px] font-bold text-ink">{step.name}</h2>
          <div className="text-[13.5px] text-ink2">{step.tagline}</div>
        </div>
      </div>

      {stage === 1 ? (
        <>
          <div className="mt-5 rounded-2xl border border-line bg-raised p-5">
            <h3 className="font-display text-[18px] font-semibold text-ink">This changes the plan, not your proof</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink2">
              The app will make {step.name} your current training step and make every earlier step selectable. It will
              not invent PRs, camera passes, verified unlock bars or achievement badges.
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink3">
              Earlier skills without qualifying filmed holds will say available, not cleared.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button
              onClick={onCancel}
              className="rounded-xl border border-line bg-surface px-4 py-3 text-[14px] font-medium text-ink2"
            >
              Back to step details
            </button>
            <button
              onClick={() => setStage(2)}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 font-display text-[14.5px] font-semibold text-on-accent"
            >
              I understand <Icon name="arrowR" size={15} />
            </button>
          </div>
        </>
      ) : null}

      {stage === 2 ? (
        <>
          <div className="mt-5 rounded-2xl border border-danger/30 bg-danger-soft p-5">
            <h3 className="font-display text-[18px] font-semibold text-ink">The loading jump is real</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink2">
              Each later shape on this road lengthens the lever, and the load on the arms and shoulders rises quickly
              with it. Choose this only if you can already enter the position deliberately, control the shape, and
              train it without joint pain. Otherwise, use the closest easier step.
            </p>
          </div>
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-raised p-4">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--t-accent)]"
            />
            <span className="text-[13.5px] leading-relaxed text-ink2">
              I understand this does not certify my form, and I will move back if the position causes wrist, elbow or
              shoulder pain.
            </span>
          </label>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button
              onClick={() => setStage(1)}
              className="rounded-xl border border-line bg-surface px-4 py-3 text-[14px] font-medium text-ink2"
            >
              Back
            </button>
            <button
              onClick={() => setStage(3)}
              disabled={!acknowledged}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 font-display text-[14.5px] font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue <Icon name="arrowR" size={15} />
            </button>
          </div>
        </>
      ) : null}

      {stage === 3 ? (
        <>
          <div className="mt-5 rounded-2xl border border-accent/30 bg-accent-soft p-5">
            <h3 className="font-display text-[18px] font-semibold text-ink">Make {step.name} current?</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink2">
              Generated sessions and the coach will switch immediately. Your existing history stays untouched, and
              you can return to any earlier step whenever you want.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button
              onClick={() => setStage(2)}
              className="rounded-xl border border-line bg-surface px-4 py-3 text-[14px] font-medium text-ink2"
            >
              Back
            </button>
            <button
              onClick={onConfirm}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 font-display text-[14.5px] font-semibold text-on-accent shadow-card"
            >
              <Icon name="check" size={16} /> Yes — move me to {step.name}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

/**
 * A skill's rep line — the handstand push-up, the 90° push-up — as its own
 * small road. It moves on its own standards, beside the holds, and the card
 * says exactly what opens the next rung.
 */
function LadderCard({ status, skill }: { status: LadderStatus; skill: SkillId }) {
  const { ladder, rungs, index, verifiedBest, loggedBest, waitingOn } = status
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-card" aria-labelledby="rep-ladder">
      <h2 id="rep-ladder" className="font-display text-[18px] font-semibold text-ink">
        {ladder.name}
      </h2>
      <p className="mt-0.5 text-[13px] leading-relaxed text-ink2">
        Works up to {ladder.summit}. This line moves on its own standards, beside the {SKILLS[skill].holdName} holds
        rather than behind them.
      </p>
      <ol className="mt-3 space-y-2">
        {rungs.map((rung, i) => {
          const done = i < index
          const current = i === index
          const exercise = EXERCISE_BY_ID[rung.exerciseId]
          const share = current ? Math.min(1, verifiedBest / rung.standardReps) : 0
          return (
            <li
              key={rung.exerciseId}
              aria-current={current ? 'step' : undefined}
              className={`rounded-xl border p-3 ${current ? 'border-accent/40 bg-accent-soft' : 'border-line bg-raised'} ${
                !done && !current ? 'opacity-70' : ''
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-[12px] font-bold tnum ${
                    done
                      ? 'border-ok bg-ok-soft text-ok-text'
                      : current
                        ? 'border-accent bg-surface text-accent-text'
                        : 'border-line text-ink3'
                  }`}
                >
                  {done ? <Icon name="check" size={13} strokeWidth={2.5} /> : current ? i + 1 : <Icon name="lock" size={12} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-ink">{exercise?.name ?? rung.exerciseId}</div>
                  <div className="text-[12px] text-ink3 tnum">
                    {i < rungs.length - 1
                      ? `Opens the next rung at ${rung.standardReps} full rep${rung.standardReps === 1 ? '' : 's'} in one set`
                      : `The top of the line: ${rung.standardReps} full rep${rung.standardReps === 1 ? '' : 's'}`}
                  </div>
                </div>
                {current ? (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-on-accent">
                    current
                  </span>
                ) : null}
              </div>
              {current ? (
                <div className="mt-2.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div className={`h-full rounded-full ${share >= 1 ? 'bg-ok' : 'bg-accent'}`} style={{ width: `${share * 100}%` }} />
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed text-ink2 tnum">
                    {verifiedBest} of {rung.standardReps} verified in one set
                    {loggedBest > verifiedBest ? ` · ${loggedBest} logged without the full evidence` : ''}
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink3">{rung.why}</p>
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
      {waitingOn ? (
        <p className="mt-3 rounded-xl border border-line bg-raised px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
          You have met this rung’s standard. The next one waits for{' '}
          <span className="font-semibold text-ink">{STEP_BY_ID[waitingOn].name}</span> on the hold road — a push-up is not
          trained in a balance you do not have yet.
        </p>
      ) : null}
      <p className="mt-3 text-[12px] leading-relaxed text-ink3">
        A rung opens on one filmed set of the reps shown that you rate Clean and check on the replay: every rep to the
        bottom, every rep locked out, none kipped. Reps typed in afterwards, light-day sets and assisted sets do not move
        it. {ladder.sourcing}
      </p>
    </section>
  )
}
