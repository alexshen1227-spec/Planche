import { useEffect, useMemo, useState } from 'react'
import type { FormCheck, Session, SetLog } from '../types'
import { listClips, getClipBlob, deleteClip, setPinned, type ClipMeta } from '../lib/clips'
import { analyseClip, emptyResult, friendlyResult, type PoseFormResult } from '../lib/poseForm'
import { useStore } from '../lib/store'
import { EXERCISE_BY_ID } from '../data/exercises'
import { fmtDate, fmtHold } from '../lib/time'
import { pushToast } from '../lib/toast'
import { Icon } from './Icon'
import { Modal } from './ui'
import { ClipPlayer } from './ClipPlayer'
import { FormCheckRow, mergeHumanReview, mergeModelReading } from './FormCheckRow'

/** The saved set a clip was recorded for, when it is still in history. */
interface ClipOwner {
  session: Session
  set: SetLog
}

/**
 * Playback for the clips recorded during sessions. Two at a time on purpose:
 * seeing your current position beside an older one is the whole reason for
 * filming, and it is far more informative than either clip alone.
 *
 * A clip that belongs to a saved set can be *reviewed* here — the same check
 * and the same Clean/Slipped/Broke answer as in the session — and the result
 * is written to that set, so evidence that timed out mid-workout can still be
 * completed later. A clip with no saved set left only gets an advisory check:
 * a score here cannot become evidence on its own.
 */
