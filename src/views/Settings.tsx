import { useEffect, useRef, useState } from 'react'
import type { Settings as SettingsShape } from '../types'
import { useStore, normalizeState } from '../lib/store'
import { STEP_BY_ID } from '../data/progressions'
import { exportData, readImportFile } from '../lib/exportImport'
import { requestPersistence, storageInfo, type StorageInfo } from '../lib/persist'
import { listClips, clearAllClips, CLIP_RETENTION_DAYS } from '../lib/clips'
import { fmtDate } from '../lib/time'
import { fmtWeight } from '../lib/units'
import { MeasurePrompt, lastOf } from '../components/MeasurePrompt'
import { buildSampleState } from '../data/sample'
import { pushToast } from '../lib/toast'
import { sfx } from '../lib/audio'
import { Icon } from '../components/Icon'
import { Modal, SectionTitle } from '../components/ui'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[14.5px] font-medium text-ink">{label}</div>
        {hint ? <div className="mt-0.5 max-w-md text-[13px] text-ink2">{hint}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 rounded-full transition ${on ? 'bg-accent' : 'bg-line-strong'}`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`}
      />
    </button>
  )
}

function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  format?: (v: number) => string
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(Math.max(min, value - step))}
        aria-label="Decrease"
        className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-raised text-ink2 hover:text-ink"
      >
        <Icon name="minus" size={14} />
      </button>
      <div className="w-16 text-center text-[14px] font-semibold text-ink tnum">{format ? format(value) : value}</div>
      <button
        onClick={() => onChange(Math.min(max, value + step))}
        aria-label="Increase"
        className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-raised text-ink2 hover:text-ink"
      >
        <Icon name="plus" size={14} />
      </button>
    </div>
  )
}

/**
 * Measures how long it takes to actually hit the button. Five trials, median
 * taken — one slow tap should not define the correction.
 */
function LatencyCalibrator({ onDone }: { onDone: (sec: number) => void }) {
  const TRIALS = 5
  const [stage, setStage] = useState<'idle' | 'waiting' | 'go' | 'done'>('idle')
  const [times, setTimes] = useState<number[]>([])
  // Most people put the phone down to hold a planche, so assume that.
  const [reachAdd, setReachAdd] = useState(true)
  const goAtRef = useRef(0)
  const timerRef = useRef<number | undefined>(undefined)

  const schedule = () => {
    setStage('waiting')
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(
      () => {
        goAtRef.current = Date.now()
        setStage('go')
      },
      1200 + Math.random() * 1800,
    )
  }

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const tap = () => {
    if (stage === 'idle') return schedule()
    if (stage === 'waiting') {
      // Jumped the gun — just re-arm rather than recording a bogus 0.
      schedule()
      return
    }
    if (stage === 'go') {
      const ms = Date.now() - goAtRef.current
      const next = [...times, ms]
      setTimes(next)
      if (next.length >= TRIALS) setStage('done')
      else schedule()
    }
  }

  const sorted = [...times].sort((a, b) => a - b)
  const medianMs = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  // Floor at 0.2s: nobody registers a deliberate stop faster than that, so a
  // freak measurement should not zero out the correction entirely.
  const suggested = Math.min(5, Math.max(0.2, Math.round((medianMs / 1000 + (reachAdd ? 1.6 : 0)) * 10) / 10))

  return (
    <div className="p-6">
      <div className="pr-10">
        <h2 className="font-display text-[20px] font-bold text-ink">Calibrate your reaction</h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">
          Tap the panel the instant it turns orange. Five times — the middle result is used, so one slow tap will not
          skew it.
        </p>
      </div>

      <button
        onClick={tap}
        className={`mt-4 grid h-44 w-full place-items-center rounded-2xl border-2 text-center transition ${
          stage === 'go'
            ? 'border-transparent text-on-accent'
            : stage === 'waiting'
              ? 'border-line bg-raised text-ink2'
              : 'border-line bg-raised text-ink'
        }`}
        style={stage === 'go' ? { background: 'var(--t-btn-accent)' } : undefined}
      >
        <span className="font-display text-[19px] font-semibold">
          {stage === 'idle'
            ? 'Tap to begin'
            : stage === 'waiting'
              ? 'Wait for it…'
              : stage === 'go'
                ? 'TAP NOW'
                : `Median ${(medianMs / 1000).toFixed(2)}s`}
        </span>
      </button>

      <div className="mt-2 flex justify-center gap-1.5">
        {Array.from({ length: TRIALS }, (_, i) => (
          <span key={i} className={`h-1.5 w-8 rounded-full ${i < times.length ? 'bg-accent' : 'bg-line'}`} />
        ))}
      </div>

      {stage === 'done' ? (
        <div className="mt-4">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-raised p-3">
            <input
              type="checkbox"
              checked={reachAdd}
              onChange={(e) => setReachAdd(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--t-accent)]"
            />
            <span className="text-[13px] leading-relaxed text-ink2">
              My phone is propped up to film, so I have to come out of the position and walk to it
              <span className="text-ink3"> (adds 1.6s)</span>
            </span>
          </label>
          <button
            onClick={() => onDone(suggested)}
            className="mt-3 w-full rounded-2xl px-6 py-3.5 font-display text-[16px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            Use {suggested.toFixed(1)}s
          </button>
        </div>
      ) : (
        <p className="mt-3 text-center text-[12.5px] text-ink3">
          This measures pure tap speed. If you have to move to reach the phone, the real delay is larger.
        </p>
      )}
    </div>
  )
}

