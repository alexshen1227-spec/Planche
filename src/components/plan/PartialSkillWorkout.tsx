import type { Session, WorkoutRequest } from '../../types'
import { countsSkillDay, skillPlanVersion } from '../../lib/skillSession'
import { useStore } from '../../lib/store'
import { endTheDay } from '../../lib/plan/nextBlock'
import { EXERCISE_BY_ID } from '../../data/exercises'
import { Button } from '../ds'

export function PartialSkillWorkout({ session, startWorkout }: { session: Session; startWorkout: (request: WorkoutRequest) => void }) {
  const { dispatch, state } = useStore()
  const remaining = session.remaining
  if (!remaining) return null
  const rounds = remaining.blocks.reduce((count, b) => count + b.sets, 0)
  return (
    <div>
      <p className="text-body font-semibold text-ink">{session.workoutName}</p>
      <p className="mt-1 text-footnote text-ink2">
        {countsSkillDay(session) ? `${session.sets.length} rounds saved.` : 'Warm-up saved. Your working rounds are still ahead.'}
        {' '}{rounds} {rounds === 1 ? 'round' : 'rounds'} left, starting with {EXERCISE_BY_ID[remaining.blocks[0].exerciseId].name}.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3">
        <Button onClick={() => startWorkout({ source: session.workoutKind, resumeSessionId: session.id })}>Continue skill workout</Button>
        <button onClick={() => {
          dispatch({ type: 'REVISE_SKILL_REMAINDER', sessionId: session.id, from: skillPlanVersion(session), expectedEpoch: state.epoch, skipped: rounds })
          endTheDay()
        }} className="min-h-11 px-1 text-footnote font-medium text-accent-text">End the day here</button>
      </div>
    </div>
  )
}
