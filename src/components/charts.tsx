import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react'
import { addDays, dayKey, fmtDuration, fmtHold, fmtShortDay, weekStart } from '../lib/time'
import type { WeekVolume } from '../lib/stats'
import type { Session } from '../types'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width: w }
}

function niceTicks(max: number, count = 3): number[] {
  if (max <= 0) return [0]
  const rough = max / count
  const pow = 10 ** Math.floor(Math.log10(rough))
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * pow)
  const step = candidates.find((c) => c >= rough) ?? candidates[candidates.length - 1]
  const ticks: number[] = []
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100)
  return ticks
}

interface TipState {
  x: number
  y: number
  lines: string[]
}

function Tooltip({ tip }: { tip: TipState | null }) {
  if (!tip) return null
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[12px] leading-relaxed text-ink shadow-pop"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      {tip.lines.map((l, i) => (
        <div key={i} className={i === 0 ? 'font-medium' : 'text-ink2'}>
          {l}
        </div>
      ))}
    </div>
  )
}

/** Single-series line: best hold per session over time, with an unlock-goal line. */
export function HoldLineChart({
  points,
  goal,
  height = 200,
}: {
  points: { at: number; value: number }[]
  goal?: number
  height?: number
}) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState | null>(null)
  const areaGradId = useId()

  if (points.length < 2) {
    return (
      <div ref={ref} className="grid h-[200px] place-items-center text-center text-[13px] text-ink3">
        <div>
          <div className="mb-1 text-2xl">📈</div>
          Log two or more sessions with this hold
          <br />
          and the trend appears here.
        </div>
      </div>
    )
  }

  const pad = { l: 34, r: 46, t: 14, b: 24 }
  const w = Math.max(width, 280)
  const iw = w - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const t0 = points[0].at
  const t1 = points[points.length - 1].at
  const span = Math.max(1, t1 - t0)
  const maxV = Math.max(...points.map((p) => p.value), goal ?? 0) * 1.12
  const x = (t: number) => pad.l + ((t - t0) / span) * iw
  const y = (v: number) => pad.t + ih - (v / maxV) * ih
  const ticks = niceTicks(maxV)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const area = `${path} L${x(t1).toFixed(1)},${(pad.t + ih).toFixed(1)} L${x(t0).toFixed(1)},${(pad.t + ih).toFixed(1)} Z`
  const last = points[points.length - 1]

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    let best = points[0]
    let bd = Infinity
    for (const p of points) {
      const d = Math.abs(x(p.at) - mx)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    setTip({ x: x(best.at), y: y(best.value), lines: [fmtHold(best.value), fmtShortDay(best.at)] })
  }

  return (
    <div ref={ref} className="relative">
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setTip(null)} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--t-grid)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--t-ink3)" className="tnum">
              {t}s
            </text>
          </g>
        ))}
        {goal ? (
          <g>
            <line x1={pad.l} x2={w - pad.r} y1={y(goal)} y2={y(goal)} stroke="var(--t-accent-soft)" strokeWidth={2} />
            <text x={w - pad.r + 6} y={y(goal) + 4} fontSize={11} fill="var(--t-ink3)">
              goal {goal}s
            </text>
          </g>
        ) : null}
        <defs>
          <linearGradient id={areaGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--t-chart1)" stopOpacity={0.26} />
            <stop offset="100%" stopColor="var(--t-chart1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${areaGradId})`} />
        <path d={path} fill="none" stroke="var(--t-chart1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p) => (
          <circle
            key={p.at}
            cx={x(p.at)}
            cy={y(p.value)}
            r={4}
            fill="var(--t-chart1)"
            stroke="var(--t-surface)"
            strokeWidth={2}
          />
        ))}
        {tip ? <line x1={tip.x} x2={tip.x} y1={pad.t} y2={pad.t + ih} stroke="var(--t-line-strong)" strokeWidth={1} /> : null}
        <text x={x(last.at)} y={y(last.value) - 10} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--t-ink)" className="tnum">
          {fmtHold(last.value)}
        </text>
        <text x={pad.l} y={height - 6} fontSize={11} fill="var(--t-ink3)">
          {fmtShortDay(t0)}
        </text>
        <text x={w - pad.r} y={height - 6} textAnchor="end" fontSize={11} fill="var(--t-ink3)">
          {fmtShortDay(t1)}
        </text>
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

