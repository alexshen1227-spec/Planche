# Fitness Lab — build plan and status

The goal (Goal.txt, set 2026-11-21): turn Calisthenics Lab into **Fitness Lab**,
one app where gym training and calisthenics skills are planned together. This
file is the plan *and* the status board. An agent continuing the goal reads
this first, then `git log`, then carries on from the first unchecked box.

Rules that hold at every step (from the goal and CLAUDE.md):

- Nothing saved is lost. State migrations are additive; a save from any earlier
  version opens with every session, record, badge and setting intact. The
  planche-only save must keep opening unchanged.
- `npm run check` green before every push; `npm run test:clock` after anything
  that reads the calendar. The planche evals (closedLoop, coach.eval,
  formJudge.eval, programming, bridge, audit, v2, core) must stay green.
- Every number can refuse to exist (CLAUDE.md "V2 product rule"), and copy keeps
  evidence tiers honest. Gym programming norms (rep ranges, weekly set targets,
  RPE, deloads) are mostly CONSENSUS or MODERATE and say so.
- Under-18 athletes: no 1RM testing, conservative jumps, no weight-loss or
  calorie features, bodyweight tracking off by default.
- Push to `main` in large, working steps, each with a changelog entry.

## Phase 1 — camera judge fixes (the goal says: first)

Diagnosis (2026-11-21, read from `src/lib/poseForm.ts`):

- **Hip sign.** `hipOffset = (shoulder.y − hip.y) / torso` in the turned-upright
  frame: positive = hips above the shoulders = `pike`, negative = `sag`. That is
  the right sign for screen y growing downward. The reported "hips above
  shoulders flagged as sagging" is most likely the *setup and exit* — hips drop
  below the shoulders as the feet come back to the floor, and those moments are
  inside the analysed window — or a wrongly turned picture. Fix: (a) pin the
  sign convention with tests in every picture orientation and both facing
  directions (hip, lean, shrug); (b) judge only the hold window (below).
- **Elbows.** A locked arm reads 167–170° for this athlete (and 164–179° on
  real photos generally), while the named-fault bar sits at 172° (180 − 8), the
  softening bar at 167° and the per-moment bar at 164°. Every hold of theirs
  could be named "bent arms". Fix: a per-athlete **lockout reference**. Until
  calibrated the reference is 173°, which puts the named-fault bar at 165° as
  the goal asks; a one-time calibration (film a locked-arm support side-on)
  measures the athlete's own reading. All elbow bars keep their measured widths
  (8° / 13° / 16°) and are measured from the reference instead of from 180°.
- **Hold window.** Score only the stretch where the hold is actually happening:
  feet off the ground for holds that need it, and the body steady. Setup and
  exit are trimmed and reported ("judged 1.4–11.2s").
- **Regression clip 2105.mp4** (a clean ~10 s tuck) — not found on this PC
  (searched the user folders on 2026-11-21). When it is available: analyse it in
  `#devlab`, freeze it with `fixtureFromPoses()`, add it to
  `realClips.fixture.ts` (landmarks only) and assert it verifies clean.
- Manual verify override with a saved video as proof — already exists
  (`FormCheck` athlete confirmation + kept clip); keep it working.

