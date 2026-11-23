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
- [x] RPE after each set: gym sets (drives double progression) and, optionally, skill sets (`SetLog.rpe`, fatigue only — the skill coach's targets deliberately do not read it).
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

- [x] Tokens (type scale, spacing, colour, radius, motion), dark first (`src/index.css`).
- [x] Component library `src/components/ds/` (Button, Card, Sheet, SegmentedControl, ToggleChip, Stepper, Metric, CountUp, RingTimer, SwipeRow, EmptyState, ErrorState, Skeleton, BadgeGlyph). Charts still use `charts.tsx`.
- [x] Motion: spring transitions, press feedback, count-ups, ring fills,
      unlock moments; `prefers-reduced-motion` respected; haptics on set done.
      Applied to the Fitness screens, then (second pass) the skill screens:
      24 inline-styled accent buttons → `Button` with identical handlers and
      text; charts draw a monotone curve with unit-aware axes.
- [x] (mostly) Every screen: loading, empty and error states; 44 px targets; contrast. Fitness and skill screens both moved to the ds Button, type scale, radii and `min-h-11`; Library/Stats empty states use `EmptyState`. Left: an audit of `h-*`/padding-sized controls, and `ErrorState` is unused (state is synchronous and local).

## Later ideas (for a teen athlete mixing gym, skills and a sport)

Done 2026-11-22: sport-season mode (`prefs.season`, in-season volume 0.7) and
game-day awareness (an upcoming leg-heavy activity within 36 h keeps legs out
and the gym at 0.8), Today's blocks tick off. Still open:
sprint-day-aware leg scheduling beyond the next day,
growth-spurt caution prompt, sleep/readiness check-in, exam-week light plans,
travel mode (bodyweight-only location), coach/parent share card.

## Status at the end of the first night (2026-11-22, ~00:30 PST)

All five phases are built, tested and live on `main` (GitHub Pages). Checks at
handoff: `npm run check` green (1,216 tests, build), `npm run test:clock`
green on all 20 dates and timezones, an independent bug review's 11 findings
fixed and pinned. Usage for the night: weekly 4% → 6%, well inside the goal's
limit.

Open, in order of value (none blocks using the app):
1. ~~Phone test~~ — done 2026-11-22 in the browser's Android phone emulation
   (Pixel 8 user agent, touch, 375 px): hub, sheets, pain check, logger,
   swipe right and left, effort, rest ring, finish summary and a real badge
   unlock. It found three defects, all fixed: a quick swipe judged from a
   stale offset did nothing (now decided from the lift; `Swipe.test.tsx`
   reproduces the phone timing and was mutation-checked), the effort row ran
   off the screen, and the rest bar squeezed its text. A physical phone is
   still the final word.
2. ~~One combined player for a mixed day~~ — done as one flow: starting the
   skills from Today remembers the gym block (`lib/plan/nextBlock.ts`); closing
   the saved skill session hands it to Train, which opens the gym's pain check
   and starts it. Verified end to end in the preview.
3. The real 2105.mp4: still not on this PC. Searched again 2026-11-22
   (Wikimedia Commons, Pexels, Pixabay, Mixkit, Coverr, Videvo): no
   free-licence side-on tuck planche video exists there. Added instead a
   real-landmark regression: the only free planche photo found (Commons
   File:Planche.jpg by Jonathanfv, CC BY 3.0, a clean full planche) run
   through the real BlazePose model in `#devlab` (`captureFixture`) →
   `realPoses.fixture.ts: fullPlancheCommons` (landmarks only), asserted
   clean in `regression2105.test.ts` upright and on a phone turned either
   way, before and after calibrating. When 2105.mp4 is available: `#devlab`
   → analyse it → `fixtureFromPoses()` → `realClips.fixture.ts`.
4. Layouts: Home and Path were redesigned for the phone (hero card, More
   options, week row; Path as a timeline), then Progress (one section style,
   records/achievements/history as compact rows, a 2x2 metrics card) and
   Settings (grouped list rows, controls wrap under labels, 44 px toggles),
   all checked at 375 px for overflow. Then the leftovers: Home's coach,
   goal, tip and achievement cards and Stats' form-trend, pressing and
   then-and-now cards re-laid out as single-column compact rows; Settings
   has its own Camera group after Training. Checked at 375 px: no overflow on
   Home, Progress or Settings, no console errors. `ErrorState` is used where
   a real failure happens (a lockout calibration clip the camera cannot read).
5. Gym achievements beyond the derived badges; per-set notes in the logger.

## Closed with the athlete (2026-11-22)

- Physical-phone test: the athlete tried the live app on their own Android
  phone and reported it works fine (gym logger swipes, rest ring, sheets,
  Today card).
- 2105.mp4: the athlete confirmed the stand-in tests are enough (the clip
  rebuilt as described, plus the real-photo regression). Nothing in the goal
  file is left open.
- Later the same morning: gym session notes (cd0f9ce) and "the part of the
  body left longest" (8291ab6) were added, tested in the suite; the athlete
  signed the goal off ("I feel like u got it") and will check them in use.

## Round two (2026-11-22, the athlete's follow-up request)

- Gym library 79 → 236 with sprint mechanics, plyometric and throw tiers, a
  Speed & power focus, and an under-18 tier gate (`plyoGate`).
- Planner rebuilt around a week engine (`planWeekAhead`): recurring sport
  schedule (`prefs.sportSchedule`), weekly set balancing across days, missed
  sessions re-balanced, rotation hints (`recentPatternUse`, not yet wired
  into the builder), readiness (`dayReadiness`, light/normal/push on
  evidence only). Tests: `week.test.ts` incl. a 60-athlete fuzz.
- Learn, onboarding and the session player re-laid out (layout only; the
  player's tests unchanged).
- Next: an independent strict review scored 1–100, fixed and repeated.

## Round three (2026-11-22): strict review and the fixes

- Independent strict reviews (fresh agents, frozen snapshot, Goal.txt as the
  only brief): 46/100 UX, 44/100 logic. Every listed defect fixed (see
  CLAUDE.md "Second strict review"), plus onboarding in the spec's order and
  skill days.
- Next (athlete's request): the coach recommends one main session a day —
  Calisthenics or Gym — and a gym day may open with matching skill work
  (front lever first on a pull day) when the rest rule and the place allow.
  Then a second strict review.

## Round four (2026-11-22): second strict review

- Fresh reviewers on `58f1153`: 58/100 UX, 53/100 logic (up from 46/44).
  Every major finding fixed (CLAUDE.md "Third review round"), most minors
  and polish too. Known limit: a youth season is not in the closed-loop
  evals; the handstand push-up day can be picked on Train but not assigned
  in the week plan.

## Round five (2026-11-22): third strict review

- Fresh reviewers on `b263978`: 52/100 UX (the first to reach a training
  day) and 60/100 logic (up from 53). Majors fixed: lighter days and weeks
  that change the sets, time away, the rest rule on picked skill days, a
  fuller opener, one message about today, the goal past the placement.

## Round six (2026-11-22): fourth strict review

- Fresh reviewers on `056e7af`: 54/100 UX (inside real sessions for the
  first time) and 46/100 logic (the athlete's own profile over weeks). All
  majors fixed (CLAUDE.md "Fifth review round"). Left: side delts short in
  short weeks; the 1.5× cap holds to within ~5 sets.

## Round seven (2026-11-22): fifth strict review

- Fresh reviewers on `b3aacea`: 52/100 UX, 47/100 logic. The athlete's
  question ("won't lose my planche progress … still improve in the other
  skills, plus gym") was the lens. A closed loop of their week showed the
  planche at 72% of a planche-only control (58% at 72 h, 42% on three days)
  and a front lever never re-tested. Fixed: the first-priority rule, the
  per-skill re-test, the niggle lead, chest presses, per-place days, plan
  stability; pinned by `plan/wholeAthlete.eval.test.ts`.
- Part two (2026-11-23): `spare` and `placeId` wired into every gym screen;
  light pressing days near planche days (a gym press every week, never a
  hard push event); an explicit time is the session budget. Still open: pike
  push-ups and HSPU credited as chest; a picked push focus inside the rest
  rule stays hard (the athlete's pick); a full-body day can log a hard pull
  event the planner did not plan; Home and the Today card have no place
  switcher of their own (the Gym tab's place chips set today's place).

## Round eight (2026-11-23): sixth strict review

- Fresh reviewers on `aed9b9b`: 62/100 UX, 55/100 logic. The logic loop
  (12 weeks, the athlete's own skill order) had the planche at 91% of a
  planche-only control and every step within two days of it, so the round
  went to the rest: HSPU pressing outside shared recovery, a gym focus chosen
  before the week's skill work was counted (push days with the pressing taken
  out, priorities ignored, long days building 21 minutes), two pain memories,
  time away that only changed wording, gym-only skills never planned, and no
  screen saying where each skill trains. All fixed and pinned (CLAUDE.md
  "Seventh review round"). Still open: muscles under their floor with two
  short gym days (now said, not hidden); the long-head triceps slot on
  20-minute pressing days; nothing verified on a physical phone.

## Round nine (2026-11-23): seventh strict review

- Fresh reviewers on `dbea218`: 58/100 UX (it ran out of budget before the
  gym half) and 55/100 logic. The logic loop had the planche at 207 of the
  control's 208 key sets, the front lever tuck → advanced tuck in 9 weeks and
  the HSPU ladder up to deficit wall HSPU. Fixed: the line-up's joint memory
  (a niggle steers until a check-in clears it) and honest joint lines; the
  time-away rail per skill; a focus must train its own muscles; the order
  between lower skills where the rest rules allow; near-zero holds neither
  praised nor called records; no second planche session offered after the
  opener; the retry bar shown in the gym player; unit-switch step-downs; a
  youth rule for large relative jumps. Still open: for planche > HSPU >
  lever the HSPU's pressing shares the planche's rest days, so the lever can
  get more full parts; weekly legs would cost the planche (measured); the
  dropped-names copy waits for a deliberate golden regeneration; the live
  set counter did not reproduce.

## Round ten (2026-11-23): eighth review, split by area

- On `ab673a5` the review was split: a gym-only UX reviewer (41/100 — no
  "next time" per lift after saving, a saved draft still shown as open, a
  started session that was not the previewed one, effort and notes missing
  from the detail) and a data-integrity reviewer (36/100 — the IndexedDB
  mirror overwritten in exactly the failures it exists for, unfinished
  sessions deleted after 18 h, onboarding undone by a second tab, an older
  build stripping newer fields, badges revoked after two goal changes, the
  weekly goal counted two ways, a clock that rewrote birth years). All
  blocker and major findings fixed and pinned (CLAUDE.md "Ninth review
  round"). Still open: on three training days the first-priority rule gives
  the planche all three and the gym one short block (a product call for the
  athlete); the minor merge findings (whole-session last-writer-wins on the
  skill side, setup tombstones, clock moved backwards) and the single
  quarantine slot.

## Log

- 2026-11-22 ~01:00 PST — independent bug review of lib/gym, lib/plan and the
  gym/plan screens (Sonnet, read-only) found 11 defects; all fixed and pinned
  by decision in gym.test / plan.test (two mutation-checked). Knee added to
  `BodyRegion`. Per-exercise history sheet added.

- 2026-11-22 ~00:15 PST — Phase 5 first pass pushed (design system on the
  Fitness screens, swipe/ring/count-up/unlock, emoji badges → icons) and the
  7-day week preview on the Today card. Reviewed in the preview at desktop and
  phone width; swipe, rest ring and save verified; the badge-unlock sheet was
  not triggered in review (no new badge qualified).

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