/**
 * GitHub-style consistency heatmap: one cell per day, intensity = hold
 * seconds. Single-hue sequential ramp of the chart accent (alpha steps);
 * exact values live in the tooltip and the session history below it.
 */
export function TrainingHeatmap({ sessions, weeks = 16 }: { sessions: Session[]; weeks?: number }) {
  const [tip, setTip] = useState<TipState | null>(null)
  const { byDay, start } = useMemo(() => {
    const map = new Map<string, { sec: number; count: number }>()
    for (const s of sessions) {
      const k = dayKey(s.startedAt)
      const cur = map.get(k) ?? { sec: 0, count: 0 }
      for (const set of s.sets) if (set.kind === 'hold') cur.sec += set.value
      cur.count += 1
      map.set(k, cur)
    }
    return { byDay: map, start: addDays(weekStart(Date.now()), -7 * (weeks - 1)) }
  }, [sessions, weeks])

  const cell = 13
  const gap = 3
  const labelW = 26
  const labelH = 16
  const w = labelW + weeks * (cell + gap)
  const h = labelH + 7 * (cell + gap)
  const today = dayKey(Date.now())

  const level = (sec: number, count: number) => {
    if (count === 0) return 0
    if (sec < 60) return 1
    if (sec < 150) return 2
    if (sec < 280) return 3
    return 4
  }
  const FILL = ['var(--t-grid)', 0.25, 0.45, 0.7, 1] as const

  const monthLabels: { x: number; label: string }[] = []
  let lastMonth = -1
  for (let wk = 0; wk < weeks; wk++) {
    const d = new Date(addDays(start, wk * 7))
    if (d.getMonth() !== lastMonth) {
      lastMonth = d.getMonth()
      monthLabels.push({ x: labelW + wk * (cell + gap), label: d.toLocaleString(undefined, { month: 'short' }) })
    }
  }

  return (
    <div className="relative overflow-x-auto">
      <svg width={w} height={h} className="block" onMouseLeave={() => setTip(null)}>
        {monthLabels.map((m) => (
          <text key={m.x} x={m.x} y={10} fontSize={10.5} fill="var(--t-ink3)">
            {m.label}
          </text>
        ))}
        {(['M', 'W', 'F'] as const).map((d, i) => (
          <text key={d} x={0} y={labelH + (i * 2 + 1) * (cell + gap) - 3} fontSize={10.5} fill="var(--t-ink3)">
            {d}
          </text>
        ))}
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const wk = Math.floor(i / 7)
          const day = i % 7
          const ts = addDays(start, wk * 7 + day)
          const k = dayKey(ts)
          if (ts > Date.now() && k !== today) return null
          const info = byDay.get(k) ?? { sec: 0, count: 0 }
          const lv = level(Math.round(info.sec), info.count)
          const x = labelW + wk * (cell + gap)
          const y = labelH + day * (cell + gap)
          const hover = () =>
            setTip({
              x: x + cell / 2,
              y,
              lines: [
                fmtShortDay(ts),
                info.count === 0
                  ? 'Rest day'
                  : `${info.count} session${info.count > 1 ? 's' : ''} · ${fmtDuration(Math.round(info.sec))} held`,
              ],
            })
          return (
            <rect
              key={k}
              x={x}
              y={y}
              width={cell}
              height={cell}
              rx={3.5}
              fill={lv === 0 ? FILL[0] : 'var(--t-chart1)'}
              fillOpacity={lv === 0 ? 1 : (FILL[lv] as number)}
              stroke={k === today ? 'var(--t-accent)' : 'none'}
              strokeWidth={k === today ? 1.5 : 0}
              onMouseEnter={hover}
              onMouseMove={hover}
            />
          )
        })}
      </svg>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11.5px] text-ink3">
        less
        {[0, 0.25, 0.45, 0.7, 1].map((o, i) => (
          <span
            key={i}
            className="h-[11px] w-[11px] rounded-[3px]"
            style={{
              background: i === 0 ? 'var(--t-grid)' : 'var(--t-chart1)',
              opacity: i === 0 ? 1 : o,
            }}
          />
        ))}
        more
      </div>
      <Tooltip tip={tip} />
    </div>
  )
}

