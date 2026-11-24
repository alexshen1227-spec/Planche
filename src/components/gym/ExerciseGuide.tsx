import { MUSCLE_BY_ID, locationEquipmentLabel } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID, type GymExercise } from '../../data/gym/exercises'
import { DRAGON_FLAG_STEPS } from '../../lib/gym/bodyweightSteps'
import { countUnit } from '../../lib/gym/progression'
import { unloadedLabel } from '../../lib/gym/units'
import { MovementDemo } from '../MovementDemo'

export function GymExerciseGuide({ exercise, onOpen }: { exercise: GymExercise; onOpen: (exercise: GymExercise) => void }) {
  const e = exercise
  const equipment = e.needs.map((group) => group.map(locationEquipmentLabel).join(' or ')).join(' + ') || 'Floor'
  const tracking = e.assisted ? 'Log the weight helping you and the reps you complete.'
    : countUnit(e) === 'seconds' ? 'Log the seconds held in each set.'
    : e.count === 'contacts' ? 'Log the number of contacts in each set.'
    : e.distanceM ? `One trip is ${e.distanceM} metres. Record the trips you finish in each set.${e.stepFrom === 'sled' ? ' Log the plates you add. Leave weight blank for the empty sled.' : ''}`
    : unloadedLabel(e) === 'Band' ? 'Log your reps. Use the same band and starting stretch when comparing sessions.'
    : e.load === 'bodyweight' ? (e.stepFrom ? 'Record reps and any added weight.' : 'Record the reps you complete.')
    : e.load === 'dumbbell' || e.load === 'kettlebell' ? `Record the weight of one ${e.load} and the reps completed in each set.`
    : 'Record the weight used and reps completed in each working set.'
  return (
    <div className="space-y-3 text-footnote text-ink2">
      <p className="text-body leading-relaxed text-ink">{e.cue}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-ink3">Main muscles</dt><dd>{e.primary.map((m) => MUSCLE_BY_ID[m].label).join(', ')}</dd>
        {e.secondary.length > 0 && <><dt className="text-ink3">Also works</dt><dd>{e.secondary.map((m) => MUSCLE_BY_ID[m].label).join(', ')}</dd></>}
        <dt className="text-ink3">Equipment</dt><dd>{equipment}</dd>
      </dl>
      <p>{tracking}{e.unilateral && ' Train both sides. Enter the reps or time completed on each side.'}</p>
      <MovementDemo exerciseId={e.id} name={e.name} />
      {DRAGON_FLAG_STEPS.includes(e.id) && <div className="space-y-2 border-t border-line pt-3">
        <h3 className="text-body font-semibold text-ink">Dragon flag progression</h3>
        <p>Start with a version you can lower smoothly onto your upper back. If the hips fold or your neck takes the load, shorten the lever. Lengthen it when each rep stays controlled through the same depth.</p>
        <div className="flex flex-wrap gap-2">
          {['reverse-crunch', ...DRAGON_FLAG_STEPS].map((id) =>
            id === e.id ? <span key={id} aria-current="step" className="inline-flex min-h-11 items-center rounded-control bg-accent-soft px-3 font-semibold text-ink">{e.name}</span> :
            <button type="button" key={id} className="min-h-11 rounded-control border border-line px-3 text-accent-text"
              onClick={() => onOpen(GYM_EXERCISE_BY_ID[id])}>{GYM_EXERCISE_BY_ID[id].name}</button>)}
        </div>
      </div>}
    </div>
  )
}
