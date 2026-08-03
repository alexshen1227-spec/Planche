import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EXERCISE_BY_ID } from '../data/exercises'
import {
  analyseClipDetailed,
  drawRotated,
  judgeTrackedFrames,
  POSE_PROFILES,
  unrotateKeypoints,
  type JudgeInput,
  type PoseFormResult,
  type Rotation,
} from '../lib/poseForm'
import { getBackend, trackingScore, type Kp } from '../lib/poseBackend'
import { buildTruePose, IDEAL, synthesizeClip, type SynthParams } from '../lib/poseSynth'
import { Icon } from '../components/Icon'

/**
 * A bench for the camera form judge.
 *
 * The judge is the one part of this app whose output cannot be checked by
 * reading it — a verdict of "elbows bent" is either true or false about a body
 * that is no longer in the room. So this puts the whole pipeline on a bench:
 * build a pose whose real angles you chose, watch the skeleton it produces,
 * and read the verdict beside it. Anything that disagrees is a bug you can see
 * rather than one an athlete has to report.
 *
 * It also runs the real thing: point it at a clip and it decodes, detects and
 * judges exactly as a workout would, then hands back the poses as JSON so a
 * piece of real footage can become a fixture that replays forever without a
 * camera or a model download.
 *
 * Reached at #devlab, code-split so it costs a workout nothing, and mirrored
 * onto `window.__planche` so it can be driven from a browser console or an
 * automated harness instead of by clicking.
 */

const GRADED = Object.keys(POSE_PROFILES).filter((id) => !POSE_PROFILES[id].noChecks)

/** The subset of scenario knobs that are a single number a slider can hold. */
type ControlKey =
  | 'elbowBendDeg'
  | 'kneeBendDeg'
  | 'hipAngleDeg'
  | 'hipOffset'
  | 'leanRatio'
  | 'shrugGap'
  | 'noise'
  | 'rollDeg'
  | 'bodyWidth'
  | 'nearScore'
  | 'farScore'
  | 'dropoutRate'
  | 'foreshorten'
  | 'seed'

interface Control {
  key: ControlKey
  label: string
  min: number
  max: number
  step: number
  unit: string
  hint?: string
}

/** The knobs worth turning by hand, with the range each one is real over. */
const CONTROLS: Control[] = [
  { key: 'elbowBendDeg', label: 'Elbow bend', min: -10, max: 60, step: 1, unit: '°', hint: 'negative = hyperextended lockout' },
  { key: 'kneeBendDeg', label: 'Knee bend', min: 0, max: 130, step: 1, unit: '°' },
  { key: 'hipAngleDeg', label: 'Hip angle', min: 40, max: 185, step: 1, unit: '°' },
  { key: 'hipOffset', label: 'Hip height', min: -0.6, max: 0.6, step: 0.01, unit: '×torso', hint: '+ = hips above shoulders' },
  { key: 'leanRatio', label: 'Forward lean', min: -0.1, max: 0.9, step: 0.01, unit: '×torso' },
  { key: 'shrugGap', label: 'Ear gap', min: 0.15, max: 0.6, step: 0.01, unit: '×torso', hint: 'small = shrugged' },
  { key: 'noise', label: 'Landmark noise', min: 0, max: 0.05, step: 0.002, unit: '×torso' },
  { key: 'rollDeg', label: 'Camera roll', min: -15, max: 15, step: 1, unit: '°' },
  { key: 'bodyWidth', label: 'Off-axis width', min: 0.02, max: 0.9, step: 0.02, unit: '×torso' },
  { key: 'nearScore', label: 'Near-side confidence', min: 0.1, max: 1, step: 0.05, unit: '' },
  { key: 'farScore', label: 'Far-side confidence', min: 0.05, max: 1, step: 0.05, unit: '' },
  { key: 'dropoutRate', label: 'Dropped joints', min: 0, max: 0.5, step: 0.02, unit: '' },
  { key: 'foreshorten', label: 'Leg foreshortening', min: 0.3, max: 1, step: 0.02, unit: '' },
  { key: 'seed', label: 'Noise seed', min: 1, max: 40, step: 1, unit: '' },
]

