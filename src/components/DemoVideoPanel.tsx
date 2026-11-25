import { useState } from 'react'
import { useStore } from '../lib/store'
import { youtubeId } from '../lib/video'
import { pushToast } from '../lib/toast'
import { MovementDemo } from './MovementDemo'
import { Icon } from './Icon'
import { Button } from './ds'

/**
 * A movement's demonstration: the app's own video where it has one, a YouTube search for more, and a link the athlete
 * pins that then plays right here every time. Links open in a new tab and the video plays inline, so nothing on the
 * page underneath — a workout in progress included — is left or reloaded.
 */
export function DemoVideoPanel({ exerciseId, name, searchUrl }: { exerciseId: string; name: string; searchUrl: string }) {
  const { state, dispatch } = useStore()
  const pinned = state.videoLinks[exerciseId]
  const pinnedId = pinned ? youtubeId(pinned) : null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(pinned ?? '')

  const save = () => {
    const id = youtubeId(draft)
    if (!id) {
      pushToast('That does not look like a YouTube link.', 'danger')
      return
    }
    dispatch({ type: 'SET_VIDEO', exerciseId, url: draft.trim() })
    setEditing(false)
    pushToast('Demo video pinned.', 'success')
  }

  return (
    <div className="mt-4 rounded-card border border-line bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-footnote font-semibold text-ink">
          <Icon name="play" size={14} className="text-accent-text" /> Demo video
        </div>
        <div className="flex items-center gap-2">
          <a
            href={searchUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Find ${name} demos on YouTube (opens a new tab)`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-footnote font-medium text-ink2 transition hover:text-ink"
          >
            Find demos <Icon name="arrowR" size={13} />
          </a>
          <button
            type="button"
            onClick={() => {
              setDraft(pinned ?? '')
              setEditing((v) => !v)
            }}
            className="min-h-11 rounded-lg border border-line bg-surface px-3 py-1.5 text-footnote font-medium text-ink2 transition hover:text-ink"
          >
            {pinned ? 'Change' : 'Pin one'}
          </button>
        </div>
      </div>

      {!editing ? (
        <>
          <MovementDemo name={name} exerciseId={exerciseId} pinnedUrl={pinned} />
          {pinnedId && <button
            type="button"
            onClick={() => {
              dispatch({ type: 'SET_VIDEO', exerciseId, url: null })
              pushToast('Pinned video removed.', 'info')
            }}
            className="mt-2 min-h-11 text-footnote font-medium text-ink3 hover:text-danger-text"
          >
            Remove pinned video
          </button>}
        </>
      ) : (
        <div className="mt-3">
          <p className="text-footnote leading-relaxed text-ink2">
            Found a demo you like? Paste its YouTube link and it will play right here, every time.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              aria-label="YouTube demonstration link"
              placeholder="https://youtube.com/watch?v=…"
              className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-2 text-footnote text-ink outline-none placeholder:text-ink3 focus:border-accent"
            />
            <Button onClick={save}>Pin</Button>
          </div>
        </div>
      )}
    </div>
  )
}