export function Settings() {
  const { state, dispatch } = useStore()
  const s = state.settings
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmSample, setConfirmSample] = useState(false)
  const [name, setName] = useState(state.name)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [calibrating, setCalibrating] = useState(false)
  const [loggingWeight, setLoggingWeight] = useState(false)
  const lastWeight = lastOf(state, 'weightKg')
  const [clipCount, setClipCount] = useState(0)
  const [clipBytes, setClipBytes] = useState(0)

  useEffect(() => {
    void listClips().then((c) => {
      setClipCount(c.length)
      setClipBytes(c.reduce((t, x) => t + x.bytes, 0))
    })
  }, [])

  useEffect(() => {
    void storageInfo().then(setStorage)
  }, [])

  // Keep the field in step with imports, sample data and resets — otherwise
  // pressing Save afterwards would write back a stale name.
  useEffect(() => {
    setName(state.name)
  }, [state.name])

  const set = (patch: Partial<SettingsShape>) => dispatch({ type: 'SET_SETTINGS', patch })

  const onImport = async (file: File) => {
    try {
      const raw = await readImportFile(file)
      // Clips belong to the history being replaced; keeping them would surface
      // the previous data's videos under the imported sessions.
      await clearAllClips()
      setClipCount(0)
      setClipBytes(0)
      dispatch({ type: 'REPLACE', state: normalizeState(raw) })
      pushToast('Data imported.', 'success')
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Import failed.', 'danger')
    }
  }

  return (
    <div className="animate-rise max-w-2xl">
      <h1 className="font-display text-[28px] font-bold text-ink">Settings</h1>
      <p className="mt-0.5 text-[14px] text-ink2">Make it yours.</p>

      <SectionTitle>Profile</SectionTitle>
      <div className="rounded-2xl border border-line bg-surface px-5 shadow-card">
        <Row label="Name" hint="Used for the dashboard greeting.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Athlete"
            className="w-40 rounded-xl border border-line bg-raised px-3 py-2 text-[14px] text-ink outline-none focus:border-accent"
          />
          <button
            onClick={() => {
              dispatch({ type: 'REPLACE', state: { ...state, name: name.trim() } })
              pushToast('Saved.', 'success')
            }}
            className="rounded-xl border border-line bg-raised px-3.5 py-2 text-[13.5px] font-medium text-ink2 hover:text-ink"
          >
            Save
          </button>
        </Row>
        <Row label="Current step" hint="Change it from the Path tab — any unlocked step can be made current.">
          <span className="rounded-full border border-line bg-raised px-3.5 py-1.5 text-[13.5px] font-medium text-ink">
            {STEP_BY_ID[state.stepId].name}
          </span>
        </Row>
        <Row label="Weekly session goal" hint="Drives the streak. 3–4 is the sweet spot for planche work.">
          <Stepper value={s.weeklyGoal} onChange={(v) => set({ weeklyGoal: v })} min={1} max={7} />
        </Row>
        <Row
          label="Bodyweight"
          hint={
            lastWeight
              ? `Last logged ${fmtWeight(lastWeight.value, s.units)} on ${fmtDate(lastWeight.at)}.`
              : 'Not logged yet. Planche is strength-to-weight, so the coach reads your holds against it.'
          }
        >
          <button
            onClick={() => setLoggingWeight(true)}
            className="rounded-xl border border-line bg-raised px-3.5 py-2 text-[13px] font-medium text-ink2 hover:text-ink"
          >
            Log now
          </button>
        </Row>
        <Row label="Session length" hint="Generated sessions trim themselves to fit this budget.">
          <Stepper
            value={s.sessionMinutes}
            onChange={(v) => set({ sessionMinutes: v })}
            min={15}
            max={45}
            step={5}
            format={(v) => `${v} min`}
          />
        </Row>
      </div>

      <SectionTitle>Appearance</SectionTitle>
      <div className="rounded-2xl border border-line bg-surface px-5 shadow-card">
        <Row label="Units" hint="Used for bodyweight and height.">
          <div className="flex overflow-hidden rounded-xl border border-line">
            {(['metric', 'imperial'] as const).map((u) => (
              <button
                key={u}
                onClick={() => set({ units: u })}
                className={`px-3.5 py-2 text-[13.5px] font-medium transition ${
                  s.units === u ? 'bg-accent text-on-accent' : 'bg-surface text-ink2 hover:text-ink'
                }`}
              >
                {u === 'metric' ? 'kg / cm' : 'lb / ft'}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Theme">
          <div className="flex overflow-hidden rounded-xl border border-line">
            {(['dark', 'light', 'system'] as const).map((t) => (
              <button
                key={t}
                onClick={() => set({ theme: t })}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-[13.5px] font-medium capitalize transition ${
                  s.theme === t ? 'bg-accent text-on-accent' : 'bg-surface text-ink2 hover:text-ink'
                }`}
              >
                {t === 'dark' ? <Icon name="moon" size={14} /> : t === 'light' ? <Icon name="sun" size={14} /> : <Icon name="monitor" size={14} />}
                {t}
              </button>
            ))}
          </div>
        </Row>
      </div>

      <SectionTitle>Training</SectionTitle>
      <div className="rounded-2xl border border-line bg-surface px-5 shadow-card">
        <Row label="Include warm-up blocks" hint="Wrist prep and scapula activation at the start of generated sessions.">
          <Toggle label="Include warm-up blocks" on={s.warmup} onChange={(v) => set({ warmup: v })} />
        </Row>
        <Row
          label="Film main holds"
          hint="Records a short clip of planche holds from your camera so you can compare your position over time. Stays on this device, and you can switch it off for any individual set."
        >
          <Toggle label="Film main holds" on={s.recordForm} onChange={(v) => set({ recordForm: v })} />
        </Row>
        <Row
          label="Auto form check"
          hint="Analyses each filmed hold on its own as soon as the clip is ready, instead of waiting for a tap. Skipped until the checker has been run once, so it never downloads the model without you asking."
        >
          <Toggle label="Auto form check" on={s.autoAnalyze} onChange={(v) => set({ autoAnalyze: v })} />
        </Row>
        <Row
          label="Saved form clips"
          hint={`${clipCount} clip${clipCount === 1 ? '' : 's'} · ${(clipBytes / 1048576).toFixed(1)} MB. Kept for ${CLIP_RETENTION_DAYS} days then deleted automatically — pinned clips are kept for good.`}
        >
          <button
            onClick={() => {
              void clearAllClips().then(() => {
                setClipCount(0)
                setClipBytes(0)
                pushToast('Form clips deleted.', 'info')
              })
            }}
            disabled={clipCount === 0}
            className="rounded-xl border border-line bg-raised px-3.5 py-2 text-[13px] font-medium text-ink2 hover:text-ink disabled:opacity-40"
          >
            Delete all
          </button>
        </Row>
        <Row label="Rest after main work" hint="Hard isometrics want 2–3 minutes.">
          <Stepper
            value={s.restMainSec}
            onChange={(v) => set({ restMainSec: v })}
            min={30}
            max={300}
            step={15}
            format={(v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`}
          />
        </Row>
        <Row
          label="Stop reaction delay"
          hint="The gap between coming out of a hold and actually hitting stop. Subtracted from every timed hold so your seconds mean what they say."
        >
          <button
            onClick={() => setCalibrating(true)}
            className="rounded-xl border border-line bg-raised px-3.5 py-2 text-[13px] font-medium text-ink2 hover:text-ink"
          >
            Calibrate
          </button>
          <Stepper
            value={Math.round(s.stopLatencySec * 10)}
            onChange={(v) => set({ stopLatencySec: v / 10 })}
            min={0}
            // Must sit above the default (2.3s); a lower ceiling silently
            // clamped the shipped value downward on the first tap.
            max={50}
            step={1}
            format={(v) => `${(v / 10).toFixed(1)}s`}
          />
        </Row>
        <Row label="Rest after accessories">
          <Stepper
            value={s.restAccessorySec}
            onChange={(v) => set({ restAccessorySec: v })}
            min={15}
            max={240}
            step={15}
            format={(v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`}
          />
        </Row>
      </div>

      <SectionTitle>Sound</SectionTitle>
      <div className="rounded-2xl border border-line bg-surface px-5 shadow-card">
        <Row label="Sounds" hint="Start/stop chimes, PR fanfares.">
          <Toggle label="Sounds" on={s.sound} onChange={(v) => set({ sound: v })} />
        </Row>
        <Row label="Voice cues" hint="Spoken counts every 5s mid-hold, plus go/target calls — you can't read a screen upside-down.">
          <Toggle label="Voice cues" on={s.voice} onChange={(v) => set({ voice: v })} />
        </Row>
        <Row label="Countdown beeps" hint="3-2-1 ticks before holds and rests (voice replaces these when it's on).">
          <Toggle label="Countdown beeps" on={s.beeps} onChange={(v) => set({ beeps: v })} />
        </Row>
        <Row label="Volume">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.volume}
            onChange={(e) => set({ volume: Number(e.target.value) })}
            className="w-32"
          />
          <button
            onClick={() => sfx.pr()}
            className="rounded-xl border border-line bg-raised px-3 py-1.5 text-[13px] font-medium text-ink2 hover:text-ink"
          >
            Test
          </button>
        </Row>
      </div>

      <SectionTitle>Data</SectionTitle>
      <div className="rounded-2xl border border-line bg-surface px-5 shadow-card">
        <Row
          label="On-device safety"
          hint={
            storage === null
              ? 'Data lives in this browser, plus an automatic second on-device backup.'
              : storage.persisted
                ? `Protected — the browser won't auto-delete this data.${storage.usageBytes !== null ? ` Using ${Math.max(1, Math.round(storage.usageBytes / 1024))} KB.` : ''} A second on-device backup updates automatically.`
                : 'Best-effort — the browser could clear this under disk pressure. A second on-device backup updates automatically; exporting a file is still the strongest protection.'
          }
        >
          {storage !== null && storage.persisted === false ? (
            <button
              onClick={() =>
                void requestPersistence().then((granted) => {
                  void storageInfo().then(setStorage)
                  pushToast(granted ? 'Storage is now protected.' : 'Browser declined — install the app or export backups.', granted ? 'success' : 'info', 4500)
                })
              }
              className="rounded-xl border border-line bg-raised px-3.5 py-2 text-[13.5px] font-medium text-ink2 hover:text-ink"
            >
              Protect
            </button>
          ) : (
            <span className={`text-[13px] font-semibold ${storage?.persisted ? 'text-ok' : 'text-ink3'}`}>
              {storage === null ? '…' : storage.persisted ? 'âœ“ Protected' : '—'}
            </span>
          )}
        </Row>
        <Row
          label="Export backup"
          hint={`Everything — sessions, records, achievements — as a JSON file. Last export: ${state.lastBackupAt ? fmtDate(state.lastBackupAt) : 'never'}.`}
        >
          <button
            onClick={() => {
              const stamped = { ...state, lastBackupAt: Date.now() }
              exportData(stamped)
              dispatch({ type: 'REPLACE', state: stamped })
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-raised px-3.5 py-2 text-[13.5px] font-medium text-ink2 hover:text-ink"
          >
            <Icon name="download" size={15} /> Export
          </button>
        </Row>
        <Row label="Import backup" hint="Replaces current data with the file's contents.">
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImport(f)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-raised px-3.5 py-2 text-[13.5px] font-medium text-ink2 hover:text-ink"
          >
            <Icon name="upload" size={15} /> Import
          </button>
        </Row>
        <Row label="Load sample data" hint="See the app fully populated with 9 weeks of plausible training. Replaces current data.">
          <button
            onClick={() => setConfirmSample(true)}
            className="rounded-xl border border-line bg-raised px-3.5 py-2 text-[13.5px] font-medium text-ink2 hover:text-ink"
          >
            Load sample
          </button>
        </Row>
        <Row label="Reset everything" hint="Deletes all local data. There is no undo (export first!).">
          <button
            onClick={() => setConfirmReset(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2 text-[13.5px] font-semibold text-danger"
          >
            <Icon name="trash" size={15} /> Reset
          </button>
        </Row>
      </div>

      <SectionTitle>About</SectionTitle>
      <div className="rounded-2xl border border-line bg-surface p-5 text-[13.5px] leading-relaxed text-ink2 shadow-card">
        <p>
          <span className="font-display font-semibold text-ink">Planche Lab</span> · a local-first training companion
          for learning the planche. All data lives in your browser — nothing leaves your machine.
        </p>
        <p className="mt-2">
          Progressions follow standard gymnastics-strength practice (leans â†’ frog â†’ tuck â†’ advanced tuck â†’ straddle â†’
          full). Expect the road to take 1–3+ years depending on starting point, bodyweight and consistency — that's
          normal, not failure.
        </p>
        <p className="mt-2 text-ink3">
          Not medical advice. Straight-arm work is demanding on wrists, elbows and shoulders — train smart, rest hard,
          and see a professional about persistent pain.
        </p>
      </div>

      <MeasurePrompt open={loggingWeight} onClose={() => setLoggingWeight(false)} />

      <Modal open={calibrating} onClose={() => setCalibrating(false)}>
        <LatencyCalibrator
          onDone={(sec) => {
            set({ stopLatencySec: sec })
            setCalibrating(false)
            pushToast(`Reaction delay set to ${sec.toFixed(1)}s.`, 'success')
          }}
        />
      </Modal>

      <Modal open={confirmSample} onClose={() => setConfirmSample(false)}>
        <div className="p-6">
          <h2 className="font-display text-[19px] font-semibold text-ink">Load sample data?</h2>
          <p className="mt-1.5 text-[14px] text-ink2">
            This replaces your current log with 9 weeks of demo history. Your settings are kept. Export a backup first
            if anything here matters.
          </p>
          <div className="mt-5 flex gap-2.5">
            <button
              onClick={() => setConfirmSample(false)}
              className="flex-1 rounded-xl border border-line bg-surface py-3 text-[14.5px] font-medium text-ink"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const sample = buildSampleState()
                dispatch({ type: 'REPLACE', state: { ...sample, settings: state.settings, name: state.name || sample.name } })
                setConfirmSample(false)
                pushToast('Sample data loaded.', 'success')
              }}
              className="flex-1 rounded-xl bg-accent py-3 text-[14.5px] font-semibold text-on-accent"
            >
              Load sample
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)}>
        <div className="p-6">
          <h2 className="font-display text-[19px] font-semibold text-ink">Reset all data?</h2>
          <p className="mt-1.5 text-[14px] text-ink2">
            Sessions, records, unlocks and achievements will be permanently deleted from this browser.
          </p>
          <div className="mt-5 flex gap-2.5">
            <button
              onClick={() => setConfirmReset(false)}
              className="flex-1 rounded-xl border border-line bg-surface py-3 text-[14.5px] font-medium text-ink"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                // Clips live in their own database — a reset that left the
                // athlete's videos on the device would contradict the copy.
                void clearAllClips().then(() => {
                  setClipCount(0)
                  setClipBytes(0)
                })
                dispatch({ type: 'RESET' })
                setConfirmReset(false)
                pushToast('Everything reset. Fresh start!', 'info')
              }}
              className="flex-1 rounded-xl bg-danger py-3 text-[14.5px] font-semibold text-white"
            >
              Delete everything
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

