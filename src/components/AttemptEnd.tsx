import { useState, type ReactNode } from 'react'
import type { BodyRegion, EndReason, SetLog } from '../types'
import { BODY_REGIONS } from '../types'
import { Icon } from './Icon'

export const END_REASON_LABEL: Record<EndReason, string> = {
  target: 'At target',
  balance: 'Balance or entry',
  technique: 'Technique',
  effort: 'Effort',
  interruption: 'Interrupted',
  timing: 'Timing problem',
  unsure: 'Not sure',
}

const OTHER_REASONS: EndReason[] = ['balance', 'technique', 'effort', 'interruption', 'timing', 'unsure']

const REGION_LABEL: Record<BodyRegion, string> = {
  wrist: 'Wrist',
  elbow: 'Elbow',
  shoulder: 'Shoulder',
  'lower-back': 'Lower back',
  other: 'Somewhere else',
}

export interface AttemptSymptom {
  joints: 'niggle' | 'pain'
  regions: BodyRegion[]
}

function Chip({
  on,
  onClick,
  children,
  expanded,
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
  expanded?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={expanded === undefined ? on : undefined}
      aria-expanded={expanded}
      className={`min-h-10 rounded-full border px-3.5 py-2 text-[12.5px] font-medium transition ${
        on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * What ended this attempt, and whether anything hurt — both optional.
 *
 * Two equally long holds do not mean the same thing when one stopped at the
 * target and the other fell out of balance, and the timer cannot tell them
 * apart. Nothing here blocks: an unanswered reason stays unknown, which is
 * different from "at target". The pain control is independent of the reason,
 * because a hold can end on balance *and* hurt; a report reaches the joint
 * record immediately, so it survives even if the session is never saved.
 */
export function AttemptEnd({
  log,
  askReason,
  onReason,
  onSymptom,
  onEndSession,
}: {
  log: SetLog
  /** Offer the end-reason chips (timed working holds); the pain control is always offered. */
  askReason: boolean
  onReason: (reason: EndReason | undefined) => void
  onSymptom: (symptom: AttemptSymptom) => void
  /** Offered after a report, so stopping is one tap. Absent when already finishing. */
  onEndSession?: () => void
}) {
  const [otherOpen, setOtherOpen] = useState(log.endReason !== undefined && log.endReason !== 'target')
  const [hurtOpen, setHurtOpen] = useState(false)
  const [severity, setSeverity] = useState<AttemptSymptom['joints'] | null>(null)
  const [regions, setRegions] = useState<BodyRegion[]>([])
  const [recorded, setRecorded] = useState<AttemptSymptom | null>(null)
  const [adviceDismissed, setAdviceDismissed] = useState(false)
  const reasonId = `end-reason-${log.at}`

  const where = (r: BodyRegion[]) =>
    r.length ? ` (${r.map((x) => REGION_LABEL[x].toLowerCase()).join(', ')})` : ''

  return (
    <div className="mx-auto mt-4 w-full max-w-sm text-left">
      {askReason ? (
        <div>
          <div className="text-[12.5px] font-semibold text-ink2" id={reasonId}>
            Why did it end? <span className="font-normal text-ink3">(optional)</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby={reasonId}>
            <Chip on={log.endReason === 'target'} onClick={() => onReason(log.endReason === 'target' ? undefined : 'target')}>
              {END_REASON_LABEL.target}
            </Chip>
            <Chip
              on={otherOpen || (log.endReason !== undefined && log.endReason !== 'target')}
              expanded={otherOpen}
              onClick={() => setOtherOpen((open) => !open)}
            >
              {/* Collapsed, it names the chosen reason; open, the list below does. */}
              {!otherOpen && log.endReason && log.endReason !== 'target' ? END_REASON_LABEL[log.endReason] : 'Other reason'}
            </Chip>
          </div>
          {otherOpen ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Other reasons">
              {OTHER_REASONS.map((reason) => (
                <Chip
                  key={reason}
                  on={log.endReason === reason}
                  onClick={() => onReason(log.endReason === reason ? undefined : reason)}
                >
                  {END_REASON_LABEL[reason]}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={askReason ? 'mt-3' : ''}>
        {recorded ? (
          adviceDismissed ? (
            <p className="text-[12px] text-ink3" role="status">
              {recorded.joints === 'pain' ? 'Pain' : 'Discomfort'}
              {where(recorded.regions)} recorded.
            </p>
          ) : (
            <div className="rounded-xl border border-danger/30 bg-danger-soft p-3" role="status">
              <p className="text-[12.5px] leading-relaxed text-ink">
                Recorded: {recorded.joints === 'pain' ? 'pain' : 'discomfort'}
                {where(recorded.regions)}. It stays on record even if this session is not saved, and your next plans
                will account for it.
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">
                When a joint hurts, loaded work should stop for today — pushing through is how a niggle becomes an
                injury. Swelling, numbness, or pain that is still there tomorrow needs qualified medical advice.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {onEndSession ? (
                  <button
                    onClick={onEndSession}
                    className="min-h-11 flex-1 rounded-xl bg-danger px-3 py-2 text-[13px] font-semibold text-white"
                  >
                    End the session here
                  </button>
                ) : null}
                <button
                  onClick={() => setAdviceDismissed(true)}
                  className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink2 hover:text-ink"
                >
                  {onEndSession ? 'Carry on carefully' : 'OK'}
                </button>
              </div>
            </div>
          )
        ) : hurtOpen ? (
          <div className="rounded-xl border border-line bg-raised p-3">
            <div className="text-[12.5px] font-semibold text-ink" id={`hurt-${log.at}`}>
              How does it feel?
            </div>
            <div className="mt-1.5 flex gap-1.5" role="group" aria-labelledby={`hurt-${log.at}`}>
              <Chip on={severity === 'niggle'} onClick={() => setSeverity('niggle')}>
                Discomfort
              </Chip>
              <Chip on={severity === 'pain'} onClick={() => setSeverity('pain')}>
                Pain
              </Chip>
            </div>
            <div className="mt-2.5 text-[12.5px] font-semibold text-ink" id={`where-${log.at}`}>
              Where? <span className="font-normal text-ink3">Pick all that apply.</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby={`where-${log.at}`}>
              {BODY_REGIONS.map((region) => {
                const on = regions.includes(region)
                return (
                  <Chip
                    key={region}
                    on={on}
                    onClick={() => setRegions((current) => (on ? current.filter((r) => r !== region) : [...current, region]))}
                  >
                    {REGION_LABEL[region]}
                  </Chip>
                )
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                disabled={!severity || regions.length === 0}
                onClick={() => {
                  if (!severity || regions.length === 0) return
                  const symptom = { joints: severity, regions }
                  onSymptom(symptom)
                  setRecorded(symptom)
                  setHurtOpen(false)
                }}
                className="min-h-11 flex-1 rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-on-accent disabled:opacity-40"
              >
                Record it
              </button>
              <button
                onClick={() => setHurtOpen(false)}
                className="min-h-11 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink2 hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setHurtOpen(true)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[12.5px] font-medium text-ink2 transition hover:border-line-strong hover:text-ink"
          >
            <Icon name="info" size={13} className="text-danger-text" />
            Pain or discomfort?
          </button>
        )}
      </div>
    </div>
  )
}
