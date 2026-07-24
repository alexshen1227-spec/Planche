import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Stamped once per build; the deployed version.json lets running clients
// detect that a newer build has shipped and offer a refresh.
const buildId = Date.now().toString(36)

function emitVersion(): Plugin {
  return {
    name: 'emit-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: buildId }),
      })
    },
  }
}

export default defineConfig({
  // Served from https://<user>.github.io/Planche/ in CI; root locally.
  base: process.env.GITHUB_PAGES ? '/Planche/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    emitVersion(),
    VitePWA({
      // We show our own refresh banner; the waiting SW activates only when
      // the user accepts, so mid-session state is never yanked away.
      registerType: 'prompt',
      // public/manifest.webmanifest is hand-maintained; don't generate one.
      manifest: false,
      includeAssets: ['icon.svg', 'manifest.webmanifest'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}'],
        // version.json must always come from the network — it is the update signal.
        globIgnores: ['**/version.json'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  server: { port: 5173, strictPort: true },
})
