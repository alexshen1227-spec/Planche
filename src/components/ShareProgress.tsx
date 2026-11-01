import { useEffect, useState } from 'react'
import type { StepId } from '../types'
import { useStore } from '../lib/store'
import { shareCardData, shareCardFile } from '../lib/shareCard'
import { pushToast } from '../lib/toast'
import { Icon } from './Icon'
import { Modal } from './ui'

/**
 * "Share progress": a card of where you are on the road, made on this device.
 *
 * Nothing leaves the phone unless the athlete sends it: the image is drawn
 * locally and handed to the system share sheet, or saved. It carries the step,
 * the best verified hold and plain counts — no name, no photo.
 */
export function ShareProgress({
  className = '',
  label = 'Share progress',
  opened,
}: {
  className?: string
  label?: string
  /** The step that just opened, for the unlock card. */
  opened?: { stepId: StepId; via?: 'bar' | 'next-shape' }
}) {
  const { state } = useStore()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setFile(null)
    setError(null)
    shareCardFile(shareCardData(state, Date.now(), opened))
      .then((made) => {
        if (cancelled) return
        setFile(made)
        setUrl(URL.createObjectURL(made))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The card could not be made.')
      })
    return () => {
      cancelled = true
    }
    // The card is a snapshot of the moment it was opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url],
  )

  const canShareFile = Boolean(file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }))

  const share = async () => {
    if (!file) return
    try {
      await navigator.share({ files: [file], title: 'My planche progress' })
    } catch (err) {
      // Closing the share sheet is not an error worth announcing.
      if (err instanceof DOMException && err.name === 'AbortError') return
      pushToast('Sharing did not work here — save the image instead.', 'danger', 4000)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink2 transition hover:text-ink ${className}`}
      >
        <Icon name="share" size={14} /> {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} label="Share your progress">
        <div className="p-5 sm:p-6">
          <h2 className="pr-10 font-display text-[19px] font-semibold text-ink">Your progress card</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink3">
            Made on this phone from your own log. It shows your step, your best camera-verified hold and plain counts —
            no name, no photo. Nothing is sent anywhere unless you share it.
          </p>
          <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-raised">
            {url ? (
              <img src={url} alt="Your planche progress card" className="block h-auto w-full" />
            ) : (
              <div className="grid aspect-[4/5] place-items-center text-[13px] text-ink3">
                {error ?? 'Drawing your card…'}
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {canShareFile ? (
              <button
                onClick={() => void share()}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-[15px] font-semibold text-on-accent"
                style={{ background: 'var(--t-btn-accent)' }}
              >
                <Icon name="share" size={16} /> Share
              </button>
            ) : null}
            {url && file ? (
              <a
                href={url}
                download={file.name}
                className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-line px-4 py-3 text-[15px] font-semibold ${
                  canShareFile ? 'bg-surface text-ink' : 'text-on-accent'
                }`}
                style={canShareFile ? undefined : { background: 'var(--t-btn-accent)' }}
              >
                <Icon name="download" size={16} /> Save image
              </a>
            ) : null}
          </div>
        </div>
      </Modal>
    </>
  )
}
