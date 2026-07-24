import { useMemo, useState } from 'react'
import type { Category, Exercise } from '../types'
import { useStore } from '../lib/store'
import { EXERCISES, CATEGORY_LABEL } from '../data/exercises'
import { fmtHold, fmtDate } from '../lib/time'
import { Icon } from '../components/Icon'
import { Modal, Chip } from '../components/ui'

const CATS: (Category | 'all')[] = ['all', 'planche', 'push', 'scapula', 'core', 'wrist', 'mobility']

export function Library() {
  const { state } = useStore()
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<Exercise | null>(null)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return EXERCISES.filter(
      (e) =>
        (cat === 'all' || e.category === cat) &&
        (!q || e.name.toLowerCase().includes(q) || e.blurb.toLowerCase().includes(q)),
    )
  }, [cat, query])

  return (
    <div className="animate-rise">
      <h1 className="font-display text-[28px] font-bold text-ink">Exercise Library</h1>
      <p className="mt-0.5 text-[14px] text-ink2">
        Every movement the programs use — how to do it, what to feel, what to avoid.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {CATS.map((c) => (
          <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
            {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
          </Chip>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="ml-auto w-full max-w-[180px] rounded-full border border-line bg-surface px-4 py-1.5 text-[13.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent sm:w-auto"
        />
      </div>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((e) => {
          const pr = state.prs[e.id]
          return (
            <button
              key={e.id}
              onClick={() => setDetail(e)}
              className="card-int rounded-2xl border border-line bg-surface p-5 text-left shadow-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-display text-[16px] font-semibold leading-snug text-ink">{e.name}</div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                    e.type === 'hold' ? 'bg-accent-soft text-accent' : 'bg-info-soft text-info'
                  }`}
                >
                  {e.type}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink2">{e.blurb}</p>
              <div className="mt-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1" aria-label={`Difficulty ${e.difficulty} of 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span
                      key={n}
                      className={`h-1.5 w-4 rounded-full ${n <= e.difficulty ? 'bg-accent' : 'bg-line'}`}
                    />
                  ))}
                </div>
                {pr ? (
                  <span className="text-[12.5px] font-medium text-ink2 tnum">
                    best {e.type === 'hold' ? fmtHold(pr.value) : `${pr.value} reps`}
                  </span>
                ) : (
                  <span className="text-[12.5px] text-ink3">{CATEGORY_LABEL[e.category]}</span>
                )}
              </div>
            </button>
          )
        })}
      </div>
      {list.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-line-strong p-8 text-center text-[14px] text-ink3">
          Nothing matches that search.
        </div>
      ) : null}

      <Modal open={detail !== null} onClose={() => setDetail(null)} wide>
        {detail ? <ExerciseDetail exercise={detail} /> : null}
      </Modal>
    </div>
  )
}

function ExerciseDetail({ exercise: e }: { exercise: Exercise }) {
  const { state } = useStore()
  const pr = state.prs[e.id]
  return (
    <div className="p-6 sm:p-8">
      <div className="pr-10">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-semibold uppercase tracking-wider text-accent">
            {CATEGORY_LABEL[e.category]}
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
              e.type === 'hold' ? 'bg-accent-soft text-accent' : 'bg-info-soft text-info'
            }`}
          >
            {e.type === 'hold' ? 'timed hold' : 'reps'}
          </span>
        </div>
        <h2 className="mt-1 font-display text-[24px] font-bold text-ink">{e.name}</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink2">{e.blurb}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
        <span className="rounded-full border border-line bg-raised px-3 py-1.5 text-ink2">
          Difficulty{' '}
          <span className="ml-1 inline-flex items-center gap-0.5 align-middle">
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={`h-1.5 w-3 rounded-full ${n <= e.difficulty ? 'bg-accent' : 'bg-line'}`} />
            ))}
          </span>
        </span>
        <span className="rounded-full border border-line bg-raised px-3 py-1.5 text-ink2">{e.equipment.join(' · ')}</span>
        {pr ? (
          <span className="rounded-full border border-line bg-raised px-3 py-1.5 text-ink2 tnum">
            Your best:{' '}
            <span className="font-medium text-ink">
              {e.type === 'hold' ? fmtHold(pr.value) : `${pr.value} reps`} ({fmtDate(pr.at)})
            </span>
          </span>
        ) : null}
      </div>

      <div className="mt-5 rounded-2xl border border-line bg-raised p-4">
        <div className="mb-2 text-[13px] font-semibold text-ink">How to do it</div>
        <ol className="space-y-1.5 text-[13.5px] leading-relaxed text-ink2">
          {e.howTo.map((s, i) => (
            <li key={s} className="flex gap-2.5">
              <span className="font-display font-semibold text-accent tnum">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-raised p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ok">
            <Icon name="check" size={14} /> Cues
          </div>
          <ul className="space-y-1.5 text-[13.5px] leading-relaxed text-ink2">
            {e.cues.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink3" />
                {c}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-raised p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-danger">
            <Icon name="x" size={14} /> Watch out for
          </div>
          <ul className="space-y-1.5 text-[13.5px] leading-relaxed text-ink2">
            {e.mistakes.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink3" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 text-[13px] text-ink3">
        <span className="font-medium text-ink2">Works:</span> {e.muscles.join(', ')}
        {e.perSide ? ' · train both sides evenly' : ''}
      </div>
    </div>
  )
}
