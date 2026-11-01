import { useEffect, useMemo, useState } from 'react'
import type { StepId } from '../types'
import { useStore } from '../lib/store'
import { listClips } from '../lib/clips'
import { milestoneClips, type MilestoneClip } from '../lib/highlights'
import { fmtDate, fmtHold } from '../lib/time'
import { ClipPlayer } from './ClipPlayer'

/**
 * Then and now on one step: the first filmed hold and the best verified one,
 * kept past the 30-day window (lib/highlights). Footage deleted before it
 * could be kept simply does not show.
 */
export function MilestoneClips({ stepId }: { stepId: StepId }) {
  const { state } = useStore()
  const clips = useMemo(
    () => milestoneClips(state).filter((clip) => clip.stepId === stepId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.sessions, stepId],
  )
  // Asked of the clip store directly: the player reports "unavailable" while
  // it is still loading, which is not the same as gone.
  const [stored, setStored] = useState<Set<string> | null>(null)
  useEffect(() => {
    let cancelled = false
    void listClips().then((list) => {
      if (!cancelled) setStored(new Set(list.map((meta) => meta.key)))
    })
    return () => {
      cancelled = true
    }
  }, [clips])
  const shown = stored ? clips.filter((clip) => stored.has(clip.clipKey)) : []
  if (!shown.length) return null
  return (
    <section className="mt-4" aria-label="Your clips on this step">
      <div className="text-[13px] font-semibold text-ink">{shown.length > 1 ? 'Then and now' : 'Your clip'}</div>
      <div className={`mt-2 grid gap-3 ${shown.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {shown.map((clip) => (
          <MilestoneTile key={clip.clipKey} clip={clip} />
        ))}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink3">
        Kept for good, while other clips clear after 30 days. To let one go, unpin it under “Your recorded sets” on this
        exercise in Learn.
      </p>
    </section>
  )
}

function MilestoneTile({ clip }: { clip: MilestoneClip }) {
  return (
    <div className="rounded-2xl border border-line bg-raised p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2 text-[13px]">
        <span className="font-semibold text-ink">{clip.kind === 'first' ? 'Where you started' : 'Your best verified'}</span>
        <span className="text-ink3 tnum">
          {fmtHold(clip.value)} · {fmtDate(clip.at)}
        </span>
      </div>
      <ClipPlayer
        clipKey={clip.clipKey}
        className="aspect-video w-full rounded-lg"
        label={clip.kind === 'first' ? 'Your first filmed hold on this step' : 'Your best verified hold on this step'}
      />
    </div>
  )
}
