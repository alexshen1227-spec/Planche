import { useMemo, useState } from 'react'
import { MUSCLE_BY_ID, PATTERN_LABEL } from '../../data/gym/catalog'
import { GYM_EXERCISES, type GymExercise } from '../../data/gym/exercises'
import { canDoHere, RATING_CHOICES, searchExercises } from '../../lib/gym/availability'
import type { GymLocation } from '../../lib/gym/types'
import { useStore } from '../../lib/store'
import { Icon } from '../Icon'
import { Button, ToggleChip } from '../ds'
import { GymExerciseGuide } from './ExerciseGuide'
import { ExerciseRating } from './ExerciseRating'

const LIST_STEP = 30

type Filter = 'all' | 'rated' | 'unrated' | 'here'

/**
 * Every exercise in the bank with the athlete's rating, searchable. The planner picks among comparable movements by
 * these ratings (`rotation.ts`): loved ones most often, disliked ones rarely, avoided ones never, and an unrated
 * movement now and then so the list keeps growing.
 */
export function ExerciseRatings({ location }: { location?: GymLocation }) {
  const { state } = useStore()
  const ratings = useMemo(() => state.gym?.ratings ?? {}, [state.gym?.ratings])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(LIST_STEP)
  const [peek, setPeek] = useState<GymExercise | null>(null)
  const rated = Object.keys(ratings).filter((id) => GYM_EXERCISES.some((e) => e.id === id)).length
  // The exercises already done come first, most recent first: those are the ones there is an opinion about.
  const sessions = state.gym?.sessions
  const lastDone = useMemo(() => {
    const at = new Map<string, number>()
    for (const s of sessions ?? []) for (const log of s.exercises) if (log.sets.length) at.set(log.exerciseId, Math.max(at.get(log.exerciseId) ?? 0, s.startedAt))
    return at
  }, [sessions])
  const list = useMemo(() => searchExercises(GYM_EXERCISES, query)
    .filter((e) => filter === 'all' || (filter === 'rated' ? Boolean(ratings[e.id]) : filter === 'unrated' ? !ratings[e.id] : canDoHere(e.id, location)))
    .sort((a, b) => (lastDone.get(b.id) ?? 0) - (lastDone.get(a.id) ?? 0) || a.name.localeCompare(b.name)), [query, filter, ratings, location, lastDone])

  if (peek) {
    return (
      <div>
        <button type="button" onClick={() => setPeek(null)} className="inline-flex min-h-11 items-center gap-1 text-footnote font-semibold text-accent-text">
          <Icon name="chevronL" size={15} /> Back to the list
        </button>
        <h2 className="mt-1 text-title3 font-semibold">{peek.name}</h2>
        <div className="mt-2"><GymExerciseGuide exercise={peek} onOpen={setPeek} rate /></div>
      </div>
    )
  }

  const choose = (next: Filter) => {
    setFilter(next)
    setLimit(LIST_STEP)
  }
  return (
    <div>
      <h2 className="text-title3 font-semibold">Exercise ratings</h2>
      <p className="mt-1 text-footnote text-ink2">
        When two exercises would do the same job, the plan picks the one you rate higher more often. Unrated ones come up
        now and then so you get to try them. A rating never changes a workout you have already started.
      </p>
      <p className="mt-1 text-caption text-ink3">{RATING_CHOICES.map((c) => `${c.label}: ${c.effect}`).join(' · ')}</p>
      <input
        type="search"
        value={query}
        onChange={(ev) => { setQuery(ev.target.value); setLimit(LIST_STEP) }}
        placeholder="Search by name, muscle or equipment"
        className="mt-3 min-h-11 w-full rounded-control border border-line bg-raised px-3 text-body"
        aria-label="Search exercises to rate"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <ToggleChip active={filter === 'all'} onClick={() => choose('all')}>All</ToggleChip>
        <ToggleChip active={filter === 'rated'} onClick={() => choose('rated')}>Rated · {rated}</ToggleChip>
        <ToggleChip active={filter === 'unrated'} onClick={() => choose('unrated')}>Not rated</ToggleChip>
        {location && <ToggleChip active={filter === 'here'} onClick={() => choose('here')}>Possible at {location.name}</ToggleChip>}
      </div>
      <ul className="mt-3 divide-y divide-line">
        {list.slice(0, limit).map((e) => (
          <li key={e.id} className="py-3">
            <button type="button" onClick={() => setPeek(e)} aria-label={`How to do ${e.name}`}
              className="flex min-h-11 w-full items-center justify-between gap-2 text-left">
              <span className="min-w-0">
                <span className="block text-body font-medium">{e.name}</span>
                <span className="block text-caption text-ink3">
                  {PATTERN_LABEL[e.pattern]} · {e.primary.map((m) => MUSCLE_BY_ID[m].label).join(', ')}{lastDone.has(e.id) ? ' · done before' : ''}
                </span>
              </span>
              <Icon name="info" size={16} />
            </button>
            <div className="mt-1.5"><ExerciseRating exerciseId={e.id} explain={false} /></div>
          </li>
        ))}
      </ul>
      {!list.length && <p className="mt-3 text-footnote text-ink2">
        {filter === 'rated' && !query ? 'Nothing rated yet. Rate exercises here, from a workout or from their guide in Learn.' : 'No matching exercises.'}
      </p>}
      {list.length > limit && <Button variant="secondary" full className="mt-3" onClick={() => setLimit((n) => n + LIST_STEP)}>Show more exercises</Button>}
    </div>
  )
}
