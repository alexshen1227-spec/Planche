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
- [ ] Regression clip: 2105.mp4 is not on this PC; the user said to use a decent clip found online instead (next step)

## Phase 2 — Fitness Lab foundation

- [ ] Rebrand: name in `src/data/app.ts`, manifest, title, About. Storage keys
      keep `planchelab.`.
- [ ] State v9 (additive migration): `profile.locations` (Home seeded from the
      existing kit), active location, units, gym preferences, goal weights,
      muscle settings, schedule, outside activities.
- [ ] Gym exercise library (`src/data/gym/`): pattern, primary/secondary muscles
      (fractional set credit), equipment needed, alternatives, joint stress
      tags (wrists / elbows / front delts / lower back / knees), rep ranges.
- [ ] Locations and equipment: named gyms, equipment lists (dumbbell max,
      increments, kg/lb per location or item), favourite gym per exercise,
      "hard to do here", quick swap to an alternative.
- [ ] Gym logging: start at a location, sets of weight × reps × RPE (1-tap
      6–10), rest timer, last weight auto-filled, notes.
- [ ] Double progression + smallest increment for that equipment; e1RM
      (RPE-adjusted, ≤12 reps) per exercise, per location working weights and a
      shared estimate; PRs per exercise; gym achievements.

## Phase 3 — planning together

- [ ] Goal weights (Strength, Explosiveness, Physique, Skills, Endurance) and
      skill goals with dates (on pace / behind, from `forecast.ts`).
- [ ] Muscle toggles and priorities; weekly sets per muscle with
      under / on target / over.
- [ ] Shared fatigue model: muscles + joints (front delts, wrists, elbows shared
      by planche, push-ups and pressing; front lever with rows and pull-ups);
      minimum rest between hard straight-arm sessions (default 48 h).
- [ ] Week planner over available days and minutes; skill work first; drops
      low-priority accessories first when short; "I have X minutes" quick start.
- [ ] Outside load: log sprinting / practice / games / PE with intensity; it
      counts toward leg and nervous-system fatigue, and can stand in for leg day.
- [ ] RPE-based load adjustment and automatic deloads (RPE drift, performance
      drop, 4–6 hard weeks) — labelled as convention.

## Phase 4 — insight, safety, export

- [ ] Age-aware defaults surfaced in onboarding (goals → locations → schedule →
      muscles → age and safety).
- [ ] Pain check covers gym sessions; load for the area is reduced.
- [ ] Weekly summary: sets per muscle, skill hold time, PRs, streak, focus for
      next week; coach lines that say why.
- [ ] Charts: e1RM and estimated max hold over time, tap to inspect.
- [ ] CSV export beside JSON.

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

- 2026-11-21 22:40 PST — plan written; Phase 1 started. Usage budget for the
  night: weekly must stay ≥ 85% left at 08:30 (it was 96% left at 22:30).