/** Stacked weekly hold-volume columns: planche line vs everything else. */
export function VolumeBarChart({ weeks, height = 200 }: { weeks: WeekVolume[]; height?: number }) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState | null>(null)

  const totals = weeks.map((w) => w.plancheSec + w.otherSec)
  const any = totals.some((t) => t > 0)
  if (!any) {
    return (
      <div ref={ref} className="grid h-[200px] place-items-center text-center text-[13px] text-ink3">
        <div>
          <div className="mb-1 text-2xl">📊</div>
          Weekly hold volume shows up here
          <br />
          after your first sessions.
        </div>
      </div>
    )
  }

  const pad = { l: 40, r: 8, t: 26, b: 24 }
  const w = Math.max(width, 280)
  const iw = w - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const maxMin = Math.max(...totals) / 60
  const ticks = niceTicks(maxMin * 1.1)
  const maxV = Math.max(ticks[ticks.length - 1], maxMin) * 60 || 60
  const slot = iw / weeks.length
  const bw = Math.min(24, slot * 0.55)
  const y = (sec: number) => pad.t + ih - (sec / maxV) * ih

  return (
    <div ref={ref} className="relative">
      <div className="absolute right-1 top-0 flex items-center gap-4 text-[12px] text-ink2">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: 'var(--t-chart1)' }} />
          Planche holds
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: 'var(--t-chart2)' }} />
          Accessory
        </span>
      </div>
      <svg width={w} height={height} onMouseLeave={() => setTip(null)} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t * 60)} y2={y(t * 60)} stroke="var(--t-grid)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t * 60) + 4} textAnchor="end" fontSize={11} fill="var(--t-ink3)" className="tnum">
              {t}m
            </text>
          </g>
        ))}
        {weeks.map((wk, i) => {
          const cx = pad.l + slot * i + slot / 2
          const px = cx - bw / 2
          const baseY = pad.t + ih
          const ph = ((wk.plancheSec / maxV) * ih) || 0
          const oh = ((wk.otherSec / maxV) * ih) || 0
          const gap = oh > 0 && ph > 0 ? 2 : 0
          const hover = () =>
            setTip({
              x: cx,
              y: y(wk.plancheSec + wk.otherSec),
              lines: [
                `Week of ${fmtShortDay(wk.start)}`,
                `Planche ${fmtDuration(wk.plancheSec)} · Accessory ${fmtDuration(wk.otherSec)}`,
              ],
            })
          return (
            <g key={wk.start} onMouseEnter={hover} onMouseMove={hover}>
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={ih} fill="transparent" />
              {ph > 0 ? (
                <path
                  d={
                    oh > 0
                      ? `M${px},${baseY} L${px},${baseY - ph} L${px + bw},${baseY - ph} L${px + bw},${baseY} Z`
                      : `M${px},${baseY} L${px},${baseY - ph + 4} Q${px},${baseY - ph} ${px + 4},${baseY - ph} L${px + bw - 4},${baseY - ph} Q${px + bw},${baseY - ph} ${px + bw},${baseY - ph + 4} L${px + bw},${baseY} Z`
                  }
                  fill="var(--t-chart1)"
                />
              ) : null}
              {oh > 0 ? (
                <path
                  d={`M${px},${baseY - ph - gap} L${px},${baseY - ph - gap - oh + 4} Q${px},${baseY - ph - gap - oh} ${px + 4},${baseY - ph - gap - oh} L${px + bw - 4},${baseY - ph - gap - oh} Q${px + bw},${baseY - ph - gap - oh} ${px + bw},${baseY - ph - gap - oh + 4} L${px + bw},${baseY - ph - gap} Z`}
                  fill="var(--t-chart2)"
                />
              ) : null}
              {i % 3 === 0 ? (
                <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--t-ink3)">
                  {fmtShortDay(wk.start)}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}
