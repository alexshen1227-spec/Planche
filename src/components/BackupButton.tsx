import { useState, type ReactNode } from 'react'
import { exportData } from '../lib/exportImport'
import { useStore } from '../lib/store'
import { pushToast } from '../lib/toast'

export function BackupButton({ children, className, logsOnly = false }: {
  children: ReactNode; className: string; logsOnly?: boolean
}) {
  const { getState, dispatch } = useStore()
  const [busy, setBusy] = useState(false)
  async function save() {
    if (busy) return
    setBusy(true)
    try {
      const at = Date.now()
      const state = getState()
      await exportData(logsOnly ? state : { ...state, lastBackupAt: at }, logsOnly)
      if (!logsOnly) dispatch({ type: 'STAMP_BACKUP', at })
      pushToast('Backup download started.', 'success')
    } catch {
      pushToast(logsOnly ? 'The download could not start. Try exporting again.' :
        'The full backup could not be created. To save your training history now, choose Training data only in Settings.', 'danger')
    } finally {
      setBusy(false)
    }
  }
  return <button type="button" className={className} onClick={() => void save()} disabled={busy} aria-busy={busy}>
    {busy ? 'Preparing backup…' : children}
  </button>
}
