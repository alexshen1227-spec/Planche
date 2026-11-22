import { CURRENT_STATE_VERSION, type AppState } from '../types'
import { dayKey } from './time'

/**
 * Save the whole state to a file the athlete keeps.
 *
 * This is the only defence against losing months of training to a cleared
 * browser, so it is written for the awkward browsers rather than the easy one.
 * The anchor is put in the document because a detached one has historically
 * been ignored, and the object URL is released on a later turn: revoking it in
 * the same tick as the click races the download and silently produces nothing
 * on WebKit, which is most of this app's phones.
 */
export function exportData(state: AppState) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fitness-lab-backup-${dayKey(Date.now())}.json`
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function readImportFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)))
      } catch {
        reject(new Error('That file is not valid JSON.'))
      }
    }
    reader.readAsText(file)
  })
}

/** Reject unrelated JSON before any existing history or clips are touched. */
export function validateImport(raw: unknown): asserts raw is AppState {
  if (typeof raw !== 'object' || raw === null) throw new Error('That JSON is not a Fitness Lab backup.')
  const candidate = raw as Partial<AppState>
  if (
    !Number.isInteger(Number(candidate.version)) ||
    Number(candidate.version) < 1 ||
    Number(candidate.version) > CURRENT_STATE_VERSION ||
    typeof candidate.onboarded !== 'boolean' ||
    !Array.isArray(candidate.sessions) ||
    typeof candidate.settings !== 'object' ||
    candidate.settings === null ||
    typeof candidate.stepId !== 'string'
  ) {
    throw new Error('That JSON is not a complete Fitness Lab backup.')
  }
}

function csvCell(v: string | number | undefined): string {
  if (v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Every logged set as one CSV row — skill holds and gym lifts together, for a
 * spreadsheet. The JSON backup stays the one that can be imported back.
 */
export function setsCsv(state: AppState): string {
  const rows: (string | number | undefined)[][] = [
    ['date', 'kind', 'session', 'place', 'exercise', 'section', 'set', 'load_kg', 'unit', 'reps', 'hold_sec', 'rpe'],
  ]
  for (const s of state.sessions) {
    s.sets.forEach((set, i) =>
      rows.push([
        new Date(set.at).toISOString(),
        'skill',
        s.workoutName,
        '',
        set.exerciseId,
        set.section,
        i + 1,
        undefined,
        undefined,
        set.kind === 'reps' ? set.value : undefined,
        set.kind === 'hold' ? set.value : undefined,
        set.rpe,
      ]),
    )
  }
  const places = new Map((state.gym?.locations ?? []).map((l) => [l.id, l.name]))
  for (const s of state.gym?.sessions ?? []) {
    for (const log of s.exercises) {
      log.sets.forEach((set, i) =>
        rows.push([
          new Date(set.at).toISOString(),
          'gym',
          s.name,
          places.get(s.locationId) ?? '',
          log.exerciseId,
          set.warmup ? 'warmup' : 'main',
          i + 1,
          set.kg !== undefined ? Math.round(set.kg * 100) / 100 : undefined,
          set.unit,
          set.reps,
          undefined,
          set.rpe,
        ]),
      )
    }
  }
  rows.sort((a, b) => (a[0] === 'date' ? -1 : b[0] === 'date' ? 1 : String(a[0]).localeCompare(String(b[0]))))
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

export function exportCsv(state: AppState) {
  const blob = new Blob([setsCsv(state)], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fitness-lab-sets-${dayKey(Date.now())}.csv`
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
