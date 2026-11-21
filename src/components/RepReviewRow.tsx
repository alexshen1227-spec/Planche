import { useCallback, useState } from 'react'
import type { FormCheck, FormIssue, FormRating } from '../types'
import type { RepRung } from '../data/skills'
import { EXERCISE_BY_ID } from '../data/exercises'
import { ClipPlayer } from './ClipPlayer'
import { FORM_ISSUE_LABEL, type HumanReview } from './FormCheckRow'

/** What can fall short in a rep set, in the order an athlete tends to notice it. */
const REP_ISSUES: FormIssue[] = ['depth', 'lockout', 'kip']

/** What a reviewed set does to the ladder; absent where that is not known (a clip reviewed later). */
export type RungOutcome = 'opens' | 'waits' | 'top' | 'short'

const reps = (n: number) => `${n} rep${n === 1 ? '' : 's'}`

/**
 * The review of a filmed rep set on a rung of a push-up line.
 *
 * A rung's evidence is the athlete's own check of the replay against the
 * rung's list — the camera does not count reps (see `lib/repLadder`). So this
 * row is the whole of it: the clip, a rating, the list, and one explicit tap
 * that says "I watched it and every rep passed". Nothing here can be set by
 * anything but that tap, and the tap is only offered when there is a clip to
 * have watched.
 *
 * Controlled: what it shows is the set's form as the owner holds it, so a
 * count raised after a review visibly loses that review.
 */
export function RepReviewRow({
  clipKey,
  clipPending,
  exerciseId,
  rung,
  count,
  outcome,
  waitsFor,
  value,
  canLower,
  onHuman,
  onReviewOpenChange,
  setLabel,
}: {
  clipKey: string | null
  /** The set was filmed and its clip is still being written. */
  clipPending?: boolean
  exerciseId: string
  rung: RepRung
  /** Reps logged for the set. */
  count: number
  outcome?: RungOutcome
  /** The hold-road step the next rung waits for, when `outcome` is `waits`. */
  waitsFor?: string
  value?: FormCheck
  /** The logged number can still be lowered from where this row is shown. */
  canLower?: boolean
  onHuman: (review: HumanReview) => void
  onReviewOpenChange?: (open: boolean) => void
  setLabel?: string
}) {
  const [clipAvailable, setClipAvailable] = useState(false)
  const handleClipAvailability = useCallback((available: boolean) => setClipAvailable(available), [])
  const rating: FormRating | null = value?.confirmed === true ? value.rating : null
  const issues = value?.issues ?? []
  const reviewed = rating === 'clean' && value?.visualReviewPassed === true
  const name = EXERCISE_BY_ID[exerciseId]?.name ?? 'Rep set'
  const id = `rep-review-${clipKey ?? exerciseId}`

  const commit = (next: FormRating, nextIssues: FormIssue[], replayPassed: boolean) =>
    onHuman({
      rating: next,
      issues: nextIssues,
      visualReviewPassed: replayPassed,
      ...(clipKey ? { clipKey } : {}),
    })

  const verdict = reviewed
    ? outcome === 'opens'
      ? `Evidence complete — ${reps(count)} meets this rung’s standard. The next rung opens when this session is saved.`
      : outcome === 'waits'
        ? `Evidence complete — ${reps(count)} meets this rung’s standard. The next rung also waits for ${waitsFor ?? 'a step'} on the hold road.`
        : outcome === 'top'
          ? `Evidence complete — ${reps(count)} at the top of this line.`
          : outcome === 'short'
            ? `Evidence complete — ${count} of the ${reps(rung.standardReps)} in one set that open the next rung.`
            : `Evidence complete — ${reps(count)} on record for this set.`
    : rating === 'clean'
      ? clipAvailable
        ? 'Your Clean rating is saved. Check the replay against the list above for these reps to count toward the rung.'
        : clipPending
          ? 'Your Clean rating is saved. The replay will be ready in a moment.'
          : 'Your Clean rating is saved. Without a clip to check, these reps do not count toward the rung.'
      : null

  return (
    <div className="mx-auto mt-5 w-full max-w-sm rounded-2xl border border-line bg-surface p-4 text-left">
      {clipKey ? (
        <ClipPlayer
          clipKey={clipKey}
          label={`${name} replay`}
          className="mb-3 h-40 w-full rounded-xl border border-line"
          onAvailabilityChange={handleClipAvailability}
          onReviewOpenChange={onReviewOpenChange}
        />
      ) : clipPending ? (
        <p className="mb-3 rounded-xl border border-line bg-raised px-3 py-2 text-[12.5px] text-ink2" role="status">
          Saving your clip…
        </p>
      ) : null}
      <div className="text-[13px] font-semibold text-ink" id={id}>
        How did {setLabel ?? 'that set'} look?
      </div>
      <div className="mt-2 flex gap-2" role="group" aria-labelledby={id}>
        {(
          [
            ['clean', 'Clean'],
            ['slipped', 'Slipped'],
            ['broke', 'Broke down'],
          ] as [FormRating, string][]
        ).map(([option, label]) => (
          <button
            key={option}
            onClick={() => commit(option, option === 'clean' ? [] : issues, option === 'clean' && reviewed)}
            aria-pressed={rating === option}
            className={`min-h-11 flex-1 rounded-xl border py-2 text-[13px] font-medium transition ${
              rating === option
                ? 'border-transparent bg-accent text-on-accent'
                : 'border-line bg-raised text-ink2 hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {rating === 'clean' && clipAvailable ? (
        <div className="mt-3 rounded-xl border border-line bg-raised p-3">
          <p className="text-[12.5px] leading-relaxed text-ink2">
            The camera does not count reps — the replay does. Watch it, and count a rep only if it shows all of this:
          </p>
          <ul className="mt-1.5 space-y-1">
            {rung.check.map((item) => (
              <li key={item} className="flex gap-1.5 text-[12.5px] leading-relaxed text-ink">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          {!reviewed ? (
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink3">
              {canLower
                ? 'If some fell short, lower the logged number to the reps that passed first.'
                : 'If some fell short, the set does not count as logged — rate it Slipped.'}
            </p>
          ) : null}
          <button
            onClick={() => commit('clean', [], true)}
            aria-pressed={reviewed}
            className={`mt-2 min-h-11 w-full rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${
              reviewed ? 'border-ok/40 bg-ok-soft text-ok-text' : 'border-line-strong bg-surface text-ink hover:border-accent'
            }`}
          >
            {reviewed
              ? `Replay checked — ${reps(count)} passed`
              : count === 1
                ? 'I watched the replay — the rep passed'
                : `I watched the replay — all ${count} reps passed`}
          </button>
        </div>
      ) : null}
      {verdict ? (
        <p className={`mt-2 text-[11.5px] font-medium ${reviewed ? 'text-ok-text' : 'text-accent-text'}`} role="status">
          {verdict}
        </p>
      ) : null}
      {rating && rating !== 'clean' ? (
        <div className="mt-3">
          <div className="text-[12.5px] text-ink2" id={`${id}-issues`}>
            What fell short?
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby={`${id}-issues`}>
            {REP_ISSUES.map((issue) => {
              const on = issues.includes(issue)
              return (
                <button
                  key={issue}
                  onClick={() => commit(rating, on ? issues.filter((x) => x !== issue) : [...issues, issue], false)}
                  aria-pressed={on}
                  className={`min-h-9 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition ${
                    on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2'
                  }`}
                >
                  {FORM_ISSUE_LABEL[issue]}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[11.5px] text-ink3">Saved as you tap. A set rated this way does not count toward the rung.</p>
        </div>
      ) : null}
    </div>
  )
}
