import { BadgeGlyph, Button, EmptyState, SegmentedControl, ToggleChip } from '../components/ds'
import { useMemo, useState } from 'react'
import type { Category, Exercise } from '../types'
import { useStore } from '../lib/store'
import { EXERCISES, CATEGORY_LABEL } from '../data/exercises'
import { GUIDES, GUIDE_GROUPS, GLOSSARY, type Guide } from '../data/learn'
import { demoSearchUrl, youtubeId } from '../lib/video'
import { MovementDemo } from '../components/MovementDemo'
import { pushToast } from '../lib/toast'
import { fmtHold, fmtDate } from '../lib/time'
import { Icon } from '../components/Icon'
import { Modal } from '../components/ui'
import { ClipGallery } from '../components/ClipGallery'
import { isFilmable } from '../lib/poseForm'
import { ladderOfExercise } from '../lib/repLadder'
import { activeSkills } from '../lib/skills'
import { GYM_EXERCISES, type GymExercise } from '../data/gym/exercises'
import { MUSCLE_BY_ID, PATTERN_LABEL, locationEquipmentLabel } from '../data/gym/catalog'
import { GymExerciseGuide } from '../components/gym/ExerciseGuide'

type LibraryCategory = Category | 'all' | 'gym'
const CATS: LibraryCategory[] = [
  'all',
  'gym',
  'planche',
  'lever',
  'handstand',
  'ninety',
  'flag',
  'push',
  'pull',
  'scapula',
  'core',
  'wrist',
  'general',
  'mobility',
]

type Move = Exercise | GymExercise
const normalise = (text: string) => text.toLowerCase().replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim()
const moves = ([...EXERCISES, ...GYM_EXERCISES] as Move[]).map((exercise) => {
  const gym = 'pattern' in exercise
  const words = gym
    ? [exercise.cue, PATTERN_LABEL[exercise.pattern], ...exercise.primary.map((m) => MUSCLE_BY_ID[m].label),
        ...exercise.secondary.map((m) => MUSCLE_BY_ID[m].label), ...exercise.needs.flat().map(locationEquipmentLabel)]
    : [exercise.blurb, ...exercise.howTo, ...exercise.cues, ...exercise.mistakes, ...exercise.muscles]
  return { exercise, category: gym ? 'gym' : exercise.category, name: normalise(exercise.name), search: normalise([exercise.name, ...words].join(' ')) }
})

export function Library() {
  const [pane, setPane] = useState<'exercises' | 'basics'>('exercises')

  return (
    <div className="animate-rise">
      <h1 className="font-display text-title1 font-bold text-ink">Learn</h1>
      <p className="mt-0.5 text-body text-ink2">
        {pane === 'exercises'
          ? 'Every movement the programs use — how to do it, what to feel, what to avoid.'
          : 'Plain-English guides and the jargon decoded. Start here if you are new.'}
      </p>
      <SegmentedControl
        className="mt-4"
        label="Learn section"
        value={pane}
        onChange={setPane}
        options={[
          { value: 'exercises' as const, label: 'Exercises' },
          { value: 'basics' as const, label: 'Basics' },
        ]}
      />

      {pane === 'exercises' ? <ExercisePane /> : <BasicsPane />}
    </div>
  )
}

