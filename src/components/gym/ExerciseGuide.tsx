import { MUSCLE_BY_ID, locationEquipmentLabel } from '../../data/gym/catalog'
import type { GymExercise } from '../../data/gym/exercises'
import { countUnit } from '../../lib/gym/progression'
import { unloadedLabel } from '../../lib/gym/units'
import { MovementDemo } from '../MovementDemo'

export function GymExerciseGuide({ exercise }: { exercise: GymExercise }) {
  const e = exercise
  const equipment = e.needs.map((group) => group.map(locationEquipmentLabel).join(' or ')).join(' + ') || 'Floor'
  const tracking = e.assisted ? 'Log the weight helping you and the reps you complete.'
    : countUnit(e) === 'seconds' ? 'Log the seconds held in each set.'
    : e.count === 'contacts' ? 'Log the number of contacts in each set.'
    : e.distanceM ? `Each rep covers ${e.distanceM} metres. Record the reps you complete.`
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
    </div>
  )
}
