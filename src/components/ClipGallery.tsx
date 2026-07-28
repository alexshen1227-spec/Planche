import { useEffect, useState } from 'react'
import { listClips, getClipBlob, deleteClip, setPinned, type ClipMeta } from '../lib/clips'
import { analyseClip, emptyResult, friendlyResult, type PoseFormResult } from '../lib/poseForm'
import { fmtDate, fmtHold } from '../lib/time'
import { pushToast } from '../lib/toast'
import { Icon } from './Icon'
import { ClipPlayer } from './ClipPlayer'

/**
 * Playback for the clips recorded during sessions. Two at a time on purpose:
 * seeing your current position beside an older one is the whole reason for
 * filming, and it is far more informative than either clip alone.
 */
export function ClipGallery({ exerciseId }: { exerciseId: string }) {
  const [clips, setClips] = useState<ClipMeta[] | null>(null)
  const [analysis, setAnalysis] = useState<Record<string, PoseFormResult | undefined>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const analyse = async (key: string) => {
    setBusy(key)
    try {
      const blob = await getClipBlob(key)
      const res: PoseFormResult = blob
        ? await analyseClip(blob, exerciseId, undefined, clips?.find((c) => c.key === key)?.seconds)
        : emptyResult('That clip could not be loaded.')
      setAnalysis((a) => ({ ...a, [key]: friendlyResult(res) }))
    } finally {
      setBusy(null)
    }
  }

  const load = () => {
    void listClips(exerciseId).then(setClips)
  }
  useEffect(load, [exerciseId])

  if (clips === null) return null
  if (clips.length === 0) {
    return (
      <p className="mt-2 text-[13px] leading-relaxed text-ink2">
        No clips yet. Film a main set with the camera on and it will show up here to compare against.
      </p>
    )
  }

  return (
    <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
      {clips.map((c) => (
        <div key={c.key} className="rounded-xl border border-line bg-surface p-2">
          <ClipPlayer
            clipKey={c.key}
            label={`${fmtDate(c.at)} ${fmtHold(c.seconds)} form check`}
            overlay={analysis[c.key]?.track}
            overlayIssues={analysis[c.key]?.issues}
          />
          {analysis[c.key] ? (
            <div className="mt-1.5 rounded-lg border border-line bg-raised p-2 text-[12px] leading-relaxed text-ink2">
              {analysis[c.key]!.ok
                ? [
                    ...(analysis[c.key]!.score !== undefined
                      ? [`Form score ${analysis[c.key]!.score}/100.`]
                      : []),
                    ...analysis[c.key]!.good.map((g) => `✓ ${g}.`),
                    ...analysis[c.key]!.notes,
                  ].join(' ') || 'No measured issue found — confirm scapular position and control yourself.'
                : (analysis[c.key]!.reason ?? 'Could not analyse.')}
            </div>
          ) : null}
          <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5">
            <span className="text-[12.5px] text-ink2 tnum">
              {fmtDate(c.at)} · {fmtHold(c.seconds)}
            </span>
            <span className="flex items-center gap-1">
              <button
                onClick={() => void analyse(c.key)}
                disabled={busy === c.key}
                aria-label="Check form"
                title="Check form automatically"
                className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-raised text-ink3 hover:text-accent disabled:opacity-40"
              >
                <Icon name={busy === c.key ? 'clock' : 'sparkle'} size={13} />
              </button>
              <button
                onClick={() =>
                  void setPinned(c.key, !c.pinned).then((ok) => {
                    if (ok) {
                      load()
                      pushToast(c.pinned ? 'Unpinned.' : 'Pinned as your reference clip.', 'success')
                    } else {
                      pushToast('That clip could not be updated.', 'danger')
                    }
                  })
                }
                aria-label={c.pinned ? 'Unpin clip' : 'Pin as reference'}
                title={c.pinned ? 'Unpin' : 'Pin as reference — never auto-deleted'}
                className={`grid h-7 w-7 place-items-center rounded-lg border border-line ${
                  c.pinned ? 'bg-accent-soft text-accent' : 'bg-raised text-ink3 hover:text-ink'
                }`}
              >
                <Icon name="target" size={13} />
              </button>
              <button
                onClick={() =>
                  void deleteClip(c.key).then((ok) => {
                    if (ok) load()
                    else pushToast('That clip could not be deleted.', 'danger')
                  })
                }
                aria-label="Delete clip"
                className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-raised text-ink3 hover:text-danger"
              >
                <Icon name="trash" size={13} />
              </button>
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
