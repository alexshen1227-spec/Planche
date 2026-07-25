import { Component, type ErrorInfo, type ReactNode } from 'react'
import { previousBackup } from '../lib/store'

/**
 * Last line of defence. Without this, one bad render (a corrupt import, an
 * unexpected shape) leaves a blank page with no way back — and the offending
 * state is already persisted, so every reload fails identically. This always
 * offers a way out that does not require devtools.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Planche Lab crashed:', error, info.componentStack)
  }

  private download = () => {
    try {
      const raw = localStorage.getItem('planchelab.v1') ?? '{}'
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'planche-lab-rescue.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      /* nothing recoverable */
    }
  }

  /** Roll back to the snapshot taken before the last version upgrade. */
  private restorePrevious = () => {
    const prev = previousBackup()
    if (!prev) return
    try {
      localStorage.setItem('planchelab.v1', prev.json)
      localStorage.removeItem('planchelab.draft')
      window.location.reload()
    } catch {
      /* nothing further we can do from here */
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    const prev = previousBackup()
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
        <h1 className="font-display text-[24px] font-bold text-ink">Something went wrong</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink2">
          The app hit an error it could not render around. Your training data is still on this device — save a copy
          before trying anything else.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-raised p-3 text-[11.5px] text-ink3">
          {String(this.state.error?.message ?? this.state.error)}
        </pre>
        <button
          onClick={this.download}
          className="mt-4 rounded-2xl px-6 py-3.5 font-display text-[15px] font-semibold text-on-accent"
          style={{ background: 'var(--t-btn-accent)' }}
        >
          Download a rescue copy
        </button>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 rounded-2xl border border-line bg-surface py-3 text-[14px] font-medium text-ink"
        >
          Reload the app
        </button>
        {prev ? (
          <button
            onClick={this.restorePrevious}
            className="mt-2 rounded-2xl border border-line bg-surface py-3 text-[14px] font-medium text-ink"
          >
            Roll back to the pre-update save ({prev.sessions} session{prev.sessions === 1 ? '' : 's'})
          </button>
        ) : null}
        <button
          onClick={() => {
            try {
              localStorage.removeItem('planchelab.draft')
            } catch {
              /* ignore */
            }
            window.location.reload()
          }}
          className="mt-2 rounded-2xl border border-line bg-surface py-3 text-[14px] font-medium text-ink2"
        >
          Clear the in-progress session and reload
        </button>
        <p className="mt-4 text-center text-[12.5px] text-ink3">
          Still broken? Settings → Reset everything wipes local data — import your rescue copy afterwards.
        </p>
      </div>
    )
  }
}
