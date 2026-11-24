import './index.css'
import { SETUP_DRAFT_KEY, STORAGE_KEY } from './lib/storageKeys'

// Fetch the likely first screen while React and the saved-data reader load.
// The store still handles backups, unfinished setup and the actual route.
try {
  if (window.location.hash !== '#devlab') {
    const returning = STORAGE_KEY in localStorage && !(SETUP_DRAFT_KEY in localStorage)
    void (returning ? import('./TrainingApp') : import('./views/Onboarding')).catch(() => undefined)
  }
} catch { /* Private storage can be unavailable. The app handles that at boot. */ }

void import('./mount').catch(() => {
  const root = document.getElementById('root')
  if (!root || root.childElementCount) return
  const panel = document.createElement('div')
  panel.className = 'grid min-h-screen place-content-center gap-4 p-6 text-center text-ink'
  const message = document.createElement('p')
  message.setAttribute('role', 'alert')
  message.textContent = 'Fitness Lab couldn’t finish loading.'
  const reload = document.createElement('button')
  reload.className = 'min-h-11 rounded-control bg-accent px-4 font-semibold text-on-accent'
  reload.textContent = 'Reload app'
  reload.onclick = () => window.location.reload()
  panel.append(message, reload)
  root.append(panel)
})
