import type { AppState, SetLog, StepId } from '../types'
import { STEPS } from '../data/progressions'
import { progressionCredit } from './progression'
import { listClips, setPinned, type ClipMeta } from './clips'

/**
 * Clips worth keeping past the 30-day window.
 *
 * Footage is deleted after a month to keep storage bounded, which quietly
 * took the most valuable clips with it: the first time a position was
 * filmed, and the best verified hold of it. Per step, those two are kept —
 * where you started, and where you are now.
 */
export interface MilestoneClip {
  stepId: StepId
  kind: 'first' | 'best'
  clipKey: string
  /** Logged seconds for the first clip; verified (credited) seconds for the best. */
  value: number
  at: number
}

export function milestoneClips(state: Pick<AppState, 'sessions'>): MilestoneClip[] {
  const out: MilestoneClip[] = []
  for (const step of STEPS) {
    const filmed: SetLog[] = []
    for (const session of state.sessions) {
      for (const set of session.sets) {
        if (
          set.exerciseId === step.keyExerciseId &&
          set.kind === 'hold' &&
          set.section === 'main' &&
          set.value > 0 &&
          set.clipKey
        ) {
          filmed.push(set)
        }
      }
    }
    if (!filmed.length) continue
    filmed.sort((a, b) => a.at - b.at)
    // The first clip the camera could read: one it refused (front-on, or a
    // recording with almost no footage) may have nothing to watch.
    const first = filmed.find((set) => set.form?.auto && !set.form.auto.malformed) ?? filmed[0]
    out.push({ stepId: step.id, kind: 'first', clipKey: first.clipKey!, value: first.value, at: first.at })
    let best: { set: SetLog; credit: number } | null = null
    for (const set of filmed) {
      const credit = progressionCredit(set, step.keyExerciseId)
      if (credit > 0 && (!best || credit > best.credit)) best = { set, credit }
    }
    if (best && best.set.clipKey !== first.clipKey) {
      out.push({ stepId: step.id, kind: 'best', clipKey: best.set.clipKey!, value: best.credit, at: best.set.at })
    }
  }
  return out
}

/**
 * Which pins to add and remove so the milestones are kept.
 *
 * Only pins this made are ever removed — and only once their clip stops
 * being a milestone (a better hold replaced it), so it ages out like any other
 * clip. A pin the athlete set stays theirs whatever happens.
 */
export function planMilestonePins(
  wanted: string[],
  ours: string[],
  clips: Pick<ClipMeta, 'key' | 'pinned'>[],
  /** Clips the athlete pinned or unpinned by hand: never touched again. */
  decided: string[] = [],
): { pin: string[]; unpin: string[]; ours: string[] } {
  const byKey = new Map(clips.map((clip) => [clip.key, clip]))
  const want = new Set(wanted.filter((key) => byKey.has(key) && !decided.includes(key)))
  const pin = [...want].filter((key) => !byKey.get(key)!.pinned)
  const unpin = ours.filter((key) => !want.has(key) && byKey.get(key)?.pinned === true)
  const kept = new Set([...pin, ...[...want].filter((key) => ours.includes(key))])
  return { pin, unpin, ours: [...kept] }
}

const AUTO_PINS_KEY = 'planchelab.autopins'
const DECIDED_KEY = 'planchelab.pinchoices'

function readKeys(storageKey: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
  } catch {
    return []
  }
}

function writeKeys(storageKey: string, keys: string[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(keys))
  } catch {
    // Without the list a superseded milestone stays pinned — the safe side.
  }
}

/** The athlete pinned or unpinned this one by hand: it is theirs from now on. */
export function releaseMilestonePin(key: string): void {
  writeKeys(AUTO_PINS_KEY, readKeys(AUTO_PINS_KEY).filter((k) => k !== key))
  const decided = readKeys(DECIDED_KEY)
  if (!decided.includes(key)) writeKeys(DECIDED_KEY, [...decided, key].slice(-200))
}

/** Apply `planMilestonePins` to the clip store. */
export async function syncMilestonePins(state: Pick<AppState, 'sessions'>): Promise<void> {
  const clips = await listClips()
  const plan = planMilestonePins(
    milestoneClips(state).map((m) => m.clipKey),
    readKeys(AUTO_PINS_KEY),
    clips,
    readKeys(DECIDED_KEY),
  )
  const pinned: string[] = []
  for (const key of plan.pin) if (await setPinned(key, true)) pinned.push(key)
  for (const key of plan.unpin) await setPinned(key, false)
  writeKeys(AUTO_PINS_KEY, plan.ours.filter((key) => !plan.pin.includes(key) || pinned.includes(key)))
}
