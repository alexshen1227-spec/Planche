// Runs the test suite as if on a spread of other days, to catch tests that
// depend on when they are run. See src/lib/testClock.setup.ts.
//
//   npm run test:clock            every date below
//   npm run test:clock -- 2027-01-01T00:02:00 2027-03-14T12:00:00@Asia/Tokyo
//
// A date may carry a timezone after an @. The deploy workflow runs the tests
// in UTC, and "today" in the app is the athlete's own calendar day — the tip
// of the day once changed at midnight in Greenwich.
import { spawnSync } from 'node:child_process'

const DATES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      // One of each weekday (calendar-week rules), at noon.
      '2026-11-16T12:00:00',
      '2026-11-17T12:00:00',
      '2026-11-18T12:00:00',
      '2026-11-19T12:00:00',
      '2026-11-20T12:00:00',
      '2026-11-21T12:00:00',
      '2026-11-22T12:00:00',
      // Either side of midnight, a month end and a year end.
      '2026-11-19T00:03:00',
      '2026-11-30T23:58:00',
      '2026-12-31T23:58:00',
      '2027-01-01T00:02:00',
      // Daylight-saving changes (US dates; harmless elsewhere) and a leap day.
      '2027-03-14T02:30:00',
      '2027-11-07T01:30:00',
      '2028-02-29T12:00:00',
      // Far enough out that every fixed-date fixture is long past.
      '2029-06-15T08:00:00',
      // Other timezones: UTC (the deploy workflow), a half-hour offset, both
      // sides of the date line, and late evening where the local day and the
      // UTC day differ.
      '2026-11-19T12:00:00@UTC',
      '2026-11-19T21:30:00@America/New_York',
      '2026-11-19T12:00:00@Asia/Kolkata',
      '2026-11-19T07:00:00@Pacific/Auckland',
      '2026-11-19T23:30:00@Pacific/Honolulu',
    ]

let failed = 0
for (const entry of DATES) {
  const [date, zone] = entry.split('@')
  const run = spawnSync('npx', ['vitest', 'run'], {
    env: { ...process.env, FAKE_NOW: date, ...(zone ? { TZ: zone } : {}) },
    encoding: 'utf8',
    shell: true,
  })
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const summary = out.split('\n').filter((line) => /^\s*Tests\s/.test(line)).pop()?.trim() ?? 'no summary'
  const broken = out.split('\n').filter((line) => /^\s*[×✗]/.test(line)).map((line) => line.trim())
  const ok = run.status === 0
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${entry}  ${summary}`)
  for (const line of broken.slice(0, 10)) console.log(`        ${line}`)
}
console.log(failed ? `\n${failed} of ${DATES.length} dates failed.` : `\nAll ${DATES.length} dates passed.`)
process.exit(failed ? 1 : 0)
