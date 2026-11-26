# Gym generator stress test, 2026-11-26

The athlete asked for a hunt for logic bugs in the workout plan generator (`lib/gym/builder.ts`):
write down what must always be true of a generated plan, stress-test it across every setting, review
a sample like a strength coach would, fix the root causes, and turn the invariants into tests.

## How to run it

- `npx vitest run src/lib/gym/planInvariants.test.ts`: the matrix (every focus × 10 times × 7 places ×
  4 day factors = 1,960 plans), 600 seeded random athletes, the pinned seeds, the checker's own
  teeth, and one regression test per bug below. About 9 s.
- `STRESS_N=20000 npx vitest run src/lib/gym/planInvariants.test.ts`: a wider random sweep (~30 s).
- `npx vitest run src/lib/plan/plannerInvariants.test.ts`: three athletes run for six weeks through the
  real planner (planche days, light pressing beside a push skill, skill openers, a sport week); every gym
  day it makes is built and checked. `PLANNER_DAYS=84` runs whole 12-week seasons.
- A failure prints its seed; `caseFor(seed)` in `lib/gym/planStress.ts` rebuilds the exact request.

The generated athletes (`planStress.ts`) mix: focus (full, upper, lower, push, pull, speed & power, auto),
15–120 minutes, seven places (bare floor, home, home + band, calisthenics kit, hotel, gym, everything),
teen or adult, six goal profiles, eight bodyweight capacities (beginner to strong, a few reported
pull-ups, introductory, a build-up limit), the athlete's priority muscles, the week's priorities, the
week's steer (including the light-pressing pair), switched-off muscles, rested joints, ratings (random,
or a whole pattern avoided), hard-to-do-here marks, favourites, the 2-minute warm-up after a skill
opener, lighter (×0.6–0.8) and harder (×1.2) days, and history: none, or closed-loop histories made by
logging the builder's own sessions back (short, long, a push/pull/legs split, and one where every lift
stalls).

## The invariants

`lib/gym/planInvariants.ts`. A plan breaks one when (rule id in brackets):

**Structure.** an exercise is not in the catalogue [unknown-exercise]; the name or focus differs from
the request [label]; a plan that does not fit has items, or the estimate and the item count disagree
[unfit-nonempty, estimate]; sets are not whole and positive, a rep range, RPE or rest is out of bounds
[bad-sets, bad-range]; a load suggestion is malformed or has no reason [suggestion]; an exercise or a
movement (two implements of one lift) appears twice [duplicate-exercise, duplicate-movement]; the
left-out list names a planned exercise or repeats [dropped]; a set limit or the introductory dose is
exceeded [set-limit, introductory].

**Time.** the estimate is over the minutes asked, or over 60 for lifting [time]; a request over an hour
is not marked and explained as capped, or a shorter one is [cap-label].

**The athlete's exclusions and gates.** an exercise needs kit the place lacks [kit]; is rated Avoid
[avoid-rated]; trains a switched-off muscle [muscle-off]; loads a rested joint [joint]; is a coached
lift for an under-18 who has not rated it Love [youth-technical]; starts an under-18 below six reps
(hard bodyweight moves, set doses and practice doses aside) [youth-reps]; skips a bodyweight gate
[bodyweight-gate] or the speed-work ladder [plyo]; uses the chin-up inside its rotation [chin-up].

**Day type.** an exercise does not belong to the day, a Push or Pull day trains a muscle outside the day,
or a Pull day works the chest at all [day-type]; a movement the day is named for (press and pull on
upper and full days, squat/lunge/hinge on lower and full, the press and overhead press on Push, the row
and vertical pull on Pull) is missing although one is allowed and the day is 30 minutes or more
[named-missing]; one is missing because nothing is allowed, and the plan does not say why
[named-unexplained]; a named movement is at one set while an accessory or a speed drill keeps two
[named-thin]; a Push or Pull day's main lift is under four sets while isolation work is planned
[mains-first].

