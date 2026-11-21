import { vi } from 'vitest'

/**
 * Lets the whole suite be run as if on another day: `FAKE_NOW=2027-01-01T00:02:00
 * npm run test` freezes `Date` there (timers stay real, so async tests still
 * run). Without the variable this file does nothing.
 *
 * It exists because the suite turned out to depend on the day it was run. One
 * coach eval failed on Thursdays only — the easy-week rule walks calendar
 * weeks — and two programming tests built on a fixed date were due to start
 * failing a few weeks later, when their fixtures aged out of a recency window.
 * None of that shows up by running the tests today. `npm run test:clock`
 * (scripts/clock-sweep.mjs) runs the suite across weekdays, midnights, year
 * ends, a leap day and both daylight-saving changes.
 */
const at = process.env.FAKE_NOW
if (at) {
  const when = new Date(at)
  if (Number.isNaN(when.getTime())) throw new Error(`FAKE_NOW is not a date: ${at}`)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(when)
}
