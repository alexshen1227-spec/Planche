import { useState } from 'react'
import { stepForKeyExercise } from '../data/progressions'
import { embedUrl, MOVEMENT_VIDEOS, youtubeId } from '../lib/video'
import { Figure } from './Figure'
import { Icon } from './Icon'

export function MovementDemo({ exerciseId, name, pinnedUrl }: { exerciseId: string; name: string; pinnedUrl?: string }) {
  const [playing, setPlaying] = useState('')
  const pinned = pinnedUrl && youtubeId(pinnedUrl)
  const video = pinned ? { id: pinned, by: 'Your pinned video', start: undefined } : MOVEMENT_VIDEOS[exerciseId]
  const step = stepForKeyExercise(exerciseId)
  if (!step && !video) return null
  const start = video?.start ?? 0
  const source = video && `https://www.youtube.com/watch?v=${video.id}${start ? '&t=' + start : ''}`
  const key = `${exerciseId}/${video?.id}`
  return (
    <div className="mt-3 rounded-inner border border-line bg-surface p-3">
      <div className="flex items-center gap-3">
        {step && <Figure step={step.id} className="h-20 w-20 shrink-0 text-accent-text" />}
        <div className="min-w-0">
          {step && <p className="text-footnote font-semibold text-ink">{step.name} position</p>}
          {video && <p className="text-caption text-ink2">{video.by}</p>}
          {video && playing !== key && <button type="button" className="ds-press inline-flex min-h-11 items-center gap-2 font-semibold text-accent-text"
            onClick={() => setPlaying(key)} aria-label={`Play ${name} demonstration`}>
            <Icon name="play" size={15} /> Play demonstration
          </button>}
        </div>
      </div>
      {video && source && playing === key && <>
        <iframe className="mt-2 aspect-video w-full rounded-control" src={`${embedUrl(video.id)}?autoplay=1&start=${start}`}
          title={`${name} demonstration`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin" />
        <a className="inline-flex min-h-11 items-center text-footnote font-semibold text-accent-text" href={source}
          rel="noopener noreferrer" target="_blank">Open on YouTube</a>
      </>}
    </div>
  )
}
