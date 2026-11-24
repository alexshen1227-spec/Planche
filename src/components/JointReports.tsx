import { useMemo } from 'react'
import type { BodyRegion } from '../types'
import { useStore } from '../lib/store'
import { readinessTimeline, type ReadinessAnswer } from '../lib/signals'
import { fmtDate } from '../lib/time'
import { pushToast } from '../lib/toast'

const SOURCE_LABEL: Record<ReadinessAnswer['source'], string> = {
  onboarding: 'at setup',
  'check-in': 'check-in',
  session: 'check-in',
  attempt: 'during a set',
  manual: 'added by you',
  fresh: 'just now',
}

const REGION_LABEL: Record<BodyRegion, string> = {
  wrist: 'wrist',
  elbow: 'elbow',
  shoulder: 'shoulder',
  'lower-back': 'lower back',
  knee: 'knee',
  hip: 'hip',
  ankle: 'ankle',
  other: 'somewhere else',
}

/**
 * The joint reports the coach is reading, and a way to withdraw a mistake.
 *
 * Every report — setup, check-in, mid-set — shapes loading for days, so an
 * accidental "pain" tap needs a way back that is not "wait a week". Marking
 * one as a mistake records a correction rather than deleting anything: the
 * history stays, the report just stops counting. Recovery is still reported
 * the normal way, through the next check-in.
 */
export function JointReports() {
  const { state, dispatch } = useStore()
  const complaints = useMemo(
    () =>
      readinessTimeline(state)
        .filter((answer) => answer.joints !== 'good')
        .slice(-6)
        .reverse(),
    [state],
  )

  if (complaints.length === 0) {
    return <p className="text-[13px] text-ink3">No joint complaints on record.</p>
  }

  return (
    <ul className="w-full space-y-1.5">
      {complaints.map((report) => (
        <li
          key={`${report.at}-${report.source}`}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3 py-2"
        >
          <span className="min-w-0 text-[13px] text-ink2">
            <span className="font-medium text-ink">{report.joints === 'pain' ? 'Pain' : 'Discomfort'}</span>
            {report.regions?.length ? ` · ${report.regions.map((r) => REGION_LABEL[r]).join(', ')}` : ''}
            <span className="text-ink3">
              {' '}
              · {SOURCE_LABEL[report.source]}, {fmtDate(report.at)}
            </span>
          </span>
          <button
            onClick={() => {
              dispatch({
                type: 'RECORD_SYMPTOM',
                event: {
                  at: Math.max(Date.now(), report.at),
                  joints: report.joints,
                  ...(report.regions?.length ? { regions: report.regions } : {}),
                  source: 'manual',
                  correction: true,
                  correctsAt: report.at,
                },
              })
              pushToast('Marked as a mistake. It stays in your history but no longer counts.', 'info', 5000)
            }}
            className="min-h-11 shrink-0 rounded-lg border border-line bg-surface px-3 py-1 text-[12px] font-medium text-ink2 hover:text-ink"
          >
            That was a mistake
          </button>
        </li>
      ))}
    </ul>
  )
}
