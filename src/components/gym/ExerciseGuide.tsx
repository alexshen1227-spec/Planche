import { MUSCLE_BY_ID, PATTERN_LABEL, locationEquipmentLabel } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID, LADDERS, type GymExercise } from '../../data/gym/exercises'
import { DRAGON_FLAG_STEPS } from '../../lib/gym/bodyweightSteps'
import { countUnit } from '../../lib/gym/progression'
import { unloadedLabel } from '../../lib/gym/units'
import { gymDemoSearchUrl } from '../../lib/video'
import { DemoVideoPanel } from '../DemoVideoPanel'
import { ExerciseRating } from './ExerciseRating'

/**
 * Everything about one gym movement in one place — how to do it, what it works, what it needs, how to log it, easier
 * and harder versions, and a demonstration video — with the athlete's rating when `rate` is set. It only reads and
 * rates: opening it never changes a workout in progress.
 */
export function GymExerciseGuide({ exercise, onOpen, rate = false }: { exercise: GymExercise; onOpen: (exercise: GymExercise) => void; rate?: boolean }) {
  const e = exercise
  const equipment = e.needs.map((group) => group.map(locationEquipmentLabel).join(' or ')).join(' + ') || 'Floor'
  const tracking = e.assisted ? 'Log the weight helping you and the reps you complete.'
    : e.pattern === 'carry' ? `Record the load and seconds walked${e.unilateral ? ' on each side. If the times differ, enter the shorter walk' : ' per set'}.${e.load === 'dumbbell' || e.load === 'kettlebell' ? ` Enter the weight of one ${e.load}.` : ''}`
    : countUnit(e) === 'seconds' ? 'Log the seconds held in each set.'
    : e.count === 'contacts' ? 'Log the number of contacts in each set.'
    : e.distanceM ? `One trip is ${e.distanceM} metres. Record the trips you finish in each set.${e.stepFrom === 'sled' ? ' Log the plates you add. Leave weight blank for the empty sled.' : ''}`
    : unloadedLabel(e) === 'Band' ? 'Log your reps. Use the same band and starting stretch when comparing sessions.'
    : e.load === 'bodyweight' ? (e.stepFrom ? 'Record reps and any added weight.' : 'Record the reps you complete.')
    : e.load === 'dumbbell' || e.load === 'kettlebell' ? `Record the weight of one ${e.load} and the reps completed in each set.`
    : 'Record the weight used and reps completed in each working set.'
  // The same movement made easier or harder (`LADDERS`), each one tap away.
  const rungs = e.ladder && !DRAGON_FLAG_STEPS.includes(e.id) ? LADDERS[e.ladder.id].flat().filter((id) => id !== e.id && GYM_EXERCISE_BY_ID[id]) : []
  const easier = rungs.filter((id) => GYM_EXERCISE_BY_ID[id].ladder!.level < e.ladder!.level)
  const harder = rungs.filter((id) => GYM_EXERCISE_BY_ID[id].ladder!.level > e.ladder!.level)
  const versions = (label: string, ids: string[]) => ids.length > 0 && <div>
    <p className="text-ink3">{label}</p>
    <div className="mt-1 flex flex-wrap gap-2">
      {ids.map((id) => <button type="button" key={id} className="min-h-11 rounded-control border border-line px-3 text-accent-text"
        onClick={() => onOpen(GYM_EXERCISE_BY_ID[id])}>{GYM_EXERCISE_BY_ID[id].name}</button>)}
    </div>
  </div>
  return (
    <div className="space-y-3 text-footnote text-ink2">
      <h3 className="text-caption font-semibold uppercase tracking-wide text-ink3">How to do it</h3>
      <p className="text-body leading-relaxed text-ink">{e.cue}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-ink3">Movement</dt><dd>{PATTERN_LABEL[e.pattern]}{e.unilateral ? ' · one side at a time' : ''}</dd>
        <dt className="text-ink3">Main muscles</dt><dd>{e.primary.map((m) => MUSCLE_BY_ID[m].label).join(', ')}</dd>
        {e.secondary.length > 0 && <><dt className="text-ink3">Also works</dt><dd>{e.secondary.map((m) => MUSCLE_BY_ID[m].label).join(', ')}</dd></>}
        <dt className="text-ink3">Equipment</dt><dd>{equipment}</dd>
      </dl>
      <p>{tracking}{e.unilateral && ' Train both sides. Enter the reps or time completed on each side.'}</p>
      {versions('Easier versions', easier)}
      {versions('Harder versions', harder)}
      <DemoVideoPanel exerciseId={e.id} name={e.name} searchUrl={gymDemoSearchUrl(e)} />
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
      {rate && <div className="border-t border-line pt-3"><ExerciseRating exerciseId={e.id} /></div>}
    </div>
  )
}
