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
  a.download = `planche-lab-backup-${dayKey(Date.now())}.json`
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
  if (typeof raw !== 'object' || raw === null) throw new Error('That JSON is not a Planche Lab backup.')
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
    throw new Error('That JSON is not a complete Planche Lab backup.')
  }
}
