import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { dayKey, fmtDate } from '../lib/time'
import { fmtWeight } from '../lib/units'
import { HoldLineChart } from './charts'
import { Button } from './ds'
import { MeasurePrompt } from './MeasurePrompt'

export function BodyweightHistory() {
  const { state } = useStore()
  const [open, setOpen] = useState(false)
  const points = useMemo(() => {
    const byDay = new Map<string, { at: number; value: number }>()
    for (const m of state.measurements) {
      if (m.weightKg === undefined) continue
      const key = dayKey(m.at)
      const previous = byDay.get(key)
      if (!previous || m.at >= previous.at) byDay.set(key, { at: m.at, value: m.weightKg })
    }
    return [...byDay.values()].sort((a, b) => a.at - b.at)
  }, [state.measurements])
  const latest = points.at(-1)
  // Legacy profiles can already have a measurement from before tracking was an explicit setting.
  if (state.settings.trackBodyweight === false || (!state.settings.trackBodyweight && !latest)) return null
  const format = (kg: number) => fmtWeight(kg, state.settings.units)
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-title3 font-semibold">Bodyweight</h2>
        <Button variant="ghost" onClick={() => setOpen(true)}>Log measurement</Button>
      </div>
      {latest ? (
        <p className="text-footnote text-ink2"><strong className="text-body text-ink tnum">{format(latest.value)}</strong> · {fmtDate(latest.at)}</p>
      ) : <p className="text-footnote text-ink2">Your first measurement starts your history.</p>}
      {points.length >= 2 && (
        <HoldLineChart points={points} height={155} label="Recorded bodyweight" format={format} axisFormat={(v) => format(v).split(' ')[0]} />
      )}
      <MeasurePrompt open={open} onClose={() => setOpen(false)} />
    </section>
  )
}