- [x] Sign-convention tests (hip / lean / shrug × 4 picture orientations × 2 facings) — they found the real bug: a hips-high tuck on a sideways phone was not turned upright (trunk 60°, inside the trunk rule's blind spot) and read as a sag. Fixed with a plumb-line rule (judge v8).
- [x] Lockout reference + calibration (`lib/lockout.ts`, Settings → Lockout calibration)
- [x] Hold-window detection (`lib/holdWindow.ts`): edge feet-down + settling trimmed, never the middle
- [x] JUDGE_VERSION 8, changelog, pushed
- [x] Regression for 2105.mp4: the clip is not on this PC and no free-licence side-on tuck was found (Wikimedia Commons, Pexels searched 2026-11-21), so — as the user allowed — `regression2105.test.ts` rebuilds it as reported (sideways phone, hips above the shoulders, arms reading ~171°, setup and landing in the window) and asserts it verifies clean, uncalibrated and calibrated. When the real clip turns up: freeze it with `fixtureFromPoses()` into `realClips.fixture.ts` and assert the same.

## Phase 2 — Fitness Lab foundation

- [x] Rebrand: name in `src/data/app.ts`, manifest, title, About. Storage keys
      keep `planchelab.`.
- [x] State v9 (additive): `state.gym` — locations (Home seeded from the kit),
      active location, sessions, ratings, favourites, tombstones. Goal weights,
      muscle settings, schedule and outside activities are Phase 3 (add them
      to `GymState` the same additive way).
- [x] Gym exercise library (`src/data/gym/`, ~75 movements; alternatives are computed by `alternativesFor`): pattern, primary/secondary muscles
      (fractional set credit), equipment needed, alternatives, joint stress
      tags (wrists / elbows / front delts / lower back / knees), rep ranges.
- [x] Locations and equipment: named gyms, equipment lists (dumbbell max,
      increments, kg/lb per location or item), favourite gym per exercise,
      "hard to do here", quick swap to an alternative.
- [x] Gym logging (`components/gym/GymPlayer.tsx`; per-set notes not yet): start at a location, sets of weight × reps × RPE (1-tap
      6–10), rest timer, last weight auto-filled, notes.
- [x] (gym achievements still open, Phase 4) Double progression + smallest increment for that equipment; e1RM
      (RPE-adjusted, ≤12 reps) per exercise, per location working weights and a
      shared estimate; PRs per exercise; gym achievements.

## Phase 3 — planning together

- [x] Goal weights (Strength, Explosiveness, Physique, Skills, Endurance) and
      skill goals with dates (on pace / behind, from `forecast.ts`).
- [x] Muscle toggles and priorities; weekly sets per muscle with
      under / on target / over.
- [x] Shared fatigue model: muscles + joints (front delts, wrists, elbows shared
      by planche, push-ups and pressing; front lever with rows and pull-ups);
      minimum rest between hard straight-arm sessions (default 48 h).
- [x] (today, not yet a 7-day preview) Week planner over available days and minutes; skill work first; drops
      low-priority accessories first when short; "I have X minutes" quick start.
- [x] Outside load: log sprinting / practice / games / PE with intensity; it
      counts toward leg and nervous-system fatigue, and can stand in for leg day.
- [x] RPE-based load adjustment and automatic deloads (RPE drift, performance
      drop, 4–6 hard weeks) — labelled as convention.

## Phase 4 — insight, safety, export

- [x] (setup wizard `FitnessSetup`, opened from the Today card until a plan exists; gym achievements done as derived badges) Age-aware defaults surfaced in onboarding (goals → locations → schedule →
      muscles → age and safety). Done so far: careful mode reads `profile.birthYear`
      (unknown = careful); bodyweight reminders are opt-in (`settings.trackBodyweight`)
      and never for under-18s. Still to do: the onboarding steps themselves, and
      gym achievements (they need a hook on the gym save path — achievements only
      run on skill-session saves today).
- [x] Pain check covers gym sessions (one tap before starting; niggle steers round, pain keeps it out and lightens the day; recorded for the skill coach).
- [x] Weekly summary (Progress tab, `lib/plan/weekly.ts`): sessions, skill hold time, gym sets, new estimated maxes, streak, focus next week; the Today card's reasons say why.
- [x] Charts: estimated max per lift over time (tap to inspect) in the weekly summary; skill hold charts already existed. Gym badges are derived (`gymBadges`), never stored.
- [x] CSV export beside JSON (`setsCsv`).

## Phase 5 — design system and UI overhaul

- [ ] Tokens (type scale, spacing, colour, radius, motion), dark first.
- [ ] Component library: buttons, cards, sheets, inputs, steppers, charts.
- [ ] Motion: spring transitions, press feedback, count-ups, ring fills,
      unlock moments; `prefers-reduced-motion` respected; haptics on set done.
- [ ] Every screen: loading, empty and error states; 44 px targets; contrast.

## Later ideas (for a teen athlete mixing gym, skills and a sport)

Sport-season mode (in-season volume caps), sprint-day-aware leg scheduling,
growth-spurt caution prompt, sleep/readiness check-in, exam-week light plans,
travel mode (bodyweight-only location), coach/parent share card.

## Log

- 2026-11-22 ~00:40 PST — Phase 3 pushed: `lib/plan/` (load, planner),
  Today card on Train, goals/schedule editor, weekly volume, activity log.
  Open in Phase 3: a 7-day preview of the week; one combined player instead
  of skills-then-gym as two sessions.

- 2026-11-21 ~23:55 PST — Phase 1 pushed (judge v8 + 2105-style regression).
  Phase 2 pushed: Fitness Lab rebrand, state v9 gym branch, library, places,
  logger, double progression. Clicked through in the preview at desktop and
  phone width (set up Home, built a session, logged a set, saved).

- 2026-11-21 22:40 PST — plan written; Phase 1 started. Usage budget for the
  night: weekly must stay ≥ 85% left at 08:30 (it was 96% left at 22:30).
