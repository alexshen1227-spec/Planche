import { GymHub } from '../components/gym/GymHub'
import { TodayPlanCard, type GymPreset } from '../components/plan/TodayPlanCard'
import { useMemo, useState } from 'react'
import type { AssistType, Section, Session, SetLog, SkillId, TrainingSurface, Workout, WorkoutRequest } from '../types'
import { useStore } from '../lib/store'
import {
  TEMPLATES,
  templatesFor,
  describeBlock,
  describeTarget,
  primaryTargetBlock,
  countRounds,
  challengeBlockedReason,
  finalizeFromPlan,
  isPainSafe,
  isRecommendedRequest,
  planForToday,
} from '../data/workouts'
import { missingKit, SKILLS } from '../data/skills'
import {
  activeSkills,
  assistAppliesTo,
  isSkillHold,
  isSurfaceAware,
  sessionSkillSteps,
  stepOfSkill,
} from '../lib/skills'
import { EXERCISES, EXERCISE_BY_ID, CATEGORY_LABEL } from '../data/exercises'
import { STEP_BY_ID } from '../data/progressions'
import { applySession } from '../lib/engine'
import { pushToast } from '../lib/toast'
import { confetti } from '../lib/confetti'
import { sfx } from '../lib/audio'
import { fmtHold } from '../lib/time'
import { Icon } from '../components/Icon'
import { MainTarget, Modal, SectionTitle } from '../components/ui'
import { defaultSurface, surfaceLabel, TRAINING_SURFACES } from '../data/equipment'
import { recordForSurface } from '../lib/records'
import { STRATEGY_BY_ID } from '../lib/coach'
import { useToday } from '../lib/useToday'
import { ASSIST_LABEL } from '../components/SetupRow'
import { WeekPlanCard } from '../components/WeekPlanCard'
import { Button, SegmentedControl } from '../components/ds'

const SECTION_LABEL: Record<Section, string> = {
  warmup: 'Warm-up',
  main: 'Main',
  strength: 'Strength',
  core: 'Core',
  cooldown: 'Cooldown',
}

function WorkoutTarget({ workout }: { workout: Workout }) {
  const target = primaryTargetBlock(workout)
  if (!target) return null
  return (
    <MainTarget
      name={EXERCISE_BY_ID[target.exerciseId].name}
      target={describeTarget(target)}
      detail={describeBlock(target)}
    />
  )
}

/** Request identity for the preview, so a fresh decision is made per card. */
function requestKey(request: WorkoutRequest): string {
  return `${request.source}:${request.templateId ?? ''}:${request.stepId ?? ''}:${request.minutes ?? ''}:${(request.skills ?? []).join('+')}`
}