export function ClipGallery({ exerciseId }: { exerciseId: string }) {
  const { state, dispatch, getState } = useStore()
  const [clips, setClips] = useState<ClipMeta[] | null>(null)
  const [analysis, setAnalysis] = useState<Record<string, PoseFormResult | undefined>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)

  const owners = useMemo(() => {
    const byClip = new Map<string, ClipOwner>()
    for (const session of state.sessions) {
      for (const set of session.sets) {
        const key = set.clipKey ?? set.form?.clipKey
        if (key) byClip.set(key, { session, set })
      }
    }
    return byClip
  }, [state.sessions])

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

  /** Fold a change into the set's *current* saved form, then replay history. */
  const commit = (owner: ClipOwner, merge: (current: FormCheck | undefined) => FormCheck) => {
    const latest = getState()
      .sessions.find((s) => s.id === owner.session.id)
      ?.sets.find((set) => set.at === owner.set.at)
    if (!latest) {
      pushToast('That set is no longer in your history, so nothing was saved.', 'danger')
      return
    }
    dispatch({ type: 'UPDATE_SET_FORM', sessionId: owner.session.id, setAt: owner.set.at, form: merge(latest.form) })
  }

  const load = () => {
    void listClips(exerciseId).then(setClips)
  }
  useEffect(load, [exerciseId])

  const reviewOwner = reviewing ? owners.get(reviewing) : undefined
  const reviewTiming = reviewOwner?.set.timing
  const videoInterval =
    reviewTiming?.method === 'video' && reviewTiming.videoStartSec !== undefined && reviewTiming.videoEndSec !== undefined
      ? { startSec: reviewTiming.videoStartSec, endSec: reviewTiming.videoEndSec }
      : undefined

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
      {clips.map((c) => {
        const owner = owners.get(c.key)
        return (
          <div key={c.key} className="rounded-xl border border-line bg-surface p-2">
            <ClipPlayer
              clipKey={c.key}
              label={`${fmtDate(c.at)} ${fmtHold(c.seconds)} form check`}
              overlay={analysis[c.key]?.track}
              overlayIssues={analysis[c.key]?.issues}
            />
            {analysis[c.key] ? (
              <div className="mt-1.5 rounded-lg border border-line bg-raised p-2 text-[12px] leading-relaxed text-ink2">
                <span className="font-semibold text-ink3">Advisory only · </span>
                {analysis[c.key]!.ok
                  ? [
                      ...(analysis[c.key]!.score !== undefined ? [`Form score ${analysis[c.key]!.score}/100.`] : []),
                      ...analysis[c.key]!.good.map((g) => `✓ ${g}.`),
                      ...analysis[c.key]!.notes,
                    ].join(' ') || 'No measured issue found — confirm scapular position and control yourself.'
                  : (analysis[c.key]!.reason ?? 'Could not analyse.')}
              </div>
            ) : null}
            {owner ? (
              <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-raised px-2 py-1.5 text-[12px] text-ink2">
                <span className="min-w-0">
                  From {owner.session.workoutName} · {fmtHold(owner.set.value)}
                  {owner.set.side ? ` · ${owner.set.side}` : ''}
                  {owner.set.form?.confirmed ? (
                    <span className="text-ink3"> · rated {owner.set.form.rating}</span>
                  ) : (
                    <span className="text-accent-text"> · not reviewed</span>
                  )}
                </span>
                <button
                  onClick={() => setReviewing(c.key)}
                  className="min-h-9 shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink hover:border-line-strong"
                >
                  Review set
                </button>
              </div>
            ) : null}
            <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5">
              <span className="text-[12.5px] text-ink2 tnum">
                {fmtDate(c.at)} · {fmtHold(c.seconds)}
              </span>
              <span className="flex items-center gap-1">
                {owner ? null : (
                  <button
                    onClick={() => void analyse(c.key)}
                    disabled={busy === c.key}
                    aria-label="Check form (advisory)"
                    title="Advisory check — this clip has no saved set to update"
                    className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-raised text-ink3 hover:text-accent-text disabled:opacity-40"
                  >
                    <Icon name={busy === c.key ? 'clock' : 'sparkle'} size={14} />
                  </button>
                )}
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
                  aria-pressed={c.pinned}
                  title={c.pinned ? 'Unpin' : 'Pin as reference — never auto-deleted'}
                  className={`grid h-9 w-9 place-items-center rounded-lg border border-line ${
                    c.pinned ? 'bg-accent-soft text-accent-text' : 'bg-raised text-ink3 hover:text-ink'
                  }`}
                >
                  <Icon name="target" size={14} />
                </button>
                <button
                  onClick={() =>
                    void deleteClip(c.key).then((ok) => {
                      if (ok) load()
                      else pushToast('That clip could not be deleted.', 'danger')
                    })
                  }
                  aria-label="Delete clip"
                  className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-raised text-ink3 hover:text-danger-text"
                >
                  <Icon name="trash" size={14} />
                </button>
              </span>
            </div>
          </div>
        )
      })}

      <Modal open={reviewOwner !== undefined} onClose={() => setReviewing(null)} label="Review a saved set">
        {reviewOwner && reviewing ? (
          <div className="p-6">
            <div className="pr-10">
              <h2 className="font-display text-[19px] font-semibold text-ink">Review this set</h2>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">
                {EXERCISE_BY_ID[reviewOwner.set.exerciseId]?.name ?? reviewOwner.set.exerciseId} ·{' '}
                {fmtHold(reviewOwner.set.value)} · {reviewOwner.session.workoutName} on{' '}
                {fmtDate(reviewOwner.session.startedAt)}. A check run here is saved to this set as a camera reading;
                only your own answer below confirms it, and records are recalculated from it.
              </p>
            </div>
            <FormCheckRow
              clipKey={reviewing}
              exerciseId={reviewOwner.set.exerciseId}
              creditedHoldSec={reviewOwner.set.value}
              analysisWindowSec={
                videoInterval
                  ? reviewOwner.set.value
                  : Math.max(0, reviewOwner.set.value - (reviewOwner.set.recordingOffsetSec ?? 0))
              }
              analysisWindowStartSec={videoInterval?.startSec ?? 0}
              videoInterval={videoInterval}
              onVideoInterval={(interval) => {
                const latest = getState()
                  .sessions.find((s) => s.id === reviewOwner.session.id)
                  ?.sets.find((set) => set.at === reviewOwner.set.at)
                if (!latest) return
                dispatch({
                  type: 'UPDATE_SET_TIMING',
                  sessionId: reviewOwner.session.id,
                  setAt: reviewOwner.set.at,
                  value: Math.round((interval.endSec - interval.startSec) * 10) / 10,
                  timing: {
                    method: 'video',
                    videoStartSec: Math.round(interval.startSec * 100) / 100,
                    videoEndSec: Math.round(interval.endSec * 100) / 100,
                  },
                })
                pushToast('Re-timed from the video. Records were recalculated.', 'success', 4500)
              }}
              value={reviewOwner.set.form}
              onHuman={(review) => commit(reviewOwner, (current) => mergeHumanReview(current, review))}
              onModel={(reading) => commit(reviewOwner, (current) => mergeModelReading(current, reading))}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
