import { remainingSetCount } from '../../lib/gym/draft'
import type { GymSession } from '../../lib/gym/types'
import { Button } from '../ds'

export function PartialWorkout({ session, onContinue }: { session: GymSession; onContinue: () => void }) {
  const saved = session.exercises.reduce((n, e) => n + e.sets.length, 0)
  const left = remainingSetCount(session.remaining)
  return (
    <div>
      <p className="text-body font-semibold">{session.name} saved partway</p>
      <p className="mt-1 text-footnote text-ink2">
        {saved} {saved === 1 ? 'set' : 'sets'} logged{left ? ` · ${left} ${left === 1 ? 'set' : 'sets'} left` : ''}.
      </p>
      {left > 0 && <Button className="mt-3" onClick={onContinue}>Continue {left} remaining {left === 1 ? 'set' : 'sets'}</Button>}
    </div>
  )
}
