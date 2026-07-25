import { useMemo, useState } from 'react'
import type { Category, Exercise } from '../types'
import { useStore } from '../lib/store'
import { EXERCISES, CATEGORY_LABEL } from '../data/exercises'
import { GUIDES, GLOSSARY, type Guide } from '../data/learn'
import { demoSearchUrl, youtubeId, embedUrl } from '../lib/video'
import { pushToast } from '../lib/toast'
import { fmtHold, fmtDate } from '../lib/time'
import { Icon } from '../components/Icon'
import { Modal, Chip } from '../components/ui'
import { ClipGallery } from '../components/ClipGallery'
import { isFilmable } from '../lib/poseForm'

const CATS: (Category | 'all')[] = ['all', 'planche', 'push', 'scapula', 'core', 'wrist', 'general', 'mobility']

export function Library() {
  const [pane, setPane] = useState<'exercises' | 'basics'>('exercises')

  return (
    <div className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-bold text-ink">Learn</h1>
          <p className="mt-0.5 text-[14px] text-ink2">
            {pane === 'exercises'
              ? 'Every movement the programs use — how to do it, what to feel, what to avoid.'
              : 'Plain-English guides and the jargon decoded. Start here if you are new.'}
          </p>
        </div>
        <div className="flex overflow-hidden rounded-xl border border-line">
          {(['exercises', 'basics'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPane(p)}
              className={`px-4 py-2 text-[13.5px] font-medium capitalize transition ${
                pane === p ? 'bg-accent text-on-accent' : 'bg-surface text-ink2 hover:text-ink'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {pane === 'exercises' ? <ExercisePane /> : <BasicsPane />}
    </div>
  )
}

function ExercisePane() {
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
    <>
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
          const pinned = state.videoLinks[e.id]
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
                    <span key={n} className={`h-1.5 w-4 rounded-full ${n <= e.difficulty ? 'bg-accent' : 'bg-line'}`} />
                  ))}
                </div>
                <span className="flex items-center gap-2 text-[12.5px] text-ink3">
                  {pinned ? <Icon name="play" size={12} className="text-accent" /> : null}
                  {pr ? (
                    <span className="font-medium text-ink2 tnum">
                      best {e.type === 'hold' ? fmtHold(pr.value) : `${pr.value} reps`}
                    </span>
                  ) : (
                    CATEGORY_LABEL[e.category]
                  )}
                </span>
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
    </>
  )
}

function VideoPanel({ exercise }: { exercise: Exercise }) {
  const { state, dispatch } = useStore()
  const pinned = state.videoLinks[exercise.id]
  const pinnedId = pinned ? youtubeId(pinned) : null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(pinned ?? '')

  const save = () => {
    const id = youtubeId(draft)
    if (!id) {
      pushToast('That does not look like a YouTube link.', 'danger')
      return
    }
    dispatch({ type: 'SET_VIDEO', exerciseId: exercise.id, url: draft.trim() })
    setEditing(false)
    pushToast('Demo video pinned.', 'success')
  }

  return (
    <div className="mt-4 rounded-2xl border border-line bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Icon name="play" size={14} className="text-accent" /> Demo video
        </div>
        <div className="flex items-center gap-2">
          <a
            href={demoSearchUrl(exercise)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink2 transition hover:text-ink"
          >
            Find demos <Icon name="arrowR" size={13} />
          </a>
          <button
            onClick={() => {
              setDraft(pinned ?? '')
              setEditing((v) => !v)
            }}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink2 transition hover:text-ink"
          >
            {pinned ? 'Change' : 'Pin one'}
          </button>
        </div>
      </div>

      {pinnedId && !editing ? (
        <div className="mt-3">
          <div className="relative w-full overflow-hidden rounded-xl border border-line" style={{ paddingTop: '56.25%' }}>
            <iframe
              src={embedUrl(pinnedId)}
              title={`${exercise.name} demo`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          </div>
          <button
            onClick={() => {
              dispatch({ type: 'SET_VIDEO', exerciseId: exercise.id, url: null })
              pushToast('Pinned video removed.', 'info')
            }}
            className="mt-2 text-[12.5px] font-medium text-ink3 hover:text-danger"
          >
            Remove pinned video
          </button>
        </div>
      ) : editing ? (
        <div className="mt-3">
          <p className="text-[13px] leading-relaxed text-ink2">
            Found a demo you like? Paste its YouTube link and it will play right here, every time.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder="https://youtube.com/watch?v=…"
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
            />
            <button
              onClick={save}
              className="rounded-xl px-4 py-2 text-[13.5px] font-semibold text-on-accent"
              style={{ background: 'var(--t-btn-accent)' }}
            >
              Pin
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          Opens a live search for current demonstrations of this movement — then pin your favourite so it plays here
          from now on.
        </p>
      )}
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

      <VideoPanel exercise={e} />

      {isFilmable(e.id) ? (
        <div className="mt-4 rounded-2xl border border-line bg-raised p-4">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <Icon name="monitor" size={14} className="text-accent" /> Your recorded sets
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink3">
            Compare your current position against an older one — pin a clip to keep it as your reference.
          </p>
          <ClipGallery exerciseId={e.id} />
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-line bg-raised p-4">
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

function BasicsPane() {
  const [guide, setGuide] = useState<Guide | null>(null)
  const [term, setTerm] = useState('')

  const terms = useMemo(() => {
    const q = term.trim().toLowerCase()
    if (!q) return GLOSSARY
    return GLOSSARY.filter(
      (t) => t.term.toLowerCase().includes(q) || t.short.toLowerCase().includes(q) || t.detail.toLowerCase().includes(q),
    )
  }, [term])

  return (
    <>
      <div className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {GUIDES.map((g) => (
          <button
            key={g.id}
            onClick={() => setGuide(g)}
            className="card-int rounded-2xl border border-line bg-surface p-5 text-left shadow-card"
          >
            <div className="text-[26px]">{g.icon}</div>
            <div className="mt-1.5 font-display text-[16px] font-semibold text-ink">{g.title}</div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink2">{g.summary}</p>
            <div className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-medium text-accent">
              Read <Icon name="chevronR" size={14} />
            </div>
          </button>
        ))}
      </div>

      <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-[17px] font-semibold text-ink">Glossary</h2>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search terms…"
          className="w-full max-w-[200px] rounded-full border border-line bg-surface px-4 py-1.5 text-[13.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
        />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {terms.map((t) => (
          <div key={t.term} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-[15px] font-semibold text-ink">{t.term}</span>
              <span className="text-[13px] text-accent">{t.short}</span>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink2">{t.detail}</p>
          </div>
        ))}
      </div>
      {terms.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-[14px] text-ink3">
          No terms match that.
        </div>
      ) : null}

      <Modal open={guide !== null} onClose={() => setGuide(null)} wide>
        {guide ? (
          <div className="p-6 sm:p-8">
            <div className="pr-10">
              <div className="text-[30px]">{guide.icon}</div>
              <h2 className="mt-1 font-display text-[24px] font-bold text-ink">{guide.title}</h2>
              <p className="mt-1 text-[14px] leading-relaxed text-ink2">{guide.summary}</p>
            </div>
            <div className="mt-5 space-y-5">
              {guide.sections.map((s) => (
                <div key={s.heading}>
                  <h3 className="font-display text-[16px] font-semibold text-ink">{s.heading}</h3>
                  <p className="mt-1 text-[14px] leading-relaxed text-ink2">{s.body}</p>
                  {s.bullets ? (
                    <ul className="mt-2 space-y-1.5 text-[13.5px] leading-relaxed text-ink2">
                      {s.bullets.map((b) => (
                        <li key={b} className="flex gap-2">
                          <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
