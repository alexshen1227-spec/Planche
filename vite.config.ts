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
        globIgnores: [
          // version.json must always come from the network — it is the update signal.
          '**/version.json',
          // The pose model is several megabytes and only some sessions ask for
          // it, so it is fetched on demand and cached after first use rather
          // than forced onto every install.
          '**/pose-*.js',
        ],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/pose-.*\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'pose-lib', expiration: { maxEntries: 4 } },
          },
          {
            // Model weights: the PoseLandmarker .task file and MoveNet's
            // graph, both served from Google's model hosting.
            urlPattern: /^https:\/\/(storage\.googleapis\.com|www\.kaggle\.com|tfhub\.dev)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pose-model',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // MediaPipe Tasks WASM runtime, pinned to the npm package version.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pose-wasm',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    rollupOptions: {
      output: {
        // Predictable name so the service worker can treat the pose stack as
        // an on-demand download rather than part of the app shell.
        manualChunks: (id) =>
          id.includes('@tensorflow') || id.includes('pose-detection') || id.includes('@mediapipe')
            ? 'pose'
            : undefined,
      },
    },
  },
  server: { port: 5173, strictPort: true },
})
