import type { SetLog } from '../types'

/**
 * Camera output is strong enough to steer training only after the athlete has
 * reviewed the set and the two sources broadly agree. A disputed or
 * unconfirmed model guess may still be shown beside the replay, but it must
 * not quietly lower future targets or create a form prescription.
 */
export function trustedCameraEvidence(set: SetLog): boolean {
  const form = set.form
  const auto = form?.auto
  if (!form || form.confirmed !== true || !auto || auto.confidence < 0.5) return false
  const athleteClean = form.rating === 'clean'
  const cameraClean = auto.issues.length === 0 && (auto.cleanRatio ?? 1) >= 0.8
  return athleteClean === cameraClean
}
