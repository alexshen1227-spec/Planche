import { useMemo, useState } from 'react'
import { PATTERN_LABEL, locationEquipmentLabel } from '../../data/gym/catalog'
import type { GymExercise } from '../../data/gym/exercises'
import { RATING_CHOICES } from '../../lib/gym/availability'
import { FOCUS_LABEL, type GymFocus } from '../../lib/gym/focus'
import { missingKit, pickerRows, type PickerRow } from '../../lib/gym/picker'
import type { GymLocation, Rating } from '../../lib/gym/types'
import { Icon } from '../Icon'
import { Button, ToggleChip } from '../ds'
import { GymExerciseGuide } from './ExerciseGuide'

const LIST_STEP = 40

/**
 * Pick a movement inside a workout, to swap one or to add one: the app's recommendations on top, then the whole bank,
 * searchable by name, muscle, movement or equipment. Each row has its guide one tap away (how to do it, a video),
 * read without leaving the list. What today's joint check or switched-off muscles keep out is not offered; how many
 * that hides is said.
 */
export function ExercisePicker({
  title,
  intro,
  pickLabel,
  location,
  ratings,
  day,
  exclude,
  allowed,
  recommended,
  hiddenNote,
  onPick,
}: {
  title: string
  intro?: string
  /** The button on a guide opened from the list, e.g. "Swap to this". */
  pickLabel: string
  location: GymLocation
  ratings: Record<string, Rating>
  /** The day's focus: the list starts narrowed to it, with one tap to every exercise. */
  day?: GymFocus
  exclude: readonly string[]
  allowed: (e: GymExercise) => boolean
  recommended: readonly GymExercise[]
  /** What the search found that today's rails keep out, said with the reasons (counted by the caller). */
  hiddenNote?: (hidden: readonly GymExercise[]) => string | undefined
  onPick: (exerciseId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [dayOnly, setDayOnly] = useState(Boolean(day && day !== 'full'))
  const [anyEquipment, setAnyEquipment] = useState(false)
  const [limit, setLimit] = useState(LIST_STEP)
  const [peek, setPeek] = useState<GymExercise | null>(null)
  const rows = useMemo(() => pickerRows({ location, ratings, query, ...(dayOnly && day ? { day } : {}), anyEquipment, exclude, allowed, recommended }),
    [location, ratings, query, dayOnly, day, anyEquipment, exclude, allowed, recommended])

  if (peek) {
    return (
      <div>
        <button type="button" onClick={() => setPeek(null)} className="inline-flex min-h-11 items-center gap-1 text-footnote font-semibold text-accent-text">
          <Icon name="chevronL" size={15} /> Back to the list
        </button>
        <h2 className="mt-1 text-title3 font-semibold">{peek.name}</h2>
        <div className="mt-2"><GymExerciseGuide exercise={peek} onOpen={setPeek} rate /></div>
        {!exclude.includes(peek.id) && allowed(peek) && <Button full size="lg" className="mt-4" onClick={() => onPick(peek.id)}>{pickLabel}</Button>}
      </div>
    )
  }

  const item = (row: PickerRow) => {
    const e = row.exercise
    const rated = RATING_CHOICES.find((c) => c.value === row.rating)
    const needs = row.here ? '' : missingKit(e, location).map((g) => g.map(locationEquipmentLabel).join(' or ')).join(' + ')
    return (
      <li key={e.id} className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => onPick(e.id)}
          className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-2 rounded-control border border-line px-3 py-2 text-left"
        >
          <span className="min-w-0">
            <span className="block text-body font-medium">{e.name}</span>
            {needs ? <span className="block text-caption text-ink3">Needs {needs}, not listed at {location.name}</span> : null}
          </span>
          <span className="shrink-0 text-right text-caption text-ink3">
            {rated ? <span className={`block font-semibold ${row.rating === 'avoid' || row.rating === 'dislike' ? 'text-danger-text' : 'text-accent-text'}`}>{rated.label}</span> : null}
            {PATTERN_LABEL[e.pattern]}
          </span>
        </button>
        <button type="button" onClick={() => setPeek(e)} aria-label={`How to do ${e.name}`}
          className="grid min-h-12 w-11 shrink-0 place-items-center rounded-control border border-line text-ink2">
          <Icon name="info" size={16} />
        </button>
      </li>
    )
  }

  return (
    <div>
      <h2 className="text-title3 font-semibold">{title}</h2>
      {intro ? <p className="mt-1 text-footnote text-ink2">{intro}</p> : null}
      <input
        type="search"
        value={query}
        onChange={(ev) => { setQuery(ev.target.value); setLimit(LIST_STEP) }}
        placeholder="Search by name, muscle or equipment"
        className="mt-3 min-h-11 w-full rounded-control border border-line bg-raised px-3 text-body"
        aria-label="Search exercises"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {day && day !== 'full' && <>
          <ToggleChip active={dayOnly} onClick={() => { setDayOnly(true); setLimit(LIST_STEP) }}>{FOCUS_LABEL[day]} day</ToggleChip>
          <ToggleChip active={!dayOnly} onClick={() => { setDayOnly(false); setLimit(LIST_STEP) }}>All exercises</ToggleChip>
        </>}
        <ToggleChip active={anyEquipment} onClick={() => { setAnyEquipment((v) => !v); setLimit(LIST_STEP) }}>
          Include equipment {location.name} does not list
        </ToggleChip>
      </div>
      {rows.recommended.length > 0 && <>
        <h3 className="mt-4 text-caption font-semibold uppercase tracking-wide text-ink3">Recommended</h3>
        <ul className="mt-2 space-y-2">{rows.recommended.map(item)}</ul>
      </>}
      {rows.rest.length > 0 && <>
        <h3 className="mt-4 text-caption font-semibold uppercase tracking-wide text-ink3">
          {query ? 'Matches' : 'All exercises'} · {rows.rest.length}
        </h3>
        <ul className="mt-2 space-y-2">{rows.rest.slice(0, limit).map(item)}</ul>
        {rows.rest.length > limit && <Button variant="secondary" full className="mt-3" onClick={() => setLimit((n) => n + LIST_STEP)}>Show more exercises</Button>}
      </>}
      {!rows.recommended.length && !rows.rest.length && <p className="mt-4 text-footnote text-ink2">
        No matching exercises{dayOnly && day ? ` for this ${FOCUS_LABEL[day].toLowerCase()} day. Choose All exercises to search every focus` : ''}{!anyEquipment ? `${dayOnly && day ? ', or include' : '. Try including'} equipment ${location.name} does not list` : ''}.
      </p>}
      {rows.hidden.length > 0 && <p className="mt-3 text-caption text-ink3">
        {hiddenNote?.(rows.hidden) ?? `${rows.hidden.length} more ${rows.hidden.length === 1 ? 'is' : 'are'} kept out today.`}
      </p>}
    </div>
  )
}
