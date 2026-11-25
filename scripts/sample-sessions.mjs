// Prints the gym builder's Push and Pull sessions for a matrix of budgets, priorities and places as a Markdown table,
// with every generator rule checked on each session (src/lib/gym/sampleSessions.ts). Exits 1 if any check fails.
//
//   npm run sessions:sample
//
// The TypeScript sources are loaded through Vite, the same way the app is built.
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
try {
  const { sampleSessions, sampleTable } = await server.ssrLoadModule('/src/lib/gym/sampleSessions.ts')
  const rows = sampleSessions(Date.now())
  console.log(sampleTable(rows))
  const bad = rows.filter((row) => row.issues.length)
  console.log(`\n${rows.length} sessions, ${bad.length} with issues.`)
  process.exitCode = bad.length ? 1 : 0
} finally {
  await server.close()
}
