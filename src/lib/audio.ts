let ctx: AudioContext | null = null
let toneEnabled = true
let voiceEnabled = true
let volume = 0.7
let throughSilent = false

/**
 * iPhone's ring/silent switch mutes Web Audio: Safari treats it as "ambient"
 * sound that mixes with other apps' audio. The Audio Session API (iOS 17+)
 * can make it "playback", which plays through the switch but pauses music in
 * another app while it plays (WebKit bug 237322 and its follow-ups). Feature-
 * detected; other browsers have no such switch.
 */
type SessionType = 'default' | 'playback'
/** Whatever Safari started with ("auto"), restored whenever playback is not wanted. */
let defaultSessionType: string | null = null
function setSessionType(type: SessionType) {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (!session) return
  defaultSessionType ??= session.type
  try {
    session.type = type === 'playback' ? 'playback' : defaultSessionType
  } catch {
    /* an unsupported value on an older WebKit: keep its default */
  }
}

export function configureAudio(soundOn: boolean, voiceOn: boolean, vol: number, playThroughSilent = false) {
  toneEnabled = soundOn
  voiceEnabled = voiceOn
  volume = vol
  throughSilent = playThroughSilent
  setSessionType(throughSilent ? 'playback' : 'default')
}

function ac(): AudioContext | null {
  if (!toneEnabled) return null
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(freq: number, dur: number, delay = 0, type: OscillatorType = 'sine', gain = 1) {
  const c = ac()
  if (!c) return
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.value = freq
  const t = c.currentTime + delay
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(volume * 0.22 * gain, t + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
  osc.connect(g)
  g.connect(c.destination)
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

/**
 * iOS Safari starts Web Audio and speech only from inside a user gesture. A
 * context first created by a timer stays suspended, and a first `speak()`
 * from a timer returns without speaking (WebKit bug 223473; developer
 * reports) — and every cue in a hold comes from a timer: the counts, the go,
 * the target call. So any tap anywhere resumes the context, and the first
 * one speaks a silent utterance, which lets later programmatic speech
 * through. Taps keep resuming, because Safari suspends the context again when
 * the app goes to the background.
 */
let speechPrimed = false
export function unlockAudio() {
  if (toneEnabled) {
    try {
      ctx ??= new AudioContext()
      if (ctx.state !== 'running') void ctx.resume().catch(() => undefined)
    } catch {
      /* no Web Audio */
    }
  }
  if (voiceEnabled && !speechPrimed && typeof speechSynthesis !== 'undefined') {
    try {
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      speechSynthesis.speak(u)
      speechPrimed = true
    } catch {
      /* no speech */
    }
  }
}

let unlockInstalled = false
/** Listen for the taps that may unlock audio. Once per page. */
export function installAudioUnlock() {
  if (unlockInstalled || typeof document === 'undefined') return
  unlockInstalled = true
  for (const type of ['touchend', 'click', 'keydown'] as const) {
    document.addEventListener(type, unlockAudio, { capture: true, passive: true })
  }
}

/**
 * Audio for a measurement the athlete started and cannot watch — in position,
 * away from the phone — so it plays with sounds switched off. Prime it from
 * the tap that starts the measurement: browsers only let audio start from a
 * gesture, and the beep comes seconds later.
 */
export function primeSignal() {
  // Through the silent switch for this measurement only: the athlete is in
  // position across the room and has nothing else to go on.
  setSessionType('playback')
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    /* no audio: the screen still shows the cue */
  }
}

/** Back to the athlete's own choice once the measurement is over. */
export function releaseSignal() {
  setSessionType(throughSilent ? 'playback' : 'default')
}

/** Three short, loud beeps on the primed context. */
export function signalTone() {
  const c = ctx
  if (!c) return
  for (const delay of [0, 0.2, 0.4]) {
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = 'square'
    osc.frequency.value = 880
    const t = c.currentTime + delay
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(Math.max(volume, 0.6) * 0.3, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.15)
    osc.connect(g)
    g.connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.2)
  }
}

/**
 * Spoken cue via the Web Speech API. Head-down holds make the screen
 * unreadable, so counts are announced out loud. Cancels any queued speech
 * so rapid cues never pile up.
 */
export function speak(text: string) {
  if (!voiceEnabled) return
  try {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.volume = volume
    u.rate = 1.1
    speechSynthesis.speak(u)
  } catch {
    /* no speech support — beeps still carry the session */
  }
}

/** Short haptic pulse on devices that support it (phones, mostly). */
export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* not supported */
  }
}

export const sfx = {
  /** Countdown tick (3‑2‑1). */
  tick: () => tone(880, 0.07, 0, 'square', 0.45),
  /** Go — start of a hold / end of rest. */
  go: () => {
    tone(660, 0.1)
    tone(990, 0.22, 0.1)
  },
  /** Hold stopped. */
  stop: () => tone(392, 0.14),
  /** Target seconds reached mid-hold. */
  target: () => {
    tone(784, 0.1)
    tone(988, 0.1, 0.11)
    tone(1319, 0.26, 0.22)
  },
  /** New personal record. */
  pr: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, i * 0.085, 'triangle')),
  /** Session complete. */
  done: () => {
    tone(523, 0.14)
    tone(784, 0.28, 0.15)
  },
}
