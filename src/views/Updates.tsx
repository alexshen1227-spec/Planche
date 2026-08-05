import type { Tab } from '../types'
import { CHANGELOG, AREA_LABEL, type ChangeEntry } from '../data/changelog'
import { fmtDate } from '../lib/time'
import { Icon } from '../components/Icon'

const AREA_STYLE: Record<ChangeEntry['area'], string> = {
  camera: 'border-accent/30 bg-accent-soft text-accent',
  coach: 'border-ok/30 bg-ok-soft text-ok',
  training: 'border-line bg-raised text-ink2',
  app: 'border-line bg-raised text-ink3',
}

/**
 * Every change to the app, newest first. Its own page rather than a modal:
 * it is long enough to scroll and worth being able to sit and read.
 */
export function Updates({ go }: { go: (t: Tab) => void }) {
  return (
    <div className="animate-rise">
      <button
        onClick={() => go('settings')}
        className="mb-4 inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-[13.5px] font-medium text-ink2 transition hover:text-ink"
      >
        <Icon name="chevronR" size={15} className="rotate-180" />
        Settings
      </button>

      <h1 className="font-display text-[28px] font-bold leading-tight text-ink">Update log</h1>
      <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-ink2">
        Everything that has changed in Planche Lab, newest first. Your training data carries across every one of
        these — sessions, records and clips are never reset by an update.
      </p>

      <div className="mt-6 space-y-4">
        {CHANGELOG.map((entry, i) => (
          <div
            key={`${entry.date}-${entry.title}`}
            className={`animate-rise rounded-2xl border bg-surface p-5 shadow-card ${
              entry.major ? 'card-sheen border-accent/40 sm:p-6' : 'border-line'
            }`}
            style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
          >
            <div className="flex flex-wrap items-center gap-2">
              {entry.major ? (
                <span className="rounded-full px-2.5 py-0.5 text-[11.5px] font-bold uppercase tracking-wide text-on-accent" style={{ background: 'var(--t-btn-accent)' }}>
                  {entry.major.version}
                </span>
              ) : null}
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold uppercase tracking-wide ${AREA_STYLE[entry.area]}`}
              >
                {AREA_LABEL[entry.area]}
              </span>
              {/* Parsed as local midnight. A bare "2026-07-26" is parsed as UTC,
                  which renders today's entry as "Yesterday" west of Greenwich. */}
              <span className="text-[12.5px] text-ink3 tnum">
                {fmtDate(new Date(`${entry.date}T00:00:00`).getTime())}
              </span>
            </div>
            <h2
              className={`mt-2 font-display font-bold leading-snug text-ink ${
                entry.major ? 'text-[24px]' : 'text-[17px] font-semibold'
              }`}
            >
              {entry.title}
            </h2>
            {entry.major ? (
              <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink2">{entry.major.blurb}</p>
            ) : null}
            <ul className={`space-y-2 ${entry.major ? 'mt-4' : 'mt-2.5'}`}>
              {entry.notes.map((n) => (
                <li key={n} className="flex gap-2.5 text-[13.5px] leading-relaxed text-ink2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent/70" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-6 text-center text-[12.5px] text-ink3">
        That is the whole history — {CHANGELOG.length} update{CHANGELOG.length === 1 ? '' : 's'} so far.
      </p>
    </div>
  )
}
