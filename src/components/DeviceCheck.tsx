import { useEffect, useRef, useState } from 'react'
import { sfx, speak, unlockAudio } from '../lib/audio'
import { classifyCameraError } from '../lib/recorder'
import {
  deviceCheckAdvice,
  saveDeviceCheck,
  summarizeDeviceCheck,
  type CameraOutcome,
  type DeviceCheckResult,
} from '../lib/deviceCheck'
import { pushToast } from '../lib/toast'
import { Icon } from './Icon'

type Step = 'sound' | 'voice' | 'camera' | 'screen' | 'done'

/**
 * Thirty seconds on the athlete's own phone: the things a session relies on
 * that no test outside a real device can reach. Every check is started by a
 * tap — iOS only lets sound, speech and the camera start from one.
 */
export function DeviceCheck({
  soundOn,
  voiceOn,
  onDone,
}: {
  soundOn: boolean
  voiceOn: boolean
  onDone: () => void
}) {
  const [step, setStep] = useState<Step>('sound')
  const [played, setPlayed] = useState(false)
  const [result, setResult] = useState<DeviceCheckResult>({ at: Date.now() })
  const [opening, setOpening] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Every stream this opens is stopped on every way out: moving on, closing
  // the check, or the component going away mid-preview.
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }
  useEffect(() => stopCamera, [])

  const record = (patch: Partial<DeviceCheckResult>) => setResult((r) => ({ ...r, ...patch }))
  const next = (to: Step) => {
    setPlayed(false)
    setStep(to)
  }

  const playChime = () => {
    unlockAudio()
    sfx.target()
    setPlayed(true)
  }
  const sayWord = () => {
    unlockAudio()
    speak('Target. Stop while clean.')
    setPlayed(true)
  }

  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      record({ camera: 'unsupported' })
      return
    }
    setOpening(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      stopCamera()
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => undefined)
      }
      record({ camera: 'live', recorder: typeof MediaRecorder !== 'undefined' })
    } catch (err) {
      record({ camera: classifyCameraError(err) as CameraOutcome })
    } finally {
      setOpening(false)
    }
  }

  const checkScreenAndShare = async () => {
    let wakeLock = false
    if ('wakeLock' in navigator) {
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        wakeLock = true
        await sentinel.release().catch(() => undefined)
      } catch {
        wakeLock = false
      }
    }
    let share = false
    try {
      const file = new File([new Uint8Array([137, 80, 78, 71])], 'check.png', { type: 'image/png' })
      share = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
    } catch {
      share = false
    }
    const done = { ...result, wakeLock, share, at: Date.now() }
    setResult(done)
    saveDeviceCheck(done)
    next('done')
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summarizeDeviceCheck(result, navigator.userAgent))
      pushToast('Copied — paste it into a message.', 'success')
    } catch {
      pushToast('Could not copy here. The list on screen has everything.', 'info')
    }
  }

  const heard = (key: 'sound' | 'voice', to: Step) => (
    <div className="mt-3 flex gap-2">
      <button
        onClick={() => {
          record({ [key]: true })
          next(to)
        }}
        className="min-h-11 flex-1 rounded-xl border border-line bg-raised px-3 py-2.5 text-[14px] font-semibold text-ink"
      >
        Heard it
      </button>
      <button
        onClick={() => {
          record({ [key]: false })
          next(to)
        }}
        className="min-h-11 flex-1 rounded-xl border border-line bg-raised px-3 py-2.5 text-[14px] font-semibold text-ink"
      >
        Didn’t hear it
      </button>
    </div>
  )

  const primary = 'mt-4 w-full rounded-2xl px-6 py-3.5 font-display text-[16px] font-semibold text-on-accent shadow-card'
  const accent = { background: 'var(--t-btn-accent)' }
  const advice = deviceCheckAdvice(result)

  return (
    <div className="p-6">
      <div className="pr-10">
        <h2 className="font-display text-[20px] font-bold text-ink">Check this phone</h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">
          Sound, voice, camera, screen and sharing — the parts of a session only your own phone can show. About
          thirty seconds.
        </p>
      </div>

      {step === 'sound' ? (
        <div className="mt-4">
          <div className="text-[14px] font-semibold text-ink">1 · The target chime</div>
          {soundOn ? (
            <>
              <button onClick={playChime} className={primary} style={accent}>
                Play the chime
              </button>
              {played ? heard('sound', 'voice') : null}
            </>
          ) : (
            <>
              <p className="mt-2 text-[13px] leading-relaxed text-ink2">Sounds are switched off in Settings, so there is no chime to hear.</p>
              <button onClick={() => next('voice')} className={primary} style={accent}>
                Next
              </button>
            </>
          )}
        </div>
      ) : null}

      {step === 'voice' ? (
        <div className="mt-4">
          <div className="text-[14px] font-semibold text-ink">2 · The spoken call</div>
          {voiceOn ? (
            <>
              <button onClick={sayWord} className={primary} style={accent}>
                Say the call
              </button>
              {played ? heard('voice', 'camera') : null}
            </>
          ) : (
            <>
              <p className="mt-2 text-[13px] leading-relaxed text-ink2">Voice cues are switched off in Settings.</p>
              <button onClick={() => next('camera')} className={primary} style={accent}>
                Next
              </button>
            </>
          )}
        </div>
      ) : null}

      {step === 'camera' ? (
        <div className="mt-4">
          <div className="text-[14px] font-semibold text-ink">3 · The back camera</div>
          <video
            ref={videoRef}
            muted
            playsInline
            className={`mt-3 h-44 w-full rounded-xl border border-line bg-raised object-cover ${result.camera === 'live' ? '' : 'hidden'}`}
          />
          {result.camera && result.camera !== 'live' ? (
            <p className="mt-2 text-[13px] leading-relaxed text-danger-text" role="status">
              {result.camera === 'denied'
                ? 'Camera access was refused.'
                : result.camera === 'busy'
                  ? 'Another app is using the camera.'
                  : 'No camera this browser can open.'}
            </p>
          ) : null}
          {result.camera === undefined ? (
            <button onClick={() => void openCamera()} disabled={opening} className={`${primary} disabled:opacity-60`} style={accent}>
              {opening ? 'Opening…' : 'Open the camera'}
            </button>
          ) : (
            <button
              onClick={() => {
                stopCamera()
                next('screen')
              }}
              className={primary}
              style={accent}
            >
              {result.camera === 'live' ? 'I can see the picture — next' : 'Next'}
            </button>
          )}
        </div>
      ) : null}

      {step === 'screen' ? (
        <div className="mt-4">
          <div className="text-[14px] font-semibold text-ink">4 · Screen and sharing</div>
          <p className="mt-2 text-[13px] leading-relaxed text-ink2">
            Asks to keep the screen on, as a session does, and whether progress cards can go to the share sheet.
          </p>
          <button onClick={() => void checkScreenAndShare()} className={primary} style={accent}>
            Check
          </button>
        </div>
      ) : null}

      {step === 'done' ? (
        <div className="mt-4">
          <ul className="space-y-1.5 text-[13.5px]">
            {(
              [
                ['Chime', result.sound],
                ['Voice', result.voice],
                ['Camera', result.camera === undefined ? undefined : result.camera === 'live'],
                ['Recording', result.camera === 'live' ? result.recorder : undefined],
                ['Screen stays on', result.wakeLock],
                ['Share sheet', result.share],
              ] as [string, boolean | undefined][]
            ).map(([label, ok]) => (
              <li key={label} className="flex items-center justify-between rounded-xl bg-raised px-3 py-2">
                <span className="text-ink2">{label}</span>
                <span className={ok === undefined ? 'text-ink3' : ok ? 'text-ok-text' : 'text-danger-text'}>
                  {ok === undefined ? 'not checked' : ok ? 'works' : 'needs a fix'}
                </span>
              </li>
            ))}
          </ul>
          {advice.length ? (
            <ul className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-ink2">
              {advice.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-ink2">Everything a session needs works on this phone.</p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => void copy()}
              className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-raised px-3 py-2.5 text-[14px] font-medium text-ink2"
            >
              <Icon name="share" size={14} /> Copy result
            </button>
            <button onClick={onDone} className="min-h-11 flex-1 rounded-xl px-3 py-2.5 text-[14px] font-semibold text-on-accent" style={accent}>
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
