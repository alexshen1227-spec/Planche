/**
 * "Check this phone": a thirty-second run through the things a session relies
 * on that no test here can reach — sound, speech, the camera, the screen
 * staying on, the share sheet — on the athlete's own device.
 *
 * Per device, not per athlete: it describes this phone and this browser, so it
 * lives beside the other per-device keys rather than in the synced state, and
 * it travels with every problem report so a report says what the phone did.
 */

export type CameraOutcome = 'live' | 'denied' | 'busy' | 'unavailable' | 'unsupported'

export interface DeviceCheckResult {
  at: number
  /** The athlete heard the test chime. */
  sound?: boolean
  /** The athlete heard the test word. */
  voice?: boolean
  camera?: CameraOutcome
  /** The browser can record what the camera shows (a MediaRecorder format exists). */
  recorder?: boolean
  /** The screen wake lock was granted. */
  wakeLock?: boolean
  /** The share sheet can take an image file. */
  share?: boolean
}

const KEY = 'planchelab.deviceCheck'

export function readDeviceCheck(): DeviceCheckResult | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DeviceCheckResult>
    return typeof parsed?.at === 'number' ? (parsed as DeviceCheckResult) : null
  } catch {
    return null
  }
}

export function saveDeviceCheck(result: DeviceCheckResult): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(result))
  } catch {
    /* storage refused: the result still shows on screen */
  }
}

/** What to do about each thing that failed, in the order a session needs them. */
export function deviceCheckAdvice(r: DeviceCheckResult): string[] {
  const out: string[] = []
  if (r.sound === false) {
    out.push(
      'No chime: turn the volume up. If the ring switch is on silent, switch on Settings → Play through the silent switch, then check again.',
    )
  }
  if (r.voice === false) {
    out.push('No voice: check that Settings → Voice cues is on and the volume is up. The chimes still mark go and the target.')
  }
  if (r.camera === 'denied') {
    out.push(
      'Camera blocked: allow it for this site — on an iPhone, Settings → Apps → Safari → Camera, or the aA menu → Website Settings in Safari.',
    )
  } else if (r.camera === 'busy') {
    out.push('Camera busy: another app is using it. Close that app and check again.')
  } else if (r.camera === 'unavailable' || r.camera === 'unsupported') {
    out.push('No camera this browser can open: sets still run on the timer, but they cannot be filmed or checked.')
  }
  if (r.camera === 'live' && r.recorder === false) {
    out.push('The camera opens but this browser cannot record it: sets run on the timer without a clip to check.')
  }
  if (r.wakeLock === false) {
    out.push('Screen will not stay on: lengthen your auto-lock while you train, or the timer and camera stop when the phone locks.')
  }
  if (r.share === false) {
    out.push('No share sheet for images here: Share progress saves the card as a file instead.')
  }
  return out
}

/** A plain summary to paste into a message. */
export function summarizeDeviceCheck(r: DeviceCheckResult, userAgent: string): string {
  const yes = (v: boolean | undefined) => (v === undefined ? 'not checked' : v ? 'yes' : 'no')
  return [
    `Planche Lab phone check — ${new Date(r.at).toISOString()}`,
    `Chime heard: ${yes(r.sound)}`,
    `Voice heard: ${yes(r.voice)}`,
    `Camera: ${r.camera ?? 'not checked'}${r.camera === 'live' ? ` (can record: ${yes(r.recorder)})` : ''}`,
    `Screen kept on: ${yes(r.wakeLock)}`,
    `Share sheet: ${yes(r.share)}`,
    `Browser: ${userAgent}`,
  ].join('\n')
}
