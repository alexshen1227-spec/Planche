/** Round tick values up to `max`, at a step of 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceTicks(max: number, count = 3): number[] {
  if (max <= 0) return [0]
  const rough = max / count
  const pow = 10 ** Math.floor(Math.log10(rough))
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * pow)
  const step = candidates.find((c) => c >= rough) ?? candidates[candidates.length - 1]
  const ticks: number[] = []
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100)
  return ticks
}

/**
 * The weekly hold chart's value axis. Seconds of work under a minute are read
 * in seconds — the axis once said "0m / 0.1m / 0.2m" over a week of 12
 * seconds — and minutes from there on.
 */
export function holdAxis(maxSec: number): { unit: 's' | 'm'; ticks: number[]; secPerTick: number; label: (tick: number) => string } {
  const grown = maxSec * 1.1
  if (grown < 60) {
    return { unit: 's', ticks: niceTicks(grown), secPerTick: 1, label: (t) => `${t}s` }
  }
  return { unit: 'm', ticks: niceTicks(grown / 60), secPerTick: 60, label: (t) => `${t}m` }
}
