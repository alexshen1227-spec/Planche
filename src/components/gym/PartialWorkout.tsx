import { remainingSetCount, resumePartial } from '../../lib/gym/draft'
import { soreJoints } from '../../lib/plan/planner'
import { useStore } from '../../lib/store'
import type { GymSession } from '../../lib/gym/types'
import { Button } from '../ds'

export function PartialWorkout({ session, onContinue }: { session: GymSession; onContinue: () => void }) {
  const { state } = useStore()
  const saved = session.exercises.reduce((n, e) => n + e.sets.length, 0)
  const left = remainingSetCount(session.remaining)
  const place = state.gym?.locations.find((l) => l.id === session.locationId)
  const current = left && place ? resumePartial(session, soreJoints(state, Date.now()).joints, place) : undefined
  const available = current?.items.reduce((n, it) => n + it.sets.length, 0) ?? 0
  return (
    <div>
      <p className="text-body font-semibold">{session.name} saved partway</p>
      <p className="mt-1 text-footnote text-ink2">
        {saved} {saved === 1 ? 'set' : 'sets'} logged{left ? ` · ${left} ${left === 1 ? 'set' : 'sets'} left` : ''}.
      </p>
      {left > available && <p className="mt-1 text-footnote text-ink2">
        {left - available} {left - available === 1 ? 'set is' : 'sets are'} held for your current equipment or joint check.
      </p>}
      {available > 0 && <Button className="mt-3" onClick={onContinue}>Continue {available} remaining {available === 1 ? 'set' : 'sets'}</Button>}
    </div>
  )
}