**Duplicates and doses.** a finisher is not straight after its lift, is over two sets, or is not an easier
version of it [finisher]; a pair is not adjacent and mutual [pair]; two exercises share a rung of one
ladder, or a harder rung beside an easier one is over two sets [same-rung, harder-volume]; three
isolation exercises aim at one muscle [isolation-per-muscle]; more than two exercises of one pattern
[pattern-repeat]; sets aimed at a muscle pass 10, or 12 for a priority (× the day factor on a harder day)
[muscle-ceiling]; an exercise is over four sets (five on a harder day or with the week's priorities)
[item-sets]; the session is over 30 sets (× factor) [session-sets]; curls outnumber a Pull day's back
compounds [curl-cap].

**Order.** speed work is not first [explosive-first]; an isolation exercise comes before a compound that
works its muscle [fatigue-order]; trunk work comes before any compound [core-early].

**Light and hard days.** a lighter day keeps an RPE above 7 (6.5 under 18) [light-rpe]; a light pressing
day (front delts and triceps spared beside a push skill) has four or more pressing sets, more than one
pressing exercise, or other front-delt/triceps work [light-press]; a lighter speed day has high-impact
work [athletic-light].

**Notes.** a stall note's stand-in is not planned, or the stalled lift still is [note-stall]; a
"new to you" exercise is not planned or was logged before [note-explore]; an alternating note has no
pair [note-pair]; a fill note quotes other minutes [note-fill]; a note repeats [note-twice].

**Between two builds** (`relationalViolations`): the same request built twice differs [deterministic];
a lighter day has more sets than the usual one, or builds nothing where it builds something
[light-not-lighter]; a harder day has fewer [hard-not-harder]; 15 more minutes give fewer sets
[more-time-fewer-sets]; a leg priority changes a Push or Pull day [offday-priority].

The planner test adds: a light pressing day the planner made stays under a hard pressing session
(`HARD_GYM_FAMILY_SETS`), an opener and its lifts fit the day's minutes, and a deload is lighter.

## What it found

First sweep: 5,960 plans, 7 rules broken. A coach-style review of 70 sampled plans (a Sonnet reviewer,
every claim checked against the plans before acting) added three more. The wider sweep found two in the
long tail. Each line: settings → bad output → root cause → fix.

1. **Notes named exercises the plan did not have** (578 plans). Full body, 15 min, gym, teen, power
   goals, long history, ×0.6 → "Lat pulldown has not beaten its best… so Leg press takes its place" on a
   plan of step-down landings, a Romanian deadlift and bench dips. *Cause:* stall and "new to you" notes
   were pushed when a slot was filled; the time fit, the lighter day or a practice dose could then remove
   the pick. *Fix:* `pickNotes` carry the exercise they are about and are said only if it is planned.
2. **Short days dropped the lifts they are named for.** Full body, 20 min, strength → one goblet squat
   (13 of 20 min); upper, 20 min, strength → one incline press; full, 30 min, power goal, ×0.8 → no pull,
   pogo hops kept. *Cause:* the named movements (`anchors`) existed only on Push/Pull or priority days,
   the non-split trim always removed the last item, and named lifts were never cut to one set before one
   went. *Fix:* anchors on every day; the trim takes accessories first (speed drills last among them),
   then one set of each named lift before any goes. Short rotating visits (`briefSlots`) keep their
   rotation.
3. **A drill stood for the day's pull.** Upper, 30 min, home, ×0.8 → one-arm row ×1 beside scapular pull-up
   ×2. *Cause:* the anchor was the group's first movement, or the protected priority movement, even an
   isolation drill. *Fix:* `namedIn` names a group by its first compound.
4. **Lighter days thinned the main lifts first** (review). Full body, 45 min, gym, power, ×0.8, chest and
   side-delt priorities → pull-up ×1 beside a fly ×2 and a lateral raise ×2; upper, ×0.6 → explosive
   push-up ×2 beside a row ×1. *Cause:* the lighter day's cut ignored the named lifts, and a speed drill
   inherited a priority muscle's protection. *Fix:* named lifts give up sets last; speed drills count as
   accessories there.
5. **Muscles past their session ceiling** (99 plans). Full body, 60 min, home, a weekly glute priority,
   wrists rested → Cossack squat ×4, hip thrust ×4, bird dog ×4 = 12 glute sets (ceiling 10); upper, 120
   min, bare floor, chest priority → four push-up variations ×4 = 16 chest and 16 triceps sets. *Cause:*
   every exercise training a priority muscle gets an extra set, and the ceiling was enforced only where
   spare time added work and on Push/Pull days. *Fix:* `holdCeilings` before the time fit and after the
   last added set, on every day (a harder day's ceiling scales with its factor).
6. **The ceiling then cut the main presses for a drill.** Push, 60 min, gym, power, stalled history →
   explosive push-up ×4 kept, both main presses ×3. *Cause:* set-dosed work was excluded from giving
   sets. *Fix:* it gives first, as the non-named work it is.
7. **Three exercises of one pattern** (14 plans). Lower, 90 min, home, teen, knees rested → kickstand
   dumbbell RDL ×5, dumbbell RDL ×3, single-leg RDL ×3; full, 60 min → leg press, sumo squat,
   heel-elevated goblet squat. *Cause:* the spare-time fill limited repeats only for upper-body isolation
   and core. *Fix:* `PATTERN_LIMIT` = 2 for every addition.
8. **Two finishers on one lift** (1 plan). Upper, 90 min, calisthenics kit, teen, 3 reported pull-ups,
   ×1.2 → pull-up ×3, then a slow negative ×2 and a band-assisted pull-up ×2 as finishers. *Cause:* the
   spare-time fill gave the pull-up a finisher, then its practice dose added a back-off without looking.
   *Fix:* the back-off replaces any other finisher of that lift.
9. **A 15-minute day planned at 16 minutes** (1 plan). Pull, 15 min, home + band, strength, beginner.
   *Cause:* the saving for the last set's rest was read from the build order; the fatigue order then
   moved the 75 s scapular pull-up behind the 180 s row. *Fix:* `putInOrder` is the one ordering, used
   both to run the session and to time it.
10. **Build-up limits overshot** (7 plans). Push, 60 min, ×1.2, limit 10 → 9 sets where the usual day
    had 10; full, 75 min, hotel → the usual day 9 sets, its lighter day 10. *Cause:* the cap removed a
    two-set movement to lose one set. *Fix:* a harder day's fifth main set goes first, and the last trim
    takes only the excess.
11. **Core work between squats** (review). Lower, 60 min, calisthenics kit, abs priority, ×1.2 → dead bug
    second of seven. *Cause:* the priority ordering put the athlete's core pick early, and the fatigue
    order only moved isolation behind compounds that share a muscle. *Fix:* trunk work goes after the last
    compound.
12. **Days that could not be what they are called, silently** (review). Push, 35 min, bare floor, front
    delts off, elbows rested → one dead bug; push, 45 min, hotel, shoulders and elbows rested → an empty
    plan; upper on a bare floor → presses only; speed & power with the knees rested → one glute bridge.
    *Cause:* the builder could say what the time left out, but had no state for "your settings left
    nothing" (the app's rule: every number must be able to say it does not know). *Fix:* the plan says so:
    "No press today: every option here loads your rested shoulders and elbows." Each option is put down to
    the athlete's own settings first. The Gym screen's empty-plan box no longer says to add equipment when
    the notes give another reason (checked in the app: a Push day with the pressing muscles switched off).
13. **"Left out for time" listed a planned exercise** (1 in 20,000). Lower, 35 min, gym, teen, quad and
    glute priorities → leg extension planned and listed as left out. *Cause:* a priority's second exercise
    can come back after the time fit, and the list was never reconciled. *Fix:* the list is read off the
    finished plan.
14. **A stalled lift came back as a finisher** (1 in 20,000). Lower, 60 min, calisthenics kit, ×0.6, knees
    rested → "Glute bridge… so single-leg hip thrust takes its place", then glute bridge ×1 as its
    back-off. *Cause:* the leg-practice back-off did not know what the stall rule set aside. *Fix:*
    `setAside`.

After the fixes: 0 violations on 21,960 generated plans (the matrix, 20,000 random, the pinned seeds)
and on 97 planner-built gym days (13 light pressing, 57 after a skill opener) across three 12-week
seasons (`PLANNER_DAYS=84`). Each fix was mutation-checked: reverting it fails the permanent tests, except item 8 (below).
`GYM_PLAN_REVISION` is 5, so open plans nobody has started are rebuilt.

## Checked and left as they are

From the coach review, after checking each against the plans: most "Push day with no pushing" and empty
sessions were the athlete's own exclusions (now explained, item 12). Two lateral raises for a side-delt
priority, or two flies for chest and upper chest, are within the two-per-muscle rule. An upper day with
no row when the week already has plenty of upper-back work is the week's steer doing its job. Two rows on
a full-body day at a place with no bar is within the pattern limit.

## Not sure / open

- **Item 8 is not pinned by a reproducing test.** It came from one random history that changed when the
  harness was made reproducible, and a targeted search afterwards (and on the old builder) found no input
  that produces two finishers. The one-line guard stays because it is where the second finisher was
  created; the `finisher` invariant in the sweep would catch a return.
- **One eval assertion was rewritten.** `wholeAthlete.eval` expected the shorter-opener week to give the
  quads more sets. That held only while a full-body day's pull could be a scapular pull-up; with the row
  kept (item 3), the extra minutes go to the hamstrings (+5) and upper back (+3) and the quads stay level.
  It now asserts that no priority muscle loses a set and the priorities together gain.
- **Six pinned short-day outputs changed** in `review7.test` (a 20-minute full-body day keeps one set of
  its pull; a lighter 45-minute lower day trims the calf raise instead of the squat).
- **The builder is about 10% slower per call** (3,000 requests: ~700 ms before, ~790 ms after). Part of
  it is real work: trimming a muscle past its ceiling before the time fit leaves the fill more room. One
  planner fuzz test in `round4.test` already ran at ~90% of the default 20 s under full-suite load and
  crossed it; it now has the 120 s its sibling fuzz tests in that folder already had.
- A speed & power day's single strength lift follows the goal's rep range, so an endurance goal gives
  12–20 reps after sprints. A coach might prefer low reps there; it is a product choice.
- On full-body days, core work nobody asked for can reach 4–5 sets through the spare-time top-up and a
  harder day. That is the "top existing exercises up to four sets" rule; capping core lower is a choice.
- An upper day with time for three lifts gets two presses and one pull (the slot order). Whether the
  third lift should follow the week's push/pull balance, like the brief rotation does, is open.
- When the exclusions leave a day with nothing it is named for, the builder still builds what remains
  (often one core exercise) and explains why. Whether the planner should pick another day type instead
  is a product call.
