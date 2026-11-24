import { useRef } from 'react'
import { adaptOpenDraft, loadDraft, type GymDraft } from '../../lib/gym/draft'
import type { GymLocation } from '../../lib/gym/types'
import { useStore } from '../../lib/store'
import { WorkoutWriter } from '../WorkoutWriter'
import { GymPlayer } from './GymPlayer'
import { pushToast } from '../../lib/toast'

export function GymWorkoutGate({ draft, location, replacing, onClose }: { draft: GymDraft; location: GymLocation; replacing?: GymDraft | null; onClose: () => void }) {
  const { getState } = useStore()
  const hadDraft = useRef(Boolean(loadDraft(getState().epoch)))
  const placeFor = (source: GymDraft) => getState().gym?.locations.find((l) => l.id === source.locationId) ?? location
  const open = () => {
    const epoch = getState().epoch
    if (draft.epoch && draft.epoch !== epoch) return null
    const latest = loadDraft(epoch)
    const existing = getState().gym?.sessions.find((s) => s.id === draft.id)
    if (!latest && (replacing || hadDraft.current || (existing && draft.resumeFrom === undefined))) return null
    // Acquire the workout writer before replacing its snapshot. A set entered
    // in another tab between the preview and this lock always wins.
    const replace = replacing && JSON.stringify(latest) === JSON.stringify(replacing)
    if (replacing && !replace) pushToast('Another tab changed the workout. Your latest sets have been reopened.', 'info')
    const source = replace ? draft : latest ?? draft
    return { ...adaptOpenDraft(source, draft.avoidJoints ?? [], (draft.volumeFactor ?? 1) <= 0.6, placeFor(source)), epoch }
  }
  return <WorkoutWriter ownerKey="planchelab.gymWriter" load={open} onClose={onClose}>
    {(source, owns) => <GymPlayer draft={source} location={placeFor(source)} onClose={onClose} canEdit={owns} />}
  </WorkoutWriter>
}
