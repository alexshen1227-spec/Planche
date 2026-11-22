/**
 * One optional tap after a skill set: how hard it was, 6–10. It is kept on
 * the set (`SetLog.rpe`) and feeds the shared fatigue count; the skill
 * coach's targets do not read it. Tapping the chosen value again clears it.
 */
export function SetEffort({ value, onChange }: { value?: number; onChange: (rpe: number | undefined) => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="How hard was that set? Optional">
      <span className="mr-1 text-caption text-ink3">Effort (optional)</span>
      {[6, 7, 8, 9, 10].map((n) => (
        <button
          key={n}
          onClick={() => onChange(value === n ? undefined : n)}
          aria-pressed={value === n}
          className={`ds-press h-11 min-w-11 rounded-control border px-2 text-body font-semibold tnum ${
            value === n ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-surface text-ink2'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  )
}