function SkillsTrain({ startWorkout }: { startWorkout: (request: WorkoutRequest) => void }) {
  const { state } = useStore()
  const [previewRequest, setPreviewRequest] = useState<WorkoutRequest | null>(null)
  const [quickLog, setQuickLog] = useState(false)
  const todayKey = useToday()

  // One plan for every card on the screen, decided for today. Each card shows
  // what would actually run — after equipment, readiness and capacity — not
  // the template as written.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planForToday(state, Date.now()), [state, todayKey])
  // The skills the athlete trains, and which of them can train with the kit
  // listed: a skill waiting for a bar is not offered a session.
  const skills = activeSkills(state)
  const trainable = skills.filter((skill) => missingKit(skill, state.profile.equipment).length === 0)
  const [testPick, setTestPick] = useState<SkillId | null>(null)
  const testSkill: SkillId = testPick && trainable.includes(testPick) ? testPick : (trainable[0] ?? skills[0])
  const [mix, setMix] = useState<SkillId[]>([])
  const mixed = mix.filter((skill) => trainable.includes(skill))
  const finalized = useMemo(() => {
    const now = Date.now()
    const build = (request: WorkoutRequest) => finalizeFromPlan(state, request, plan, now).workout
    return {
      today: build({ source: 'auto' }),
      templates: new Map(TEMPLATES.map((t) => [t.id, build({ source: 'template', templateId: t.id })])),
      build,
    }
  }, [state, plan])
  const today = finalized.today
  // What the recommended session trains once the rails have run — none of the
  // skills on a pain-safe day — for the week card's sentence about today.
  const todaySkills = isPainSafe(today) ? [] : (today.lineup?.map((entry) => entry.skill) ?? today.skills)
  const testBlocked = challengeBlockedReason(plan)
  const preview: Workout | null = useMemo(
    () =>
      previewRequest
        ? // Only the plain recommended request may reuse the session built for
          // the card above. Anything chosen — skills, a time budget — is built
          // from the request itself, the same way Start builds it.
          isRecommendedRequest(previewRequest)
          ? finalized.today
          : previewRequest.source === 'template' && previewRequest.templateId
            ? (finalized.templates.get(previewRequest.templateId) ?? finalized.build(previewRequest))
            : finalized.build(previewRequest)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewRequest && requestKey(previewRequest), finalized],
  )
  const step = STEP_BY_ID[stepOfSkill(state, testSkill)]

  return (
    <div className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-bold text-ink">Train</h1>
          <p className="mt-0.5 text-body text-ink2">Guided sessions with timers, rest and automatic logging.</p>
        </div>
        <button
          onClick={() => setQuickLog(true)}
          className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-4 py-2.5 text-body font-medium text-ink2 transition hover:border-line-strong hover:text-ink"
        >
          <Icon name="plus" size={15} /> Quick log a set
        </button>
      </div>

      {/* Recommended */}
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <button
          onClick={() => setPreviewRequest({ source: 'auto' })}
          className="card-int card-sheen group relative overflow-hidden rounded-card border border-accent/25 bg-surface p-6 text-left shadow-card hover:border-accent/50 lg:col-span-2"
        >
          <div className="pointer-events-none absolute -right-8 -top-12 h-44 w-44 rounded-full bg-accent-soft blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-footnote font-semibold uppercase tracking-wider text-accent-text">
              <Icon name="bolt" size={14} /> Recommended today
            </div>
            <div className="mt-1.5 font-display text-[22px] font-bold text-ink">{today.name}</div>
            <p className="mt-1 max-w-lg text-body leading-relaxed text-ink2">{today.focus}</p>
            {today.lineup && today.lineup.length > 1 ? (
              <ul className="mt-2 max-w-lg space-y-1">
                {today.lineup.map((entry) => (
                  <li key={entry.skill} className="text-footnote leading-relaxed text-ink3">
                    <span className="font-semibold text-ink2">{SKILLS[entry.skill].name}</span> — {entry.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2 text-footnote text-ink2">
              {today.strategy ? (
                <span className="rounded-full border border-accent/30 bg-accent-soft px-3 py-1 font-semibold text-accent-text">
                  {STRATEGY_BY_ID[today.strategy].name}
                </span>
              ) : null}
              <span className="rounded-full border border-line bg-raised px-3 py-1 tnum">~{today.minutes} min</span>
              <span className="rounded-full border border-line bg-raised px-3 py-1 tnum">
                {countRounds(today.blocks)} sets
              </span>
              {[...new Set(today.blocks.map((b) => b.section))].map((s) => (
                <span key={s} className="rounded-full border border-line bg-raised px-3 py-1">
                  {SECTION_LABEL[s]}
                </span>
              ))}
            </div>
          </div>
        </button>
        <div className="card-int group rounded-card border border-line bg-surface p-6 text-left shadow-card">
          <div className="flex items-center gap-2 text-footnote font-semibold uppercase tracking-wider text-ink3">
            <Icon name="target" size={14} /> Test day
          </div>
          {trainable.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Skill to test">
              {trainable.map((skill) => (
                <button
                  key={skill}
                  aria-pressed={skill === testSkill}
                  onClick={() => setTestPick(skill)}
                  className={`min-h-11 rounded-full border px-3 py-1 text-footnote font-semibold transition ${
                    skill === testSkill ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2 hover:text-ink'
                  }`}
                >
                  {SKILLS[skill].short}
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-1.5 font-display text-[22px] font-bold text-ink">Max Test</div>
          <p className="mt-1 text-body leading-relaxed text-ink2">
            {EXERCISE_BY_ID[step.keyExerciseId].perSide ? 'Two fresh attempts per side' : 'Three fresh attempts'} at
            the {EXERCISE_BY_ID[step.keyExerciseId].name.toLowerCase()}. A verified{' '}
            <span className="font-semibold text-ink tnum">{step.unlockSec}s</span> unlocks the next step.
          </p>
          {testBlocked ? (
            <p className="mt-3 text-footnote leading-relaxed text-ink3">Not today — {testBlocked}.</p>
          ) : (
            <button
              onClick={() => setPreviewRequest({ source: 'test', stepId: step.id })}
              className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line bg-raised px-3.5 py-2 text-body font-medium text-accent-text transition hover:border-line-strong"
            >
              Test yourself <Icon name="arrowR" size={15} />
            </button>
          )}
        </div>
      </div>

      {/* The athlete's own week — which day is for which skill — above the
          one-off choice of skills for today. */}
      <WeekPlanCard className="mt-4" sessionSkills={todaySkills} />

      {trainable.length > 1 ? (
        <>
          <SectionTitle>Choose today's skills</SectionTitle>
          <div className="rounded-inner border border-line bg-surface p-5 shadow-card">
            <p className="text-footnote leading-relaxed text-ink2">
              The recommended session picks these for you by priority and by what has gone longest untrained. To
              train something else today, pick it here — one skill for a session built around it, or several in the
              order you tap them.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Skills for a session of your own">
              {trainable.map((skill) => {
                const position = mixed.indexOf(skill)
                const on = position >= 0
                return (
                  <button
                    key={skill}
                    aria-pressed={on}
                    onClick={() => setMix((current) => (on ? current.filter((id) => id !== skill) : [...current, skill]))}
                    className={`min-h-11 rounded-full border px-3.5 py-1.5 text-footnote font-semibold transition ${
                      on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2 hover:text-ink'
                    }`}
                  >
                    {on ? `${position + 1}. ` : ''}
                    {SKILLS[skill].name}
                  </button>
                )
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                onClick={() => setPreviewRequest({ source: 'auto', skills: mixed })}
                disabled={mixed.length === 0}
                className="inline-flex min-h-11 items-center gap-2 disabled:opacity-40"
              >
                <Icon name="play" size={15} /> Preview this session
              </Button>
              <span className="text-footnote leading-relaxed text-ink3">
                {mixed.length === 0
                  ? 'Nothing picked.'
                  : mixed.length === 1
                    ? `${SKILLS[mixed[0]].name} on its own — the full session for that skill.`
                    : `${SKILLS[mixed[0]].name} leads; the rest follow in the order picked.`}
              </span>
            </div>
            {skills.length > trainable.length ? (
              <p className="mt-3 text-footnote leading-relaxed text-ink3">
                Not listed: {skills.filter((skill) => !trainable.includes(skill)).map((skill) => SKILLS[skill].name).join(', ')} —
                waiting for kit. Add it under Settings → Equipment.
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <SectionTitle>Focused sessions</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templatesFor(state).map((t) => {
          const built = finalized.templates.get(t.id) ?? t
          const changed = Boolean(built.adjustments?.length) || built.id !== t.id
          return (
            <button
              key={t.id}
              onClick={() => setPreviewRequest({ source: 'template', templateId: t.id })}
              className="card-int rounded-inner border border-line bg-surface p-5 text-left shadow-card"
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-display text-title3 font-semibold text-ink">{t.name}</div>
                <div className="shrink-0 text-footnote text-ink3 tnum">~{built.minutes} min</div>
              </div>
              <p className="mt-1 text-footnote leading-relaxed text-ink2">{t.focus}</p>
              {changed ? (
                <p className="mt-1.5 text-caption font-medium text-accent-text">Adjusted for today — see preview</p>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* Workout preview */}
      <Modal
        open={preview !== null}
        onClose={() => setPreviewRequest(null)}
        label={preview ? `${preview.name} workout preview` : 'Workout preview'}
        wide
      >
        {preview ? (
          <div className="p-6 sm:p-7">
            <div className="pr-10">
              <h2 className="font-display text-[22px] font-bold text-ink">{preview.name}</h2>
              <p className="mt-1 text-body text-ink2">{preview.focus}</p>
              {preview.lineup && preview.lineup.length > 1 ? (
                <ul className="mt-2 space-y-1">
                  {preview.lineup.map((entry) => (
                    <li key={entry.skill} className="text-footnote leading-relaxed text-ink3">
                      <span className="font-semibold text-ink2">{SKILLS[entry.skill].name}</span> — {entry.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-2 text-footnote text-ink3 tnum">
                ~{preview.minutes} min · {countRounds(preview.blocks)} sets
              </div>
            </div>
            {preview.adjustments?.length ? (
              <div className="mt-3 rounded-inner border border-accent/30 bg-accent-soft px-4 py-3">
                <div className="text-caption font-bold uppercase tracking-wider text-accent-text">Adjusted for today</div>
                <ul className="mt-1 space-y-1 text-footnote leading-relaxed text-ink">
                  {preview.adjustments.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <WorkoutTarget workout={preview} />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {[...new Set(preview.blocks.map((b) => b.section))].map((sec) => (
                <div key={sec} className="rounded-inner border border-line bg-raised p-4">
                  <div className="mb-2 text-caption font-semibold uppercase tracking-wide text-ink3">
                    {SECTION_LABEL[sec]}
                  </div>
                  <div className="space-y-1.5">
                    {preview.blocks
                      .filter((b) => b.section === sec)
                      .map((b, i) => {
                        const ex = EXERCISE_BY_ID[b.exerciseId]
                        const owner = (preview.skills?.length ?? 1) > 1 && sec !== 'warmup' && sec !== 'cooldown' ? b.skill : undefined
                        return (
                          <div key={i} className="flex items-baseline justify-between gap-3 text-body">
                            <span className="text-ink">
                              {ex.name}
                              {owner ? (
                                <span className="ml-2 whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-caption font-medium text-ink3">
                                  {SKILLS[owner].short}
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-ink2 tnum">{describeBlock(b)}</span>
                          </div>
                        )
                      })}
                  </div>
                </div>
              ))}
            </div>
            <Button size="lg"
              onClick={() => {
                const request = previewRequest
                setPreviewRequest(null)
                // The request, not this preview: the session is decided again
                // at the moment it starts, with whatever is true then.
                if (request) startWorkout(request)
              }}
              className="mt-5 flex w-full items-center justify-center gap-2 "
            >
              <Icon name="play" size={17} /> Start
            </Button>
          </div>
        ) : null}
      </Modal>

      <QuickLogModal
        key={state.stepId}
        open={quickLog}
        onClose={() => setQuickLog(false)}
        onSaved={() => setQuickLog(false)}
      />
      <div className="mt-8 rounded-inner border border-line bg-surface/60 p-4 text-footnote leading-relaxed text-ink3">
        <span className="font-semibold text-ink2">Safety note:</span> prepare before loading, keep most holds a little
        shy of failure, and back off at the first sign of elbow or wrist pain — coaching conventions rather than tested
        rules. This app is a training log, not medical advice.
      </div>
    </div>
  )
}

function QuickLogModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { state, dispatch } = useStore()
  // Training done away from the app is almost always the step's own hold, so
  // that is where the picker starts, at the athlete's best rather than a
  // number that fits a lean and nothing above it.
  const startValue = (id: string) => {
    const best = state.prs[id]?.value
    return best !== undefined && best > 0 ? Math.max(1, Math.round(best)) : EXERCISE_BY_ID[id].type === 'hold' ? 10 : 8
  }
  const [exerciseId, setExerciseId] = useState(
    () => STEP_BY_ID[stepOfSkill(state, activeSkills(state)[0])]?.keyExerciseId ?? 'planche-lean',
  )
  const [value, setValue] = useState(() => startValue(exerciseId))
  const [surface, setSurface] = useState<TrainingSurface>(() =>
    defaultSurface(state.profile.equipment, state.profile.preferredSurface),
  )
  const [side, setSide] = useState<'left' | 'right' | null>(null)
  const [assist, setAssist] = useState<AssistType | null>(null)
  const ex = EXERCISE_BY_ID[exerciseId]
  const surfaceAware = isSurfaceAware(ex)
  /** Assistance matters only where it changes what a hold proves. */
  const assistAware = assistAppliesTo(ex)
  // A one-sided value without a side cannot be compared with anything, and
  // used to be filed as if it were both.
  const needsSide = Boolean(ex.perSide)
  const currentBest = surfaceAware
    ? recordForSurface(state.prs[exerciseId], surface)?.value
    : state.prs[exerciseId]?.value

  const save = () => {
    const now = Date.now()
    const session: Session = {
      id: crypto.randomUUID(),
      startedAt: now,
      endedAt: now,
      workoutName: 'Quick Log',
      workoutKind: 'auto',
      stepId: state.stepId,
      // The step every other skill was on, so the set is read on the right road.
      ...(Object.keys(sessionSkillSteps(state)).length ? { skills: sessionSkillSteps(state) } : {}),
      sets: [
        {
          exerciseId,
          kind: ex.type,
          value,
          target: value,
          section: 'main',
          at: now,
          ...(surfaceAware ? { surface } : {}),
          ...(needsSide && side ? { side } : {}),
          ...(assistAware && assist ? { assist } : {}),
          // Typed in by hand: an estimate, not a timer reading.
          ...(ex.type === 'hold' ? { timing: { method: 'edited' as const } } : {}),
        } satisfies SetLog,
      ],
    }
    const { events } = applySession(state, session)
    dispatch({ type: 'SAVE_SESSION', session })
    const pr = events.prs.find(
      (record) =>
        record.exerciseId === exerciseId &&
        (record.previous !== undefined || isSkillHold(EXERCISE_BY_ID[record.exerciseId])),
    )
    if (pr) {
      sfx.pr()
      confetti(1)
      pushToast(
        `New PR — ${ex.name} ${ex.type === 'hold' ? fmtHold(value) : `${value} reps`}${
          surfaceAware ? ` on ${surfaceLabel(surface).toLowerCase()}` : ''
        }!`,
        'pr',
      )
    } else {
      pushToast('Set logged.', 'success')
    }
    if (events.unlockedStep) {
      confetti(2)
      pushToast(`Unlocked: ${STEP_BY_ID[events.unlockedStep].name}!`, 'pr', 5000)
    }
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} label="Quick log a set">
      <div className="p-6">
        <h2 className="font-display text-[20px] font-bold text-ink">Quick log</h2>
        <p className="mt-1 text-footnote text-ink2">Trained outside the app? Log a single best set here.</p>
        <label className="mt-4 block text-footnote font-medium text-ink2">
          Exercise
          <select
            value={exerciseId}
            onChange={(e) => {
              setExerciseId(e.target.value)
              setValue(startValue(e.target.value))
              setSide(null)
              setAssist(null)
            }}
            className="mt-1.5 w-full rounded-control border border-line bg-raised px-3.5 py-3 text-body text-ink outline-none focus:border-accent"
          >
            {Object.entries(CATEGORY_LABEL).map(([cat, label]) => (
              <optgroup key={cat} label={label}>
                {EXERCISES.filter((e) => e.category === cat).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {surfaceAware ? (
          <div className="mt-4">
            <div className="text-footnote font-medium text-ink2">Surface</div>
            <div className="mt-1.5 flex overflow-hidden rounded-control border border-line" role="group" aria-label="Surface">
              {TRAINING_SURFACES.map((item) => {
                const disabled = item.id === 'parallettes' && !state.profile.equipment.includes('parallettes')
                return (
                  <button
                    key={item.id}
                    onClick={() => setSurface(item.id)}
                    disabled={disabled}
                    aria-pressed={surface === item.id}
                    className={`min-h-11 flex-1 px-3 py-2.5 text-footnote font-medium transition disabled:opacity-35 ${
                      surface === item.id ? 'bg-accent text-on-accent' : 'bg-raised text-ink2'
                    }`}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
        {needsSide ? (
          <div className="mt-4">
            <div className="text-footnote font-medium text-ink2" id="ql-side">
              Which side?
            </div>
            <div className="mt-1.5 flex overflow-hidden rounded-control border border-line" role="group" aria-labelledby="ql-side">
              {(['left', 'right'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  aria-pressed={side === s}
                  className={`min-h-11 flex-1 px-3 py-2.5 text-footnote font-medium capitalize transition ${
                    side === s ? 'bg-accent text-on-accent' : 'bg-raised text-ink2'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {assistAware ? (
          <div className="mt-4">
            <div className="text-footnote font-medium text-ink2" id="ql-assist">
              Any assistance? <span className="font-normal text-ink3">(optional)</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby="ql-assist">
              {(['none', 'band', 'feet', 'partner', 'other'] as AssistType[]).map((id) => (
                <button
                  key={id}
                  onClick={() => setAssist(assist === id ? null : id)}
                  aria-pressed={assist === id}
                  className={`min-h-11 rounded-full border px-3 py-1.5 text-footnote font-medium transition ${
                    assist === id ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2'
                  }`}
                >
                  {ASSIST_LABEL[id]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-4">
          <div className="text-footnote font-medium text-ink2">{ex.type === 'hold' ? 'Hold (seconds)' : 'Reps'}</div>
          <div className="mt-2 flex items-center justify-center gap-4">
            <button
              onClick={() => setValue((v) => Math.max(1, v - 1))}
              aria-label="Decrease"
              className="grid h-12 w-12 place-items-center rounded-control border border-line bg-surface text-ink hover:border-line-strong"
            >
              <Icon name="minus" size={18} />
            </button>
            <div className="w-24 text-center font-display text-[44px] font-bold text-ink tnum">{value}</div>
            <button
              onClick={() => setValue((v) => v + 1)}
              aria-label="Increase"
              className="grid h-12 w-12 place-items-center rounded-control border border-line bg-surface text-ink hover:border-line-strong"
            >
              <Icon name="plus" size={18} />
            </button>
          </div>
          {currentBest !== undefined ? (
            <div className="mt-1 text-center text-footnote text-ink3 tnum">
              {surfaceAware ? `${surfaceLabel(surface)} best` : 'current best'}{' '}
              {ex.type === 'hold' ? fmtHold(currentBest) : currentBest}
            </div>
          ) : null}
        </div>
        <p className="mt-3 text-caption leading-relaxed text-ink3">
          A hand-logged value counts toward your records and history, but not toward unlocking a step — that needs a
          filmed, confirmed hold.
        </p>
        <Button size="lg"
          onClick={save}
          disabled={needsSide && !side}
          className="mt-3 w-full disabled:opacity-40"
        >
          {needsSide && !side ? 'Pick a side to save' : 'Save'}
        </Button>
      </div>
    </Modal>
  )
}

const TRAIN_MODE_KEY = 'planchelab.trainMode'

/**
 * Train: skills and gym side by side (Fitness Lab). The skill side is the
 * coach's session exactly as before; the gym side builds from the place the
 * athlete is at. Which one shows is remembered per device.
 */
export function Train({ startWorkout }: { startWorkout: (request: WorkoutRequest) => void }) {
  const [mode, setMode] = useState<'skills' | 'gym'>(() => {
    try {
      return localStorage.getItem(TRAIN_MODE_KEY) === 'gym' ? 'gym' : 'skills'
    } catch {
      return 'skills'
    }
  })
  const [gymPreset, setGymPreset] = useState<GymPreset | null>(null)
  const choose = (m: 'skills' | 'gym') => {
    setMode(m)
    try {
      localStorage.setItem(TRAIN_MODE_KEY, m)
    } catch {
      // A per-device convenience only.
    }
  }
  return (
    <div>
      <TodayPlanCard
        startWorkout={startWorkout}
        onStartGym={(preset) => {
          choose('gym')
          setGymPreset(preset)
        }}
      />
      <SegmentedControl
        className="mx-auto mb-5 max-w-sm"
        label="What to train"
        value={mode}
        onChange={choose}
        options={[
          { value: 'skills', label: 'Skills' },
          { value: 'gym', label: 'Gym' },
        ]}
      />
      {mode === 'skills' ? <SkillsTrain startWorkout={startWorkout} /> : <GymHub preset={gymPreset} onPresetUsed={() => setGymPreset(null)} />}
    </div>
  )
}