function ExercisePane() {
  const { state } = useStore()
  const [cat, setCat] = useState<LibraryCategory>('all')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<Move | null>(null)
  const [limit, setLimit] = useState(24)
  const gymFirst = state.gym?.prefs?.goals.skills === 0

  const list = useMemo(() => {
    const q = normalise(query)
    const terms = q.split(' ').filter(Boolean)
    const matches = moves.filter((m) => (cat === 'all' || m.category === cat) && terms.every((term) => m.search.includes(term)))
    const rank = (m: (typeof moves)[number]) => !q ? 0 : m.name === q ? 0 : m.name.startsWith(q) ? 1 : m.name.includes(q) ? 2 : 3
    return matches.sort((a, b) => rank(a) - rank(b) || (gymFirst ? Number(b.category === 'gym') - Number(a.category === 'gym') : 0))
  }, [cat, query, gymFirst])

  return (
    <>
      <div className="relative mt-4">
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setLimit(24) }}
          aria-label="Search exercises"
          placeholder="Search cues, muscles…"
          className="min-h-11 w-full rounded-control border border-line bg-surface pl-4 pr-12 text-body text-ink outline-none placeholder:text-ink3 focus:border-accent"
        />
        {query ? (
          <button
            onClick={() => { setQuery(''); setLimit(24) }}
            aria-label="Clear exercise search"
            className="absolute right-0 top-0 grid h-11 w-11 place-items-center rounded-full text-ink3 transition hover:text-ink"
          >
            <Icon name="x" size={16} />
          </button>
        ) : null}
      </div>
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Category">
        {CATS.map((c) => (
          <div key={c} className="shrink-0">
            <ToggleChip active={cat === c} onClick={() => { setCat(c); setLimit(24) }}>
              {c === 'all' ? 'All' : c === 'gym' ? 'Gym' : CATEGORY_LABEL[c]}
            </ToggleChip>
          </div>
        ))}
      </div>
      <p className="mt-3 text-footnote text-ink3 tnum">
        {list.length} move{list.length === 1 ? '' : 's'}
      </p>

      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {list.slice(0, limit).map(({ exercise: e }) => {
          if ('pattern' in e) {
            return (
              <li key={`gym-${e.id}`}>
                <button onClick={() => setDetail(e)} aria-label={`${e.name}, gym exercise, ${PATTERN_LABEL[e.pattern]}`} className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised">
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold">{e.name}</span>
                    <span className="mt-1 block text-footnote text-ink2">Gym · {PATTERN_LABEL[e.pattern]} · {e.primary.map((m) => MUSCLE_BY_ID[m].label).join(', ')}</span>
                  </span>
                  <Icon name="chevronR" size={16} className="shrink-0 text-ink3" />
                </button>
              </li>
            )
          }
          const pr = state.prs[e.id]
          const pinned = state.videoLinks[e.id]
          return (
            <li key={e.id}>
              <button
                onClick={() => setDetail(e)}
                className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-body font-semibold text-ink">{e.name}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold uppercase tracking-wide ${
                        e.type === 'hold' ? 'bg-accent-soft text-accent-text' : 'bg-info-soft text-info-text'
                      }`}
                    >
                      {e.type}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-footnote text-ink2">{e.blurb}</p>
                  <div className="mt-1.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1" aria-label={`Difficulty ${e.difficulty} of 5`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n} className={`h-1.5 w-4 rounded-full ${n <= e.difficulty ? 'bg-accent' : 'bg-line'}`} />
                      ))}
                    </div>
                    <span className="flex items-center gap-2 text-caption text-ink3">
                      {pinned ? <Icon name="play" size={12} className="text-accent-text" /> : null}
                      {pr ? (
                        <span className="font-medium text-ink2 tnum">
                          best {e.type === 'hold' ? fmtHold(pr.value) : `${pr.value} reps`}
                        </span>
                      ) : (
                        CATEGORY_LABEL[e.category]
                      )}
                    </span>
                  </div>
                </div>
                <Icon name="chevronR" size={16} className="shrink-0 text-ink3" />
              </button>
            </li>
          )
        })}
      </ul>
      {list.length > limit && <Button full variant="secondary" className="mt-3" onClick={() => setLimit(limit + 24)}>Show more exercises</Button>}
      {list.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-line-strong">
          <EmptyState icon="book" title="No matches">
            Nothing matches that search.
          </EmptyState>
        </div>
      ) : null}

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        label={detail ? `${detail.name} exercise guide` : 'Exercise guide'}
        wide
      >
        {detail && ('pattern' in detail ? (
          <div className="space-y-4 p-4 sm:p-6">
            <h2 className="pr-10 font-display text-title2 font-bold text-ink">{detail.name}</h2>
            <GymExerciseGuide exercise={detail} />
          </div>
        ) : <ExerciseDetail exercise={detail} />)}
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
    <div className="mt-4 rounded-card border border-line bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-footnote font-semibold text-ink">
          <Icon name="play" size={14} className="text-accent-text" /> Demo video
        </div>
        <div className="flex items-center gap-2">
          <a
            href={demoSearchUrl(exercise)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-footnote font-medium text-ink2 transition hover:text-ink"
          >
            Find demos <Icon name="arrowR" size={13} />
          </a>
          <button
            onClick={() => {
              setDraft(pinned ?? '')
              setEditing((v) => !v)
            }}
            className="min-h-11 rounded-lg border border-line bg-surface px-3 py-1.5 text-footnote font-medium text-ink2 transition hover:text-ink"
          >
            {pinned ? 'Change' : 'Pin one'}
          </button>
        </div>
      </div>

      {!editing ? (
        <>
          <MovementDemo name={exercise.name} exerciseId={exercise.id} pinnedUrl={pinned} />
          {pinnedId && <button
            onClick={() => {
              dispatch({ type: 'SET_VIDEO', exerciseId: exercise.id, url: null })
              pushToast('Pinned video removed.', 'info')
            }}
            className="mt-2 min-h-11 text-footnote font-medium text-ink3 hover:text-danger-text"
          >
            Remove pinned video
          </button>}
        </>
      ) : (
        <div className="mt-3">
          <p className="text-footnote leading-relaxed text-ink2">
            Found a demo you like? Paste its YouTube link and it will play right here, every time.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              aria-label="YouTube demonstration link"
              placeholder="https://youtube.com/watch?v=…"
              className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-2 text-footnote text-ink outline-none placeholder:text-ink3 focus:border-accent"
            />
            <Button
              onClick={save}
              className=" "
            >
              Pin
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ExerciseDetail({ exercise: e }: { exercise: Exercise }) {
  const { state } = useStore()
  const pr = state.prs[e.id]
  return (
    <div className="p-4 sm:p-6">
      <div className="pr-10">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-footnote font-semibold uppercase tracking-wider text-accent-text">
            {CATEGORY_LABEL[e.category]}
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-caption font-semibold uppercase tracking-wide ${
              e.type === 'hold' ? 'bg-accent-soft text-accent-text' : 'bg-info-soft text-info-text'
            }`}
          >
            {e.type === 'hold' ? 'timed hold' : 'reps'}
          </span>
        </div>
        <h2 className="mt-1 font-display text-title1 font-bold text-ink">{e.name}</h2>
        <p className="mt-1 text-body leading-relaxed text-ink2">{e.blurb}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-footnote">
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

      {isFilmable(e.id) || ladderOfExercise(e.id) ? (
        <div className="mt-4 rounded-card border border-line bg-raised p-4">
          <div className="flex items-center gap-1.5 text-footnote font-semibold text-ink">
            <Icon name="monitor" size={14} className="text-accent-text" /> Your recorded sets
          </div>
          <p className="mt-1 text-footnote leading-relaxed text-ink3">
            {isFilmable(e.id)
              ? 'Compare your current position against an older one — pin a clip to keep it as your reference.'
              : 'Replays of your filmed sets. A set still in your history can be reviewed here, and one you pass counts toward its rung.'}
          </p>
          <ClipGallery exerciseId={e.id} />
        </div>
      ) : null}

      <div className="mt-4 rounded-card border border-line bg-raised p-4">
        <div className="mb-2 text-footnote font-semibold text-ink">How to do it</div>
        <ol className="space-y-1.5 text-footnote leading-relaxed text-ink2">
          {e.howTo.map((s, i) => (
            <li key={s} className="flex gap-2.5">
              <span className="font-display font-semibold text-accent-text tnum">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-raised p-4">
          <div className="mb-2 flex items-center gap-1.5 text-footnote font-semibold text-ok-text">
            <Icon name="check" size={14} /> Cues
          </div>
          <ul className="space-y-1.5 text-footnote leading-relaxed text-ink2">
            {e.cues.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink3" />
                {c}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-card border border-line bg-raised p-4">
          <div className="mb-2 flex items-center gap-1.5 text-footnote font-semibold text-danger-text">
            <Icon name="x" size={14} /> Watch out for
          </div>
          <ul className="space-y-1.5 text-footnote leading-relaxed text-ink2">
            {e.mistakes.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink3" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 text-footnote text-ink3">
        <span className="font-medium text-ink2">Works:</span> {e.muscles.join(', ')}
        {e.perSide ? ' · train both sides evenly' : ''}
      </div>
    </div>
  )
}

function BasicsPane() {
  const { state } = useStore()
  const mine = activeSkills(state)
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
      {GUIDE_GROUPS.map((group) => {
        // The roads the athlete trains come first; the rest are still there to read.
        const guides = GUIDES.filter((g) => g.group === group.id).sort(
          (a, b) => Number(Boolean(b.skill && mine.includes(b.skill))) - Number(Boolean(a.skill && mine.includes(a.skill))),
        )
        return (
          <section key={group.id} className="mt-6" aria-labelledby={`guides-${group.id}`}>
            <h2 id={`guides-${group.id}`} className="font-display text-title3 font-semibold text-ink">
              {group.title}
            </h2>
            <p className="mt-0.5 text-footnote text-ink3">{group.blurb}</p>
            {group.id === 'skill' ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {guides.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setGuide(g)}
                    className="ds-press flex min-h-[132px] flex-col items-start rounded-card border border-line bg-surface p-4 text-left"
                  >
                    <BadgeGlyph icon={g.icon} size={44} />
                    <div className="mt-3 font-display text-body font-semibold leading-snug text-ink">{g.title}</div>
                    <p className="mt-0.5 line-clamp-2 text-caption leading-snug text-ink2">{g.summary}</p>
                    {g.skill && mine.includes(g.skill) ? (
                      <span className="mt-auto pt-2 text-caption font-semibold text-accent-text">you train this</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                {guides.map((g) => (
                  <li key={g.id}>
                    <button
                      onClick={() => setGuide(g)}
                      className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised"
                    >
                      <BadgeGlyph icon={g.icon} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-body font-semibold text-ink">{g.title}</span>
                        <span className="mt-0.5 line-clamp-2 block text-footnote text-ink2">{g.summary}</span>
                      </span>
                      <Icon name="chevronR" size={16} className="shrink-0 text-ink3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}

      <h2 className="mt-6 font-display text-title3 font-semibold text-ink">Glossary</h2>
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search terms…"
        aria-label="Search terms"
        className="mt-3 min-h-11 w-full rounded-control border border-line bg-surface px-4 text-body text-ink outline-none placeholder:text-ink3 focus:border-accent"
      />
      <div className="mt-3 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {terms.map((t) => (
          <div key={t.term} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-body font-semibold text-ink">{t.term}</span>
              <span className="text-footnote text-accent-text">{t.short}</span>
            </div>
            <p className="mt-1 text-footnote leading-relaxed text-ink2">{t.detail}</p>
          </div>
        ))}
      </div>
      {terms.length === 0 ? (
        <div className="mt-3 rounded-card border border-dashed border-line-strong">
          <EmptyState icon="book" title="No terms match">
            No terms match that.
          </EmptyState>
        </div>
      ) : null}

      <Modal
        open={guide !== null}
        onClose={() => setGuide(null)}
        label={guide?.title ?? 'Training basics guide'}
        wide
      >
        {guide ? (
          <div className="p-4 sm:p-6">
            <div className="pr-10">
              <BadgeGlyph icon={guide.icon} size={52} />
              <h2 className="mt-1 font-display text-title1 font-bold text-ink">{guide.title}</h2>
              <p className="mt-1 text-body leading-relaxed text-ink2">{guide.summary}</p>
            </div>
            <div className="mt-5 space-y-5">
              {guide.sections.map((s) => (
                <div key={s.heading}>
                  <h3 className="font-display text-title3 font-semibold text-ink">{s.heading}</h3>
                  <p className="mt-1 text-body leading-relaxed text-ink2">{s.body}</p>
                  {s.bullets ? (
                    <ul className="mt-2 space-y-1.5 text-footnote leading-relaxed text-ink2">
                      {s.bullets.map((b) => (
                        <li key={b} className="flex gap-2">
                          <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {s.link ? (
                    <a
                      href={s.link.href}
                      {...(/^https?:/.test(s.link.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-control border border-accent/30 bg-accent-soft px-4 py-2 text-footnote font-semibold text-accent-text transition hover:brightness-105"
                    >
                      {s.link.label} <Icon name="chevronR" size={14} />
                    </a>
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
