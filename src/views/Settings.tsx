import { useEffect, useRef, useState } from 'react'
import type { Settings as SettingsShape } from '../types'
import { useStore, normalizeState } from '../lib/store'
import { STEP_BY_ID } from '../data/progressions'
import { exportData, readImportFile } from '../lib/exportImport'
import { requestPersistence, storageInfo, type StorageInfo } from '../lib/persist'
import { fmtDate } from '../lib/time'
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

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
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

export function Settings() {
  const { state, dispatch } = useStore()
  const s = state.settings
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmSample, setConfirmSample] = useState(false)
  const [name, setName] = useState(state.name)
  const [storage, setStorage] = useState<StorageInfo | null>(null)

  useEffect(() => {
    void storageInfo().then(setStorage)
  }, [])

  const set = (patch: Partial<SettingsShape>) => dispatch({ type: 'SET_SETTINGS', patch })

  const onImport = async (file: File) => {
    try {
      const raw = await readImportFile(file)
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
          <Toggle on={s.warmup} onChange={(v) => set({ warmup: v })} />
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
          <Toggle on={s.sound} onChange={(v) => set({ sound: v })} />
        </Row>
        <Row label="Voice cues" hint="Spoken counts every 5s mid-hold, plus go/target calls — you can't read a screen upside-down.">
          <Toggle on={s.voice} onChange={(v) => set({ voice: v })} />
        </Row>
        <Row label="Countdown beeps" hint="3-2-1 ticks before holds and rests (voice replaces these when it's on).">
          <Toggle on={s.beeps} onChange={(v) => set({ beeps: v })} />
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
              {storage === null ? '…' : storage.persisted ? '✓ Protected' : '—'}
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
          Progressions follow standard gymnastics-strength practice (leans → frog → tuck → advanced tuck → straddle →
          full). Expect the road to take 1–3+ years depending on starting point, bodyweight and consistency — that's
          normal, not failure.
        </p>
        <p className="mt-2 text-ink3">
          Not medical advice. Straight-arm work is demanding on wrists, elbows and shoulders — train smart, rest hard,
          and see a professional about persistent pain.
        </p>
      </div>

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
