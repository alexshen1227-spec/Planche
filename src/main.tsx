import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { StoreProvider } from './lib/store'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installAudioUnlock } from './lib/audio'

// Before any cue can fire from a timer: see `unlockAudio`.
installAudioUnlock()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <StoreProvider>
        <App />
      </StoreProvider>
    </ErrorBoundary>
  </StrictMode>,
)
