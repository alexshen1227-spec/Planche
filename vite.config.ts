import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
  plugins: [react(), tailwindcss(), emitVersion()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  server: { port: 5173, strictPort: true },
})