const BONES: [string, string][] = [
  ['shoulder', 'elbow'],
  ['elbow', 'wrist'],
  ['shoulder', 'hip'],
  ['hip', 'knee'],
  ['knee', 'ankle'],
  ['shoulder', 'ear'],
]

/** Draw what the detector handed over, so a bad verdict has a visible cause. */
function Skeleton({ poses, frame }: { poses: JudgeInput; frame: number }) {
  const kps = poses.tracked[Math.min(frame, poses.tracked.length - 1)]?.kps ?? []
  const at = (name: string) => kps.find((k) => k.name === name && (k.score ?? 0) >= 0.3)
  const sides = ['left', 'right'] as const
  return (
    <svg
      viewBox={`0 0 ${poses.width} ${poses.height}`}
      className="h-56 w-full rounded-xl border border-line bg-raised"
      role="img"
      aria-label="Tracked skeleton"
    >
      {sides.map((side, index) => (
        <g key={side} opacity={index === 0 ? 1 : 0.45}>
          {BONES.map(([a, b]) => {
            const from = at(`${side}_${a}`)
            const to = at(`${side}_${b}`)
            if (!from || !to) return null
            return (
              <line
                key={`${a}-${b}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={index === 0 ? 'var(--t-accent)' : 'var(--t-ink3)'}
                strokeWidth={poses.width / 200}
                strokeLinecap="round"
              />
            )
          })}
          {kps
            .filter((k) => k.name?.startsWith(side) && (k.score ?? 0) >= 0.3)
            .map((k) => (
              <circle
                key={k.name}
                cx={k.x}
                cy={k.y}
                r={poses.width / 150}
                fill={index === 0 ? 'var(--t-ok)' : 'var(--t-ink3)'}
              />
            ))}
        </g>
      ))}
    </svg>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' | 'warn' }) {
  const colour = tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-accent' : 'text-ink2'
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1 last:border-0">
      <span className="text-[12px] text-ink3">{label}</span>
      <span className={`text-right text-[12.5px] font-medium tnum ${colour}`}>{value}</span>
    </div>
  )
}

function Verdict({ result }: { result: PoseFormResult }) {
  const round = (v: number | undefined, digits = 1) => (v === undefined ? '—' : v.toFixed(digits))
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      {result.ok ? (
        <>
          <div className="mb-2 flex items-center gap-2">
            <span
              className={`grid h-11 w-11 place-items-center rounded-full border-[3px] font-display text-[16px] font-bold tnum ${
                (result.score ?? 0) >= 85
                  ? 'border-ok/60 text-ok'
                  : (result.score ?? 0) >= 60
                    ? 'border-accent/60 text-accent'
                    : 'border-danger/60 text-danger'
              }`}
            >
              {result.score ?? '—'}
            </span>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-ink">
                {result.issues.length ? result.issues.join(', ') : 'no issues'}
              </div>
              <div className="truncate text-[11.5px] text-ink3">
                {result.fixFirst?.cue ?? 'nothing to fix first'}
              </div>
            </div>
          </div>
          <Row label="clean window" value={`${round(result.cleanSeconds)}s (${Math.round((result.cleanRatio ?? 0) * 100)}%)`} tone={(result.cleanRatio ?? 0) >= 0.99 ? 'ok' : 'warn'} />
          <Row label="elbow" value={`${round(result.elbowDeg)}°`} />
          <Row label="knee" value={`${round(result.kneeDeg)}°`} />
          <Row label="hip angle" value={`${round(result.hipAngleDeg)}°`} />
          <Row label="hip offset" value={round(result.hipOffset, 3)} />
          <Row label="lean" value={round(result.leanRatio, 3)} />
          <Row label="shrug" value={round(result.shrugRatio, 3)} />
          <Row label="wobble" value={round(result.wobble, 4)} />
          <Row label="confidence" value={round(result.confidence, 2)} />
          <Row label="frames" value={`${result.framesUsed}/${result.framesSampled ?? '?'}`} />
          <Row label="unseen" value={result.unseen.join(', ') || 'none'} tone={result.unseen.length ? 'warn' : 'ok'} />
          {result.subscores?.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {result.subscores.map((s) => (
                <span
                  key={s.key}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium tnum ${
                    s.score >= 85 ? 'bg-ok-soft text-ok' : s.score >= 60 ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'
                  }`}
                >
                  {s.label} {s.score}
                </span>
              ))}
            </div>
          ) : null}
          {result.notes.length ? (
            <ul className="mt-2 space-y-1 text-[11.5px] text-ink2">
              {result.notes.map((n) => (
                <li key={n}>• {n}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <div className="text-[12.5px] text-danger">{result.reason}</div>
      )}
    </div>
  )
}

export function DevLab({ onClose }: { onClose: () => void }) {
  const [exerciseId, setExerciseId] = useState('tuck-planche')
  const [overrides, setOverrides] = useState<Partial<Record<ControlKey, number>>>({})
  const [frame, setFrame] = useState(0)
  const [clipUrl, setClipUrl] = useState('')
  const [clipHold, setClipHold] = useState(10)
  const [busy, setBusy] = useState('')
  const [real, setReal] = useState<{ result: PoseFormResult; poses?: JudgeInput; label: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const params: SynthParams = useMemo(
    () => ({ ...IDEAL[exerciseId], ...overrides }),
    [exerciseId, overrides],
  )
  const clip = useMemo(() => synthesizeClip(params), [params])
  const result = useMemo(() => judgeTrackedFrames(clip, exerciseId), [clip, exerciseId])
  const truth = useMemo(() => buildTruePose(params, 0).truth, [params])

  const set = (key: ControlKey, value: number) => setOverrides((o) => ({ ...o, [key]: value }))
  const reset = () => setOverrides({})

  const runBlob = useCallback(
    async (blob: Blob, label: string) => {
      setBusy(`Analysing ${label}…`)
      try {
        const analysis = await analyseClipDetailed(blob, exerciseId, undefined, clipHold)
        setReal({ ...analysis, label })
      } catch (err) {
        setReal({
          result: { ok: false, confidence: 0, framesUsed: 0, issues: [], notes: [], good: [], details: [], unseen: [], reason: String(err) },
          label,
        })
      } finally {
        setBusy('')
      }
    },
    [exerciseId, clipHold],
  )

  const runUrl = useCallback(async () => {
    if (!clipUrl) return
    setBusy('Fetching clip…')
    try {
      const res = await fetch(clipUrl, { mode: 'cors' })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      await runBlob(await res.blob(), clipUrl.split('/').pop() ?? 'clip')
    } catch (err) {
      setBusy('')
      setReal({
        result: {
          ok: false, confidence: 0, framesUsed: 0, issues: [], notes: [], good: [], details: [], unseen: [],
          reason: `Could not fetch that URL (${String(err)}). It has to allow cross-origin reads — a direct file link, not a player page.`,
        },
        label: clipUrl,
      })
    }
  }, [clipUrl, runBlob])

  // The console/automation surface. Everything the UI can do is callable, and
  // returns plain data rather than React state, so a harness can drive the
  // whole judge without touching a single control.
  useEffect(() => {
    const api = {
      profiles: POSE_PROFILES,
      ideal: IDEAL,
      positions: GRADED,
      /** Judge a synthetic hold whose true measurements you chose. */
      judge(id: string, extra: SynthParams = {}) {
        const input = synthesizeClip({ ...IDEAL[id], ...extra })
        return { truth: buildTruePose({ ...IDEAL[id], ...extra }, 0).truth, verdict: judgeTrackedFrames(input, id) }
      },
      /** Re-judge saved poses — the fixture replay path. */
      judgeFixture(poses: JudgeInput, id: string) {
        return judgeTrackedFrames(poses, id)
      },
      /** Decode, detect and judge a real clip; returns the poses for saving. */
      async analyseUrl(url: string, id: string, creditedHoldSec?: number) {
        const res = await fetch(url, { mode: 'cors' })
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return analyseClipDetailed(await res.blob(), id, undefined, creditedHoldSec)
      },
      /**
       * Judge a still photograph through the real model.
       *
       * A photograph is a clip with the temporal noise removed, which is
       * exactly what makes it worth running: whatever the judge gets wrong
       * here is systematic — a landmark the model places badly on a horizontal
       * body, or a threshold that was never true of real proportions — rather
       * than an unlucky frame. And unlike a synthetic pose, nobody chose the
       * answer in advance.
       */
      async analyseImage(url: string, id: string, frames = 24, seconds = 10) {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error(`could not load ${url}`))
          img.src = url
        })
        const width = image.naturalWidth
        const height = image.naturalHeight
        const canvas = document.createElement('canvas')
        const backend = await getBackend('mediapipe')
        const readAt = async (rotation: Rotation) => {
          if (!drawRotated(image, width, height, canvas, rotation)) return []
          return unrotateKeypoints(await backend.estimate(canvas), rotation, width, height)
        }
        // The same rotation probe a clip gets: pose models are trained on
        // upright people, so the winning orientation is footage-dependent.
        let best: { rotation: Rotation; kps: Kp[]; score: number } = {
          rotation: 0,
          kps: [],
          score: -1,
        }
        for (const rotation of [0, 90, 270] as Rotation[]) {
          const kps = await readAt(rotation)
          const score = trackingScore(kps)
          if (score > best.score) best = { rotation, kps, score }
        }
        const times = Array.from({ length: frames }, (_, i) => (seconds * i) / (frames - 1))
        const poses: JudgeInput = {
          tracked: times.map((t) => ({ t, kps: best.kps.map((k) => ({ ...k })) })),
          times,
          width,
          height,
          duration: seconds,
          creditedHoldSec: seconds,
          from: times[0],
          to: times[times.length - 1],
          holdWindow: seconds,
          backendId: 'mediapipe',
          rotation: best.rotation,
        }
        return {
          rotation: best.rotation,
          trackingScore: best.score,
          scores: Object.fromEntries(
            best.kps
              .filter((k) => k.name && !/eye|mouth|nose|pinky|index|thumb|heel|foot/.test(k.name))
              .map((k) => [k.name, Number((k.score ?? 0).toFixed(3))]),
          ),
          result: judgeTrackedFrames(poses, id),
          poses,
        }
      },
      /**
       * What each candidate orientation makes of the same frame.
       *
       * The probe picks whichever rotation the model reports most confidently,
       * and confidence is not accuracy — this is how you check the two have not
       * come apart on a body the model finds hard.
       */
      async probeImage(url: string, id: string) {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error(`could not load ${url}`))
          img.src = url
        })
        const width = image.naturalWidth
        const height = image.naturalHeight
        const canvas = document.createElement('canvas')
        const backend = await getBackend('mediapipe')
        const rows = []
        for (const rotation of [0, 90, 270] as Rotation[]) {
          drawRotated(image, width, height, canvas, rotation)
          const kps = unrotateKeypoints(await backend.estimate(canvas), rotation, width, height)
          const times = Array.from({ length: 12 }, (_, i) => i)
          const verdict = judgeTrackedFrames(
            {
              tracked: times.map((t) => ({ t, kps: kps.map((k) => ({ ...k })) })),
              times,
              width,
              height,
              duration: 11,
              creditedHoldSec: 11,
              from: 0,
              to: 11,
              holdWindow: 11,
              backendId: 'mediapipe',
              rotation,
            },
            id,
          )
          rows.push({
            rotation,
            trackingScore: +trackingScore(kps).toFixed(3),
            elbow: verdict.elbowDeg && +verdict.elbowDeg.toFixed(1),
            knee: verdict.kneeDeg && +verdict.kneeDeg.toFixed(1),
            hipAngle: verdict.hipAngleDeg && +verdict.hipAngleDeg.toFixed(1),
            lean: verdict.leanRatio && +verdict.leanRatio.toFixed(3),
            hipOffset: verdict.hipOffset && +verdict.hipOffset.toFixed(3),
            ok: verdict.ok,
            issues: verdict.issues,
            reason: verdict.reason,
          })
        }
        return rows
      },
      /** Sweep every position against every fault and report what was named. */
      matrix(extra: SynthParams = {}, seeds = 8) {
        return GRADED.map((id) => {
          const runs = Array.from({ length: seeds }, (_, i) =>
            judgeTrackedFrames(synthesizeClip({ ...IDEAL[id], seed: i + 1, ...extra }), id),
          )
          return {
            id,
            gradedRate: runs.filter((r) => r.ok).length / seeds,
            cleanRate: runs.filter((r) => r.ok && !r.issues.length).length / seeds,
            issues: [...new Set(runs.flatMap((r) => r.issues))],
            unseen: [...new Set(runs.flatMap((r) => r.unseen))],
            medianScore: runs.map((r) => r.score ?? 0).sort((a, b) => a - b)[Math.floor(seeds / 2)],
          }
        })
      },
    }
    ;(window as unknown as { __planche?: typeof api }).__planche = api
    return () => {
      delete (window as unknown as { __planche?: typeof api }).__planche
    }
  }, [])

  return (
    <div className="animate-rise mx-auto w-full max-w-5xl px-4 pb-24 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="font-display text-[20px] font-bold text-ink">Form judge bench</h1>
          <p className="text-[12px] text-ink3">
            Synthetic poses with known angles, and the real pipeline on real footage. Also on{' '}
            <code className="rounded bg-raised px-1">window.__planche</code>.
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-xl border border-line bg-raised px-3 py-1.5 text-[12.5px] font-semibold text-ink"
        >
          Close
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {GRADED.map((id) => (
          <button
            key={id}
            onClick={() => setExerciseId(id)}
            className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition ${
              id === exerciseId
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line bg-raised text-ink2 hover:border-line-strong'
            }`}
          >
            {EXERCISE_BY_ID[id]?.name ?? POSE_PROFILES[id].label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-3">
          <Skeleton poses={clip} frame={frame} />
          <input
            type="range"
            min={0}
            max={Math.max(0, clip.tracked.length - 1)}
            value={Math.min(frame, clip.tracked.length - 1)}
            onChange={(e) => setFrame(Number(e.target.value))}
            className="w-full accent-[var(--t-accent)]"
            aria-label="Frame"
          />
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink3">
                Ground truth vs measured
              </span>
              <button onClick={reset} className="text-[11.5px] font-medium text-accent">
                Reset
              </button>
            </div>
            <Row label="elbow" value={`${truth.elbowDeg.toFixed(1)}° → ${result.elbowDeg?.toFixed(1) ?? '—'}°`} />
            <Row label="knee" value={`${truth.kneeDeg.toFixed(1)}° → ${result.kneeDeg?.toFixed(1) ?? '—'}°`} />
            <Row label="hip angle" value={`${truth.hipAngleDeg.toFixed(1)}° → ${result.hipAngleDeg?.toFixed(1) ?? '—'}°`} />
            <Row label="hip offset" value={`${truth.hipOffset.toFixed(3)} → ${result.hipOffset?.toFixed(3) ?? '—'}`} />
            <Row label="lean" value={`${truth.leanRatio.toFixed(3)} → ${result.leanRatio?.toFixed(3) ?? '—'}`} />
            <Row label="shrug" value={`${truth.shrugRatio.toFixed(3)} → ${result.shrugRatio?.toFixed(3) ?? '—'}`} />
          </div>
          {CONTROLS.map((c) => {
            const value = overrides[c.key] ?? (params as Record<string, unknown>)[c.key]
            const current = typeof value === 'number' ? value : c.key === 'seed' ? 1 : Number(value ?? 0)
            return (
              <label key={c.key} className="block">
                <span className="flex items-baseline justify-between text-[11.5px] text-ink3">
                  <span>
                    {c.label}
                    {c.hint ? <em className="ml-1 not-italic text-ink3/70">({c.hint})</em> : null}
                  </span>
                  <span className="tnum text-ink2">
                    {current.toFixed(c.step < 1 ? 3 : 0)}
                    {c.unit}
                  </span>
                </span>
                <input
                  type="range"
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  value={current}
                  onChange={(e) => set(c.key, Number(e.target.value))}
                  className="w-full accent-[var(--t-accent)]"
                />
              </label>
            )
          })}
        </div>

        <div className="space-y-3">
          <Verdict result={result} />

          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink3">
              Real footage, real pipeline
            </div>
            <p className="mb-2 text-[11.5px] leading-relaxed text-ink3">
              Runs the same decode, model probe, rotation search and verdict a workout does. The
              first run downloads the pose model.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-xl border border-line bg-raised px-3 py-1.5 text-[12.5px] font-semibold text-ink"
              >
                Choose a video file
              </button>
              <label className="flex items-center gap-1 text-[11.5px] text-ink3">
                hold
                <input
                  type="number"
                  min={1}
                  value={clipHold}
                  onChange={(e) => setClipHold(Number(e.target.value))}
                  className="w-16 rounded-lg border border-line bg-raised px-2 py-1 text-ink tnum"
                />
                s
              </label>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void runBlob(file, file.name)
              }}
            />
            <div className="mt-2 flex gap-2">
              <input
                value={clipUrl}
                onChange={(e) => setClipUrl(e.target.value)}
                placeholder="…or a direct video URL"
                className="min-w-0 flex-1 rounded-lg border border-line bg-raised px-2 py-1.5 text-[12px] text-ink"
              />
              <button
                onClick={() => void runUrl()}
                className="rounded-lg border border-line bg-raised px-3 text-[12.5px] font-semibold text-ink"
              >
                Run
              </button>
            </div>
            {busy ? (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-accent" role="status">
                <Icon name="sparkle" size={13} /> {busy}
              </p>
            ) : null}
          </div>

          {real ? (
            <div className="space-y-2">
              <div className="text-[11.5px] text-ink3">{real.label}</div>
              <Verdict result={real.result} />
              {real.poses ? (
                <>
                  <Skeleton poses={real.poses} frame={frame} />
                  <button
                    onClick={() => {
                      const blob = new Blob([JSON.stringify({ exerciseId, poses: real.poses })], {
                        type: 'application/json',
                      })
                      const a = document.createElement('a')
                      a.href = URL.createObjectURL(blob)
                      a.download = `${exerciseId}-poses.json`
                      a.click()
                      URL.revokeObjectURL(a.href)
                    }}
                    className="w-full rounded-xl border border-line bg-raised py-2 text-[12.5px] font-semibold text-ink"
                  >
                    Save these poses as a fixture
                  </button>
                </>
              ) : null}
              {real.result.details.length ? (
                <details className="rounded-xl border border-line bg-surface p-3 text-[11.5px] text-ink3">
                  <summary className="cursor-pointer font-medium text-ink2">How it read the clip</summary>
                  <ul className="mt-1 space-y-1">
                    {real.result.details.map((d) => (
                      <li key={d}>• {d}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default DevLab
