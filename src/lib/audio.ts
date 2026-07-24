let ctx: AudioContext | null = null
let enabled = true
let volume = 0.7

export function configureAudio(on: boolean, vol: number) {
  enabled = on
  volume = vol
}

function ac(): AudioContext | null {
  if (!enabled) return null
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
 * Spoken cue via the Web Speech API. Head-down holds make the screen
 * unreadable, so counts are announced out loud. Cancels any queued speech
 * so rapid cues never pile up.
 */
export function speak(text: string) {
  if (!enabled) return
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
