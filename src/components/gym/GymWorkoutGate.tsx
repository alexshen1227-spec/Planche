import { useRef } from 'react'
import { adaptOpenDraft, loadDraft, type GymDraft } from '../../lib/gym/draft'
import type { GymLocation } from '../../lib/gym/types'
import { useStore } from '../../lib/store'
import { WorkoutWriter } from '../WorkoutWriter'
import { GymPlayer } from './GymPlayer'

export function GymWorkoutGate({ draft, location, onClose }: { draft: GymDraft; location: GymLocation; onClose: () => void }) {
  const { getState } = useStore()
  const hadDraft = useRef(Boolean(loadDraft(getState().epoch)))
  const placeFor = (source: GymDraft) => getState().gym?.locations.find((l) => l.id === source.locationId) ?? location
  const open = () => {
    const epoch = getState().epoch
    if (draft.epoch && draft.epoch !== epoch) return null
    const latest = loadDraft(epoch)
    const existing = getState().gym?.sessions.find((s) => s.id === draft.id)
    if (!latest && (hadDraft.current || (existing && draft.resumeFrom === undefined))) return null
    const source = latest ?? draft
    return { ...adaptOpenDraft(source, draft.avoidJoints ?? [], (draft.volumeFactor ?? 1) <= 0.6, placeFor(source)), epoch }
  }
  return <WorkoutWriter ownerKey="planchelab.gymWriter" load={open} onClose={onClose}>
    {(source, owns) => <GymPlayer draft={source} location={placeFor(source)} onClose={onClose} canEdit={owns} />}
  </WorkoutWriter>
}
