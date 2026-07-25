import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { EXERCISES, EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID, STEPS } from '../data/progressions'
import { ACHIEVEMENTS } from '../data/achievements'
import { bestSeries, weeklyVolume, totalHoldSec, totalSets, sessionHoldSec } from '../lib/stats'
import { armStats, STRATEGY_BY_ID, formatRate, buildPlan } from '../lib/coach'
import { diagnose, weakLinks } from '../lib/diagnose'
import { fmtWeight } from '../lib/units'
import { lastOf } from '../components/MeasurePrompt'
import { fmtDate, fmtTime, fmtDuration, fmtHold, fmtClock } from '../lib/time'
import { HoldLineChart, VolumeBarChart, TrainingHeatmap } from '../components/charts'
import { Icon } from '../components/Icon'
import { Modal, SectionTitle, Stat } from '../components/ui'
import { pushToast } from '../lib/toast'

export function Stats() {
  const { state, dispatch } = useStore()
  const [chartEx, setChartEx] = useState(() => STEP_BY_ID[state.stepId].keyExerciseId)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const series = useMemo(() => bestSeries(state, chartEx), [state, chartEx])
  const arms = useMemo(() => armStats(state), [state])
  const coachPick = useMemo(() => buildPlan(state), [state])
  const bestArm = useMemo(() => [...arms].filter((a) => a.n > 0).sort((a, b) => b.mean - a.mean)[0], [arms])
  const maxArmRate = useMemo(() => Math.max(0.001, ...arms.map((a) => Math.abs(a.secPerWeek))), [arms])
  const diag = useMemo(() => diagnose(state), [state])
  const links = useMemo(() => weakLinks(state), [state])
  const weightNow = useMemo(() => lastOf(state, 'weightKg'), [state])
  const volume = useMemo(() => weeklyVolume(state, 12), [state])
  const sessions = useMemo(() => [...state.sessions].sort((a, b) => b.startedAt - a.startedAt), [state.sessions])

  const holdExercises = EXERCISES.filter((e) => e.type === 'hold')
  const chartStep = STEPS.find((s) => s.keyExerciseId === chartEx)
  const trackedPrs = useMemo(
    () =>
      Object.entries(state.prs)
        .map(([id, pr]) => ({ ex: EXERCISE_BY_ID[id], pr }))
        .filter((x) => x.ex)
        .sort((a, b) => b.pr.at - a.pr.at),
    [state.prs],
  )

  const unlockedCount = Object.keys(state.achievements).length

  return (
    <div className="animate-rise">
      <h1 className="font-display text-[28px] font-bold text-ink">Progress</h1>
      <p className="mt-0.5 text-[14px] text-ink2">Charts, records, history and trophies.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sessions" value={<span className="tnum">{state.sessions.length}</span>} />
        <Stat label="Total sets" value={<span className="tnum">{totalSets(state)}</span>} />
        <Stat label="Time under tension" value={fmtDuration(totalHoldSec(state))} />
        <Stat
          label="Achievements"
          value={
            <span className="tnum">
              {unlockedCount}
              <span className="text-[15px] text-ink3">/{ACHIEVEMENTS.length}</span>
            </span>
          }
        />
      </div>

      {/* Hold trend */}
      <div className="mt-4 rounded-3xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-display text-[16px] font-semibold text-ink">Best hold per session</div>
            <div className="text-[13px] text-ink2">{EXERCISE_BY_ID[chartEx]?.name}</div>
          </div>
          <select
            value={chartEx}
            onChange={(e) => setChartEx(e.target.value)}
            className="rounded-xl border border-line bg-raised px-3 py-2 text-[13.5px] text-ink outline-none focus:border-accent"
          >
            {holdExercises.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3">
          <HoldLineChart points={series} goal={chartStep?.unlockSec} />
        </div>
      </div>

      {/* Weekly volume */}
      <div className="mt-4 rounded-3xl border border-line bg-surface p-5 shadow-card">
        <div className="font-display text-[16px] font-semibold text-ink">Weekly hold volume</div>
        <div className="text-[13px] text-ink2">Seconds accumulated in holds, last 12 weeks</div>
        <div className="mt-3">
          <VolumeBarChart weeks={volume} />
        </div>
      </div>

      {/* Plateau diagnostic */}
      <div className="mt-4 rounded-3xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-display text-[16px] font-semibold text-ink">Why am I stuck?</div>
          {diag.plateaued ? (
            <span className="rounded-full bg-danger-soft px-3 py-1 text-[12.5px] font-semibold text-danger">
              Flat ~{diag.weeksFlat} weeks
            </span>
          ) : (
            <span className="rounded-full bg-ok-soft px-3 py-1 text-[12.5px] font-semibold text-ok">Progressing</span>
          )}
        </div>
        <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink2">{diag.summary}</p>
        {diag.causes.length > 0 ? (
          <div className="mt-3 space-y-2">
            {diag.causes.map((c) => (
              <div key={c.id} className="rounded-2xl border border-line bg-raised p-3.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      c.severity === 'high' ? 'bg-danger' : c.severity === 'medium' ? 'bg-accent' : 'bg-ink3'
                    }`}
                  />
                  <span className="text-[14px] font-semibold text-ink">{c.title}</span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink2">{c.detail}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink">
                  <span className="font-medium text-accent">Do this:</span> {c.fix}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Weak links */}
      <div className="mt-4 rounded-3xl border border-line bg-surface p-5 shadow-card">
        <div className="font-display text-[16px] font-semibold text-ink">What is holding you back</div>
        <div className="max-w-2xl text-[13px] leading-relaxed text-ink2">
          The four qualities that most often cap a planche. Anything marked limiting is probably costing you more than
          extra planche practice would gain.
        </div>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {links.map((l) => (
            <div key={l.id} className="rounded-2xl border border-line bg-raised p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[14px] font-semibold text-ink">{l.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                    l.status === 'limiting'
                      ? 'bg-danger-soft text-danger'
                      : l.status === 'strong'
                        ? 'bg-ok-soft text-ok'
                        : l.status === 'adequate'
                          ? 'bg-accent-soft text-accent'
                          : 'bg-line text-ink3'
                  }`}
                >
                  {l.status}
                </span>
              </div>
              <div className="mt-1 text-[12.5px] text-ink2 tnum">
                {l.best === null ? 'Not tested yet' : `${Math.round(l.best)}${l.unit === 's' ? 's' : ' reps'}`}
                <span className="text-ink3">
                  {' '}
                  / {l.benchmark}
                  {l.unit === 's' ? 's' : ' reps'} target
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className={`h-full rounded-full ${
                    l.status === 'limiting' ? 'bg-danger' : l.status === 'strong' ? 'bg-ok' : 'bg-accent'
                  }`}
                  style={{ width: `${Math.min(100, (l.ratio ?? 0) * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink3">{l.what}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Bodyweight */}
      {weightNow ? (
        <div className="mt-4 rounded-3xl border border-line bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-display text-[16px] font-semibold text-ink">Bodyweight</div>
            <div className="text-[13px] text-ink2 tnum">
              Now {fmtWeight(weightNow.value, state.settings.units)}
            </div>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink2">
            Holding the same seconds at a heavier bodyweight is a strength gain — the coach reads your holds against
            this rather than in isolation.
          </p>
        </div>
      ) : null}

      {/* What the coach learned */}
      <div className="mt-4 rounded-3xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-display text-[16px] font-semibold text-ink">What your coach has learned</div>
            <div className="max-w-xl text-[13px] leading-relaxed text-ink2">
              It tries different ways of shaping your main sets, then measures how much your key hold actually moved by
              the next session. The fastest approach gets used most, and untested ones get their turn.
            </div>
          </div>
          <span className="rounded-full bg-accent-soft px-3 py-1 text-[12.5px] font-semibold text-accent">
            Today: {STRATEGY_BY_ID[coachPick.strategy].name}
          </span>
        </div>

        <div className="mt-4 space-y-2.5">
          {arms.map((a) => {
            const def = STRATEGY_BY_ID[a.id]
            const isBest = bestArm && a.id === bestArm.id && a.n > 0
            return (
              <div key={a.id} className="rounded-2xl border border-line bg-raised p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-ink">{def.name}</span>
                    {isBest ? (
                      <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ok">
                        fastest
                      </span>
                    ) : null}
                    {a.id === coachPick.strategy ? (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">
                        today
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[13px] font-medium text-ink2 tnum">
                    {a.n === 0 ? 'not tested yet' : `${formatRate(a.secPerWeek)} · ${a.n} session${a.n === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full rounded-full ${a.secPerWeek < 0 ? 'bg-danger/60' : isBest ? 'bg-ok' : 'bg-accent/60'}`}
                    style={{
                      width: `${a.n === 0 ? 0 : Math.max(3, (Math.abs(a.secPerWeek) / maxArmRate) * 100)}%`,
                    }}
                  />
                </div>
                <div className="mt-1.5 text-[12.5px] leading-relaxed text-ink3">{def.blurb}</div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 space-y-1 text-[12.5px] leading-relaxed text-ink3">
          <p>
            Rates are measured on your current step's key hold and recomputed from your history — deleting a session
            updates them honestly.
          </p>
          <p>
            Noise is handled deliberately: averages are pulled toward the overall mean until a strategy has real
            evidence behind it, targets anchor on your typical hold rather than your single best, and swings above ~22%
            pause changes instead of driving them.
            {state.settings.stopLatencySec > 0 ? (
              <> Timed holds have your {state.settings.stopLatencySec.toFixed(1)}s stop reaction removed.</>
            ) : null}
          </p>
        </div>
      </div>

      {/* Consistency heatmap */}
      <div className="mt-4 rounded-3xl border border-line bg-surface p-5 shadow-card">
        <div className="font-display text-[16px] font-semibold text-ink">Consistency</div>
        <div className="text-[13px] text-ink2">Every training day of the last 16 weeks — darker means more hold time</div>
        <div className="mt-4">
          <TrainingHeatmap sessions={state.sessions} />
        </div>
      </div>

      {/* PR board */}
      <SectionTitle>Personal records</SectionTitle>
      {trackedPrs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong p-6 text-center text-[14px] text-ink3">
          Records appear as soon as you log sets.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {trackedPrs.map(({ ex, pr }) => (
            <div key={ex.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <div className="truncate text-[13px] font-medium text-ink2">{ex.name}</div>
              <div className="mt-0.5 font-display text-[22px] font-semibold text-ink tnum">
                {ex.type === 'hold' ? fmtHold(pr.value) : `${pr.value}`}
                {ex.type === 'reps' ? <span className="text-[13px] font-normal text-ink3"> reps</span> : null}
              </div>
              <div className="text-[12px] text-ink3">{fmtDate(pr.at)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Achievements */}
      <SectionTitle>Achievements</SectionTitle>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {ACHIEVEMENTS.map((a) => {
          const at = state.achievements[a.id]
          const prog = !at && a.progress ? a.progress(state) : null
          return (
            <div
              key={a.id}
              className={`rounded-2xl border p-4 ${
                at ? 'card-sheen border-accent/30 bg-surface shadow-card' : 'border-line bg-surface/40'
              }`}
            >
              <div className={`text-[26px] ${at ? '' : 'opacity-40 grayscale'}`}>{a.icon}</div>
              <div className={`mt-1.5 text-[13.5px] font-semibold ${at ? 'text-ink' : 'text-ink3'}`}>{a.name}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-ink3">{a.desc}</div>
              {at ? (
                <div className="mt-1.5 text-[11.5px] font-medium text-accent">{fmtDate(at)}</div>
              ) : prog && prog.current > 0 ? (
                <div className="mt-2">
                  <div className="h-1 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-accent/60"
                      style={{ width: `${Math.min(100, (prog.current / prog.target) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-ink3 tnum">
                    {prog.current}/{prog.target}
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* History */}
      <SectionTitle>History</SectionTitle>
      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong p-6 text-center text-[14px] text-ink3">
          Your session log will live here.
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => {
            const open = expanded === s.id
            return (
              <div key={s.id} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                <button
                  onClick={() => setExpanded(open ? null : s.id)}
                  className="flex w-full items-center gap-3 p-4 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2.5">
                      <span className="text-[14.5px] font-semibold text-ink">{s.workoutName}</span>
                      <span className="text-[12.5px] text-ink3">
                        {fmtDate(s.startedAt)} · {fmtTime(s.startedAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[13px] text-ink2 tnum">
                      {s.sets.length} sets · {sessionHoldSec(s)}s held · {fmtClock((s.endedAt - s.startedAt) / 1000)}
                      {s.rpe ? ` · RPE ${s.rpe}` : ''}
                    </div>
                  </div>
                  <Icon name="chevronD" size={16} className={`shrink-0 text-ink3 transition ${open ? 'rotate-180' : ''}`} />
                </button>
                {open ? (
                  <div className="border-t border-line px-4 pb-4 pt-3">
                    {s.notes ? <div className="mb-3 rounded-xl bg-raised p-3 text-[13.5px] italic text-ink2">“{s.notes}”</div> : null}
                    <div className="grid gap-1 sm:grid-cols-2">
                      {s.sets.map((set, i) => {
                        const ex = EXERCISE_BY_ID[set.exerciseId]
                        return (
                          <div key={i} className="flex items-baseline justify-between gap-3 text-[13.5px]">
                            <span className="text-ink2">{ex?.name ?? set.exerciseId}</span>
                            <span className="text-ink tnum">
                              {set.kind === 'hold' ? fmtHold(set.value) : `${set.value} reps`}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <button
                      onClick={() => setConfirmDelete(s.id)}
                      className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-danger/80 hover:text-danger"
                    >
                      <Icon name="trash" size={14} /> Delete session
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
        <div className="p-6">
          <h2 className="font-display text-[19px] font-semibold text-ink">Delete this session?</h2>
          <p className="mt-1.5 text-[14px] text-ink2">
            Records, unlocks and achievements will be recalculated from the remaining history.
          </p>
          <div className="mt-5 flex gap-2.5">
            <button
              onClick={() => setConfirmDelete(null)}
              className="flex-1 rounded-xl border border-line bg-surface py-3 text-[14.5px] font-medium text-ink"
            >
              Keep it
            </button>
            <button
              onClick={() => {
                if (confirmDelete) dispatch({ type: 'DELETE_SESSION', id: confirmDelete })
                setConfirmDelete(null)
                setExpanded(null)
                pushToast('Session deleted.', 'info')
              }}
              className="flex-1 rounded-xl bg-danger py-3 text-[14.5px] font-semibold text-white"
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
