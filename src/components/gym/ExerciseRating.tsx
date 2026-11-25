import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { RATING_CHOICES } from '../../lib/gym/availability'
import { useStore } from '../../lib/store'

/**
 * How much the athlete likes a movement: love, like, fine, dislike or avoid. The planner picks among comparable
 * movements by it (`rotation.ts`), so it changes how often each one comes up. Tapping the chosen rating clears it.
 */
export function ExerciseRating({ exerciseId, explain = true }: { exerciseId: string; explain?: boolean }) {
  const { state, dispatch } = useStore()
  if (!state.gym) return null
  const rating = state.gym.ratings[exerciseId]
  const name = GYM_EXERCISE_BY_ID[exerciseId]?.name ?? 'this exercise'
  const chosen = RATING_CHOICES.find((c) => c.value === rating)
  return (
    <div>
      {explain && <p className="text-caption font-medium text-ink3">
        How do you like it? {chosen ? `${chosen.label}: ${chosen.effect} when it fits the day.` : 'Not rated yet. Rate it to set how often the plan picks it.'}
      </p>}
      <div role="group" aria-label={`How much you like ${name}`} className={`${explain ? 'mt-2 ' : ''}grid grid-cols-5 gap-1.5`}>
        {RATING_CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={rating === c.value}
            aria-label={`${c.label} ${name}: ${c.effect}`}
            onClick={() => dispatch({ type: 'GYM', op: { op: 'rate', exerciseId, rating: rating === c.value ? null : c.value } })}
            className={`min-h-11 rounded-control border px-1 text-footnote font-medium ${rating === c.value
              ? c.value === 'avoid' || c.value === 'dislike' ? 'border-transparent bg-danger-soft text-danger-text' : 'border-transparent bg-accent text-on-accent'
              : 'border-line text-ink2'}`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}
