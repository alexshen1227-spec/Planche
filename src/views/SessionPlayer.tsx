import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Section, Session, SessionEvents, SetLog, Workout } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID } from '../data/progressions'
import { ACHIEVEMENT_BY_ID } from '../data/achievements'
import { useStore } from '../lib/store'
import { applySession } from '../lib/engine'
import { sfx, speak, buzz } from '../lib/audio'
import { confetti } from '../lib/confetti'
import { useWakeLock } from '../lib/wakeLock'
import { fmtClock, fmtHold } from '../lib/time'
import { Icon } from '../components/Icon'
import { Figure } from '../components/Figure'
import { ProgressRing, Modal } from '../components/ui'

type Phase = 'intro' | 'ready' | 'lead' | 'hold' | 'reps' | 'rest' | 'summary' | 'celebrate'

const SECTION_LABEL: Record<Section, string> = {
  warmup: 'Warm-up',
  main: 'Main work',
  strength: 'Strength',
  core: 'Core',
  cooldown: 'Cooldown',
}

const LEAD_SEC = 5

export function SessionPlayer({ workout, onExit }: { workout: Workout; onExit: () => void }) {
  const { state, dispatch } = useStore()
  const [phase, setPhase] = useState<Phase>('intro')
  const [bi, setBi] = useState(0)
  const [si, setSi] = useState(0)
  const [logs, setLogs] = useState<SetLog[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [leadEnd, setLeadEnd] = useState(0)
  const [holdStart, setHoldStart] = useState(0)
  const [restEnd, setRestEnd] = useState(0)
  const [pendingReps, setPendingReps] = useState(0)
  const [rpe, setRpe] = useState<number | undefined>()
  const [notes, setNotes] = useState('')
  const [events, setEvents] = useState<SessionEvents | null>(null)
  const [savedSession, setSavedSession] = useState<Session | null>(null)
  const [confirmExit, setConfirmExit] = useState(false)
  const [insight, setInsight] = useState<{ delta: number; label: string } | null>(null)
  const startedAtRef = useRef(Date.now())
  const lastBeepRef = useRef(-1)
  const targetHitRef = useRef(false)
  const lastCountRef = useRef(-1)
  const prBuzzedRef = useRef(false)

  useWakeLock(phase !== 'summary' && phase !== 'celebrate')

  const block = workout.blocks[bi]
  const exercise = block ? EXERCISE_BY_ID[block.exerciseId] : undefined
  const totalSets = useMemo(() => workout.blocks.reduce((n, b) => n + b.sets, 0), [workout])
  const doneSets = logs.length
  const bestBefore = exercise ? state.prs[exercise.id]?.value : undefined

  // Shared 100ms clock (also keeps the header session-elapsed ticking).
  useEffect(() => {
    if (phase === 'summary' || phase === 'celebrate') return
    const t = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(t)
  }, [phase])

  const leadRemaining = Math.max(0, (leadEnd - now) / 1000)
  const holdElapsed = phase === 'hold' ? Math.max(0, (now - holdStart) / 1000) : 0
  const restRemaining = Math.max(0, (restEnd - now) / 1000)

  // Countdown cues for lead-in and rest: spoken when voice is on, ticks otherwise.
  useEffect(() => {
    if (phase !== 'lead' && phase !== 'rest') return
    const remaining = phase === 'lead' ? leadRemaining : restRemaining
    const whole = Math.ceil(remaining)
    if (whole <= 3 && whole >= 1 && whole !== lastBeepRef.current) {
      lastBeepRef.current = whole
      if (state.settings.voice) speak(String(whole))
      else if (state.settings.beeps) sfx.tick()
    }
  }, [phase, leadRemaining, restRemaining, state.settings.beeps, state.settings.voice])

  // Lead-in finished → the hold starts.
  useEffect(() => {
    if (phase === 'lead' && leadRemaining <= 0) {
      sfx.go()
      if (state.settings.voice) speak('Go')
      targetHitRef.current = false
      lastCountRef.current = -1
      prBuzzedRef.current = false
      setHoldStart(Date.now())
      setPhase('hold')
    }
  }, [phase, leadRemaining, state.settings.voice])

  // Rest finished → back to ready.
  useEffect(() => {
    if (phase === 'rest' && restRemaining <= 0) {
      sfx.go()
      if (state.settings.voice) speak('Rest over')
      lastBeepRef.current = -1
      setPhase('ready')
    }
  }, [phase, restRemaining, state.settings.voice])

  // Chime + announce when the target is reached mid-hold.
  useEffect(() => {
    if (phase !== 'hold' || !block || block.target.kind !== 'hold') return
    if (!targetHitRef.current && holdElapsed >= block.target.sec) {
      targetHitRef.current = true
      sfx.target()
      buzz(40)
      if (state.settings.voice) speak('Target')
    }
  }, [phase, holdElapsed, block, state.settings.voice])

  // Spoken 5-second counts mid-hold — the screen is unreadable upside-down.
  useEffect(() => {
    if (phase !== 'hold' || !state.settings.voice || !block) return
    const whole = Math.floor(holdElapsed)
    const target = block.target.kind === 'hold' ? block.target.sec : 0
    if (whole >= 5 && whole % 5 === 0 && whole !== target && whole !== lastCountRef.current) {
      lastCountRef.current = whole
      speak(String(whole))
    }
  }, [phase, holdElapsed, block, state.settings.voice])

  // Haptic pulse the moment a live hold becomes a PR.
  useEffect(() => {
    if (phase !== 'hold' || prBuzzedRef.current) return
    if (bestBefore !== undefined && holdElapsed > bestBefore) {
      prBuzzedRef.current = true
      buzz([30, 40, 30])
    }
  }, [phase, holdElapsed, bestBefore])

  const advance = useCallback(
    (withRest: boolean) => {
      lastBeepRef.current = -1
      const b = workout.blocks[bi]
      const isLastSet = si + 1 >= b.sets
      const isLastBlock = bi + 1 >= workout.blocks.length
      if (isLastSet && isLastBlock) {
        setPhase('summary')
        return
      }
      if (isLastSet) {
        setBi(bi + 1)
        setSi(0)
      } else {
        setSi(si + 1)
      }
      if (withRest) {
        setRestEnd(Date.now() + b.restSec * 1000)
        setPhase('rest')
      } else {
        setPhase('ready')
      }
    },
    [bi, si, workout],
  )

  const logSet = useCallback(
    (value: number) => {
      if (!block || !exercise) return
      setLogs((l) => [
        ...l,
        {
          exerciseId: exercise.id,
          kind: exercise.type,
          value,
          target: block.target.kind === 'hold' ? block.target.sec : block.target.reps,
          section: block.section,
          at: Date.now(),
        },
      ])
      advance(true)
    },
    [block, exercise, advance],
  )

  const stopHold = useCallback(() => {
    const v = Math.round(((Date.now() - holdStart) / 1000) * 10) / 10
    sfx.stop()
    if (bestBefore !== undefined && v > bestBefore) sfx.pr()
    logSet(v)
  }, [holdStart, logSet, bestBefore])

  const beginSet = useCallback(() => {
    if (!block || !exercise) return
    lastBeepRef.current = -1
    if (exercise.type === 'hold') {
      setLeadEnd(Date.now() + LEAD_SEC * 1000)
      setPhase('lead')
    } else {
      setPendingReps(block.target.kind === 'reps' ? block.target.reps : 0)
      setPhase('reps')
    }
  }, [block, exercise])

  const skipSet = useCallback(() => advance(false), [advance])

  const skipBlock = useCallback(() => {
    lastBeepRef.current = -1
    if (bi + 1 >= workout.blocks.length) {
      setPhase('summary')
    } else {
      setBi(bi + 1)
      setSi(0)
      setPhase('ready')
    }
  }, [bi, workout])

  const adjustLastLog = useCallback((delta: number) => {
    setLogs((l) => {
      if (l.length === 0) return l
      const last = l[l.length - 1]
      const value = Math.max(0, Math.round((last.value + delta) * 10) / 10)
      return [...l.slice(0, -1), { ...last, value }]
    })
  }, [])

  const save = useCallback(() => {
    const session: Session = {
      id: crypto.randomUUID(),
      startedAt: startedAtRef.current,
      endedAt: Date.now(),
      workoutName: workout.name,
      workoutKind: workout.kind,
      stepId: state.stepId,
      sets: logs,
      rpe,
      notes: notes.trim() || undefined,
    }
    const { events: raw } = applySession(state, session)
    // First-ever values on accessories are technically PRs but not worth a
    // party — celebrate improvements, plus any first planche-line numbers.
    const ev: SessionEvents = {
      ...raw,
      prs: raw.prs.filter(
        (p) => p.previous !== undefined || EXERCISE_BY_ID[p.exerciseId]?.category === 'planche',
      ),
    }
    // Compare against the last run of this same workout.
    const plancheHold = (s: Session) =>
      Math.round(
        s.sets
          .filter((x) => x.kind === 'hold' && EXERCISE_BY_ID[x.exerciseId]?.category === 'planche')
          .reduce((t, x) => t + x.value, 0),
      )
    const prevSame = [...state.sessions]
      .filter((s) => s.workoutName === workout.name)
      .sort((a, b) => b.startedAt - a.startedAt)[0]
    if (prevSame) {
      const delta = plancheHold(session) - plancheHold(prevSame)
      setInsight({
        delta,
        label:
          delta >= 0
            ? `+${delta}s planche hold time vs your last ${workout.name}`
            : `${delta}s planche hold time vs last time — down days are part of it`,
      })
    }
    dispatch({ type: 'SAVE_SESSION', session })
    setEvents(ev)
    setSavedSession(session)
    setPhase('celebrate')
    sfx.done()
    if (ev.unlockedStep) confetti(2)
    else if (ev.prs.length > 0) confetti(1)
  }, [workout, state, logs, rpe, notes, dispatch])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (phase === 'intro') setPhase('ready')
        else if (phase === 'ready') beginSet()
        else if (phase === 'hold') stopHold()
        else if (phase === 'reps') logSet(pendingReps)
      } else if (e.key.toLowerCase() === 's' && phase === 'rest') {
        setRestEnd(Date.now())
      } else if (e.key === 'Escape' && phase !== 'celebrate') {
        setConfirmExit(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, beginSet, stopHold, logSet, pendingReps])

  const sessionElapsed = Math.max(0, (now - startedAtRef.current) / 1000)
  const lastLog = logs[logs.length - 1]

  const holdSecTotal = Math.round(logs.filter((l) => l.kind === 'hold').reduce((t, l) => t + l.value, 0))

  // ————— Render helpers —————

  const header = (
    <div className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-8">
      <div className="min-w-0">
        <div className="truncate font-display text-[15px] font-semibold text-ink">{workout.name}</div>
        <div className="text-[12.5px] text-ink3 tnum">
          {doneSets}/{totalSets} sets · {fmtClock(sessionElapsed)}
        </div>
      </div>
      <button
        onClick={() => (phase === 'summary' || phase === 'celebrate' ? onExit() : setConfirmExit(true))}
        aria-label="Exit session"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink2 hover:text-ink"
      >
        <Icon name="x" size={17} />
      </button>
    </div>
  )

  const progressBar = (
    <div className="mx-5 mt-3 h-1 overflow-hidden rounded-full bg-line sm:mx-8">
      <div
        className="h-full rounded-full bg-accent transition-all duration-500"
        style={{ width: `${(doneSets / Math.max(1, totalSets)) * 100}%` }}
      />
    </div>
  )

  function body() {
    if (phase === 'intro') {
      const sections = [...new Set(workout.blocks.map((b) => b.section))]
      return (
        <div className="mx-auto w-full max-w-lg px-5 pb-10">
          <div className="mt-6 rounded-3xl border border-line bg-surface p-6 shadow-card">
            <div className="text-[13px] font-medium uppercase tracking-wide text-ink3">Up next</div>
            <h1 className="mt-1 font-display text-[26px] font-bold text-ink">{workout.name}</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink2">{workout.focus}</p>
            <div className="mt-4 space-y-4">
              {sections.map((sec) => (
                <div key={sec}>
                  <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink3">
                    {SECTION_LABEL[sec]}
                  </div>
                  <div className="space-y-1">
                    {workout.blocks
                      .filter((b) => b.section === sec)
                      .map((b, i) => {
                        const ex = EXERCISE_BY_ID[b.exerciseId]
                        return (
                          <div key={i} className="flex items-baseline justify-between gap-3 text-[14px]">
                            <span className="text-ink">{ex.name}</span>
                            <span className="shrink-0 text-ink2 tnum">
                              {b.sets}×{b.target.kind === 'hold' ? `${b.target.sec}s` : b.target.reps}
                            </span>
                          </div>
                        )
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => setPhase('ready')}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 font-display text-[17px] font-semibold text-on-accent shadow-card transition hover:brightness-105 active:scale-[0.99]"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            <Icon name="play" size={18} /> Begin session
          </button>
          <div className="mt-3 text-center text-[12.5px] text-ink3">Space = start / stop · S = skip rest · Esc = exit</div>
        </div>
      )
    }

    if (!block || !exercise) return null

    if (phase === 'ready') {
      const isHold = exercise.type === 'hold'
      const target = block.target.kind === 'hold' ? `${block.target.sec}s` : `${block.target.reps} reps`
      return (
        <div className="mx-auto w-full max-w-lg px-5 pb-10 text-center">
          <div className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-accent">
            {SECTION_LABEL[block.section]} · Set {si + 1} of {block.sets}
          </div>
          <h1 className="mt-1 font-display text-[30px] font-bold leading-tight text-ink">{exercise.name}</h1>
          <div className="mt-1 text-[15px] text-ink2 tnum">
            Target {target}
            {exercise.perSide ? ' / side' : ''}
            {bestBefore ? ` · Best ${exercise.type === 'hold' ? fmtHold(bestBefore) : `${bestBefore} reps`}` : ''}
          </div>
          {exercise.category === 'planche' ? (
            <Figure step={figureFor(exercise.id)} className="mx-auto mt-2 h-36 w-44 text-ink" />
          ) : (
            <div className="mt-6" />
          )}
          <div className="mx-auto mt-2 max-w-sm space-y-1.5">
            {exercise.cues.slice(0, 3).map((c) => (
              <div key={c} className="rounded-xl border border-line bg-surface px-4 py-2 text-[13.5px] text-ink2">
                {c}
              </div>
            ))}
            {block.note ? (
              <div className="rounded-xl border border-accent/25 bg-accent-soft px-4 py-2 text-[13.5px] text-ink">
                {block.note}
              </div>
            ) : null}
          </div>
          <button
            onClick={beginSet}
            className="mt-6 inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl px-6 py-4 font-display text-[17px] font-semibold text-on-accent shadow-card transition hover:brightness-105 active:scale-[0.99]"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            <Icon name="play" size={18} />
            {isHold ? `Start · ${LEAD_SEC}s lead-in` : 'Begin set'}
          </button>
          <div className="mt-3 flex justify-center gap-5 text-[13px]">
            <button onClick={skipSet} className="text-ink3 underline-offset-2 hover:text-ink hover:underline">
              Skip set
            </button>
            <button onClick={skipBlock} className="text-ink3 underline-offset-2 hover:text-ink hover:underline">
              Skip exercise
            </button>
          </div>
        </div>
      )
    }

    if (phase === 'lead') {
      const n = Math.ceil(leadRemaining)
      return (
        <div className="mx-auto flex w-full max-w-lg flex-col items-center px-5 pb-10 text-center">
          <div className="mt-6 text-[14px] font-medium uppercase tracking-wide text-ink2">Get into position</div>
          <div className="relative mt-2 grid h-56 w-56 place-items-center">
            <div className="absolute inset-0 rounded-full bg-accent-soft blur-2xl" />
            <div key={n} className="font-timer relative text-[130px] leading-none text-accent animate-pop-num">
              {n}
            </div>
          </div>
          <div className="text-[15px] font-medium text-ink2">{exercise.name}</div>
          <button
            onClick={() => setLeadEnd(Date.now())}
            className="mt-8 rounded-xl border border-line bg-surface px-5 py-2.5 text-[14px] font-medium text-ink2 hover:text-ink"
          >
            Skip lead-in
          </button>
        </div>
      )
    }

    if (phase === 'hold') {
      const target = block.target.kind === 'hold' ? block.target.sec : 0
      const overTarget = holdElapsed >= target
      const isPr = bestBefore !== undefined && holdElapsed > bestBefore
      return (
        <div className="mx-auto flex w-full max-w-lg flex-col items-center px-5 pb-10 text-center">
          <div className="mt-2 text-[14px] font-medium text-ink2">
            {exercise.name} · Set {si + 1}/{block.sets}
          </div>
          <div className="relative mt-4">
            <div className="pointer-events-none absolute inset-6 rounded-full bg-accent-soft blur-3xl" />
            <ProgressRing
              value={Math.min(1, holdElapsed / Math.max(1, target))}
              size={290}
              stroke={13}
              glow
              color={isPr ? 'var(--t-ok)' : overTarget ? 'var(--t-ok)' : undefined}
              className="relative"
            >
              <div>
                <div
                  className={`font-timer text-[72px] leading-none ${
                    isPr || overTarget ? 'text-ok' : 'text-ink'
                  }`}
                >
                  {holdElapsed.toFixed(1)}
                </div>
                <div className="mt-1.5 text-[14px] font-semibold">
                  {isPr ? (
                    <span className="text-ok">NEW PR — hold on!</span>
                  ) : overTarget ? (
                    <span className="text-ok">bonus seconds</span>
                  ) : (
                    <span className="text-ink3 tnum">target {target}s</span>
                  )}
                </div>
              </div>
            </ProgressRing>
          </div>
          <button
            onClick={stopHold}
            className="mt-8 inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-danger px-6 py-5 font-display text-[18px] font-semibold text-white shadow-card transition active:scale-[0.99]"
          >
            <Icon name="stop" size={18} /> Stop hold
          </button>
          <div className="mt-3 text-[12.5px] text-ink3">or press Space</div>
        </div>
      )
    }

    if (phase === 'reps') {
      return (
        <div className="mx-auto flex w-full max-w-lg flex-col items-center px-5 pb-10 text-center">
          <div className="mt-4 text-[14px] font-medium text-ink2">
            {exercise.name} · Set {si + 1}/{block.sets}
          </div>
          <div className="mt-2 text-[15px] text-ink2">Do your set, then log the reps.</div>
          <div className="mt-6 flex items-center gap-5">
            <button
              onClick={() => setPendingReps((r) => Math.max(0, r - 1))}
              aria-label="Fewer reps"
              className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface text-ink hover:border-line-strong"
            >
              <Icon name="minus" size={20} />
            </button>
            <div className="w-32 font-display text-[80px] font-bold leading-none text-ink tnum">{pendingReps}</div>
            <button
              onClick={() => setPendingReps((r) => r + 1)}
              aria-label="More reps"
              className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface text-ink hover:border-line-strong"
            >
              <Icon name="plus" size={20} />
            </button>
          </div>
          <div className="mt-1 text-[13px] text-ink3 tnum">
            target {block.target.kind === 'reps' ? block.target.reps : 0}
          </div>
          <button
            onClick={() => logSet(pendingReps)}
            className="mt-8 inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl px-6 py-4 font-display text-[17px] font-semibold text-on-accent shadow-card transition hover:brightness-105 active:scale-[0.99]"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            <Icon name="check" size={18} /> Log {pendingReps} reps
          </button>
        </div>
      )
    }

    if (phase === 'rest') {
      const nb = workout.blocks[bi]
      const nx = EXERCISE_BY_ID[nb.exerciseId]
      const total = nb.restSec
      return (
        <div className="mx-auto flex w-full max-w-lg flex-col items-center px-5 pb-10 text-center">
          <div className="mt-4 text-[14px] font-medium uppercase tracking-wide text-ink3">Rest</div>
          <ProgressRing value={restRemaining / Math.max(1, total)} size={210} stroke={10} className="mt-4">
            <div>
              <div className="font-timer text-[54px] leading-none text-ink">{fmtClock(restRemaining)}</div>
            </div>
          </ProgressRing>
          {lastLog ? (
            <div className="mt-5 flex items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-4 pr-1.5 text-[13.5px] text-ink2">
              Logged {lastLog.kind === 'hold' ? fmtHold(lastLog.value) : `${lastLog.value} reps`}
              <span className="flex gap-1">
                <button
                  onClick={() => adjustLastLog(-1)}
                  aria-label="Decrease logged value"
                  className="grid h-7 w-7 place-items-center rounded-full border border-line bg-raised text-ink2 hover:text-ink"
                >
                  <Icon name="minus" size={13} />
                </button>
                <button
                  onClick={() => adjustLastLog(1)}
                  aria-label="Increase logged value"
                  className="grid h-7 w-7 place-items-center rounded-full border border-line bg-raised text-ink2 hover:text-ink"
                >
                  <Icon name="plus" size={13} />
                </button>
              </span>
            </div>
          ) : null}
          <div className="mt-5 text-[14px] text-ink2">
            Next: <span className="font-medium text-ink">{nx.name}</span> · set {si + 1}/{nb.sets}
          </div>
          <div className="mt-5 flex gap-3">
            <button
              onClick={() => setRestEnd((e) => e + 30_000)}
              className="rounded-xl border border-line bg-surface px-5 py-2.5 text-[14px] font-medium text-ink2 hover:text-ink"
            >
              +30s
            </button>
            <button
              onClick={() => setRestEnd(Date.now())}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-5 py-2.5 text-[14px] font-medium text-ink2 hover:text-ink"
            >
              <Icon name="skip" size={15} /> Skip rest
            </button>
          </div>
        </div>
      )
    }

    if (phase === 'summary') {
      return (
        <div className="mx-auto w-full max-w-lg px-5 pb-10">
          <h1 className="mt-6 text-center font-display text-[26px] font-bold text-ink">Session done 🎉</h1>
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {[
              ['Duration', fmtClock(sessionElapsed)],
              ['Sets', String(doneSets)],
              ['Hold time', `${holdSecTotal}s`],
            ].map(([l, v]) => (
              <div key={l} className="rounded-2xl border border-line bg-surface p-3 text-center">
                <div className="text-[12px] text-ink3">{l}</div>
                <div className="font-display text-[20px] font-semibold text-ink tnum">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <div className="mb-2 text-[14px] font-medium text-ink">How hard was it? (RPE)</div>
            <div className="flex gap-2">
              {[6, 7, 8, 9, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setRpe(n)}
                  className={`flex-1 rounded-xl border py-2.5 font-display text-[16px] font-semibold transition ${
                    rpe === n
                      ? 'border-transparent bg-accent text-on-accent'
                      : 'border-line bg-surface text-ink2 hover:text-ink'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes — how did it feel? (optional)"
            rows={2}
            className="mt-4 w-full resize-none rounded-2xl border border-line bg-surface p-4 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
          />
          <button
            onClick={save}
            disabled={logs.length === 0}
            className="mt-4 w-full rounded-2xl px-6 py-4 font-display text-[17px] font-semibold text-on-accent shadow-card transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            Save session
          </button>
          <button
            onClick={() => setConfirmExit(true)}
            className="mt-2 w-full rounded-2xl py-3 text-[14px] font-medium text-ink3 hover:text-ink"
          >
            Discard
          </button>
        </div>
      )
    }

    if (phase === 'celebrate' && events && savedSession) {
      const unlocked = events.unlockedStep ? STEP_BY_ID[events.unlockedStep] : undefined
      return (
        <div className="mx-auto w-full max-w-lg px-5 pb-10 text-center">
          {unlocked ? (
            <div className="mt-6 rounded-3xl border border-accent/30 bg-accent-soft p-6">
              <div className="text-[13px] font-semibold uppercase tracking-wide text-accent">Step unlocked</div>
              <Figure step={unlocked.id} className="mx-auto mt-2 h-32 w-40 text-ink" />
              <div className="font-display text-[26px] font-bold text-ink">{unlocked.name}</div>
              <p className="mt-1 text-[14px] text-ink2">{unlocked.tagline}</p>
            </div>
          ) : (
            <h1 className="mt-8 font-display text-[26px] font-bold text-ink">Saved ✓</h1>
          )}
          {insight ? (
            <div
              className={`mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13.5px] font-medium ${
                insight.delta >= 0 ? 'border-ok/30 bg-ok-soft text-ink' : 'border-line bg-surface text-ink2'
              }`}
            >
              <Icon name="chart" size={15} className={insight.delta >= 0 ? 'text-ok' : 'text-ink3'} />
              {insight.label}
            </div>
          ) : null}
          {events.prs.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-line bg-surface p-4 text-left">
              <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink3">New records</div>
              {events.prs.map((p) => {
                const ex = EXERCISE_BY_ID[p.exerciseId]
                return (
                  <div key={p.exerciseId} className="flex items-baseline justify-between py-1 text-[14.5px]">
                    <span className="text-ink">{ex?.name ?? p.exerciseId}</span>
                    <span className="font-semibold text-accent tnum">
                      {ex?.type === 'hold' ? fmtHold(p.value) : `${p.value} reps`}
                      {p.previous !== undefined ? (
                        <span className="ml-1.5 font-normal text-ink3">
                          was {ex?.type === 'hold' ? fmtHold(p.previous) : p.previous}
                        </span>
                      ) : null}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : null}
          {events.achievements.length > 0 ? (
            <div className="mt-4 space-y-2">
              {events.achievements.map((id) => {
                const a = ACHIEVEMENT_BY_ID[id]
                return (
                  <div
                    key={id}
                    className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 text-left"
                  >
                    <div className="text-[26px]">{a.icon}</div>
                    <div>
                      <div className="text-[14.5px] font-semibold text-ink">{a.name}</div>
                      <div className="text-[13px] text-ink2">{a.desc}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}
          <button
            onClick={onExit}
            className="mt-6 w-full rounded-2xl px-6 py-4 font-display text-[17px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            Done
          </button>
        </div>
      )
    }
    return null
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-bg">
      <div className="app-ambient min-h-full pb-8">
        {header}
        {phase !== 'celebrate' ? progressBar : null}
        {body()}
      </div>
      <Modal open={confirmExit} onClose={() => setConfirmExit(false)}>
        <div className="p-6">
          <h2 className="font-display text-[19px] font-semibold text-ink">Leave this session?</h2>
          <p className="mt-1.5 text-[14px] text-ink2">
            {logs.length > 0
              ? `You have ${logs.length} logged set${logs.length === 1 ? '' : 's'} that will be lost.`
              : 'Nothing has been logged yet.'}
          </p>
          <div className="mt-5 flex gap-2.5">
            <button
              onClick={() => setConfirmExit(false)}
              className="flex-1 rounded-xl border border-line bg-surface py-3 text-[14.5px] font-medium text-ink"
            >
              Keep training
            </button>
            <button
              onClick={onExit}
              className="flex-1 rounded-xl bg-danger py-3 text-[14.5px] font-semibold text-white"
            >
              Leave
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/** Map planche-line exercise ids onto the figure pictograms. */
function figureFor(exerciseId: string) {
  switch (exerciseId) {
    case 'planche-lean':
      return 'lean' as const
    case 'frog-stand':
      return 'frog' as const
    case 'tuck-planche':
      return 'tuck' as const
    case 'adv-tuck-planche':
      return 'advtuck' as const
    case 'one-leg-planche':
      return 'oneleg' as const
    case 'straddle-planche':
    case 'band-straddle-planche':
      return 'straddle' as const
    case 'full-planche':
      return 'full' as const
    default:
      return 'lean' as const
  }
}
