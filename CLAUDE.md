# Fitness Lab — working notes for agents and developers

Local-first PWA for gym training and calisthenics skills planned together
(the planche, front lever, handstand and handstand push-up, 90° hold and
human flag, beside gym lifts). It was Planche Lab, then Calisthenics Lab, and
became Fitness Lab on 2026-11-21: the name lives in `src/data/app.ts`, while
storage keys keep their `planchelab.` prefix and `window.__planche` its name,
so nothing saved moved. **The Fitness Lab build plan and status board is
`docs/fitness-lab-plan.md` — read it first when continuing that work.**
Vite + React 19 + TypeScript + Tailwind v4.
No backend, no router, no state library: one reducer over localStorage, with an
IndexedDB mirror for crash safety. Nothing a user does ever leaves their device.

## Commands

- `npm run dev` — dev server (honors `PORT`; defaults to 5173, strictPort)
- `npm run test` — vitest suite (pure logic; no DOM, no model downloads)
- `npm run check` — tests, then `tsc --noEmit` + production build
- `npm run test:clock` — the suite run as if on twenty other days and in five
  other timezones (each weekday, midnights, a year end, a leap day, both
  daylight-saving changes; UTC is what the deploy workflow runs in).
  `FAKE_NOW=<date> npm run test` does one. Run it after touching anything that
  reads the calendar: one coach eval failed on Thursdays only, two tests built
  on a fixed date were weeks from failing for good — which would have blocked
  every deploy — and the tip of the day changed at midnight in Greenwich.
  Nothing showed any of it until the suite was run on other days. A function
  that plans or builds for a time takes that time (`now`) and passes it down,
  never `Date.now()` halfway through; "today" is the athlete's local calendar
  day, never `Math.floor(now / DAY)`.
- Deploy: push to `main` → GitHub Actions → GitHub Pages. Clients poll
  `version.json` and offer a refresh.

## Architecture in one paragraph

Sessions are pure data. PRs, unlocks and achievements are **derived by
replaying history** through `src/lib/engine.ts` — never mutate them directly;
append sessions instead. The coach (`src/lib/coach.ts`) decides, `signals.ts`
only observes, hard `LIMITS` clamp last. Live workouts mirror to
`planchelab.draft` continuously so a dying tab loses nothing. Modals must stay
portalled to `document.body` (every view root's animation makes it a containing
block for `position: fixed`).

## The V2 product rule

**Every number shown to an athlete must be able to refuse to exist.** That is
the through-line: the placement reports a confidence and its own
contradictions, the forecast returns a range or declines, the plateau
diagnosis names a cause or says it cannot separate them, and the judge already
reports `unseen`. When adding anything that produces a number, give it a
"not enough evidence" branch and make sure that branch is reachable — most of
the V2 bugs found in review were screens that had no state for *don't know*.

Where a claim rests on coaching consensus rather than evidence, the copy says
so. See "Evidence tiers" below.

## V2 domain modules

- `src/lib/assessment.ts` — the placement interview. Pure: answers in,
  `Placement` out. The ladder stops at the first rung answered zero, and
  **steps past the frog stand** (a bent-arm balance drill, not a straight-arm
  gate) rather than stranding someone who has a tuck planche.
- `src/lib/forecast.ts` — `forecastUnlock` returns `ready | range |
  not-trending | insufficient`. The interval is the interquartile spread of
  *pairwise* rates (Theil–Sen-ish), not a least-squares line: one lucky hold
  must not rotate the estimate. Rates come from the last 8 weeks whenever that
  window alone meets the minimums — the same reasoning *within* a step: a fast
  first month kept promising ~7 weeks when the current pace said ~26.
  `goalOutlook` measures only from completed
  steps at Tuck or above — extrapolating the quick early steps onto the hard
  ones produced "1–14 weeks to a straddle", which is wrong rather than wide.
- `src/lib/plateau.ts` — `diagnosePlateau` separates *is it stalled* from
  *why*. Cause order is deliberate: noise first (every other prescription
  would be acting on a fiction), then recovery (the one cause where "train
  more" is actively harmful), then form, then frequency, then the ceilings.
- `src/lib/formTrend.ts` — the judge, longitudinally. `readFormTrends(state,
  exerciseId)` returns per-criterion direction or `insufficient`. Three rules
  keep it honest: a criterion listed in the set's `unseen` contributes
  **nothing** (and the coverage — "seen in 7 of 11" — is shown, not hidden); a
  change smaller than that criterion's `MATERIAL_TOLERANCE` is `steady`, never
  a direction; and trends never pool two exercises. Slope is
  `robustSlopePerWeek`, so one hallucinated frame — including at the end of the
  series — cannot flip a verdict.
- `src/lib/loading.ts` — lever fractions. A progression *name* is not a
  difficulty: an advanced tuck spans ~72–92% of full-planche load on hip angle
  alone. Used to weight weekly volume and to detect *difficulty drift* (hold
  times improving because the position got easier). The fractions are
  INFERENCE from a rigid-body model — coarse on purpose, never a grade.

### Things measured or corrected, not assumed

1. **Early strength gains are largely neural.** Measured strength can rise
   ~30% while muscle CSA *and* tendon stiffness are both unchanged. So a big
   capability jump holds volume steady. Do **not** restate this as "tendons lag
   muscle by two months" — the same time-course data does not support it (on
   detraining, muscle size decayed sooner).
2. **Deloads are convention, not proven.** Two controlled trials exist; neither
   found a benefit, one leaned mildly against. The copy says that. Do not
   reintroduce "strength lands during recovery".
3. **The 10%-per-week progression rule failed its RCT** (20.8% vs 20.3%
   injury). `MAX_WEEKLY_LOAD_RAMP` is a design heuristic and is labelled as
   one wherever it reaches an athlete. Same for `readinessLoad`, which is an
   acute:chronic ratio — a construct with substantial published criticism. It
   may describe load; it must never claim to predict injury.
4. **Pain must not build week on week.** `signals.persistentComplaint` is the
   rail with the best evidence behind it in the whole app, and it deliberately
   outranks today's answer: every per-session check let a recurring elbow
   through, because on any given day it was only a niggle.
5. **No hold-time standard is validated.** Credible coaches disagree by 3–6×,
   and the widely-repeated "10 second rule" traces to no named coach. The
   unlock bars are convention. Do not present them as measured.

### Two rules that came out of the V2 review

**A rail that only changes wording is not a rail.** Independent mutation
testing broke eight decisions the suite could not see, because the assertions
around them checked the *sentence* rather than the number. Every safety rail
now asserts the decision it makes (`volumeFactor`, `loadPermission`,
`suggestMaxTest`, `dayType`), not the copy that accompanies it. `LIMITS.volume`
shipped as `[1, 1]` for one commit — every reduction in the coach silently
became a no-op — and nothing failed.

**Advice written before the rails run must not survive them.** The plan is
assembled top-to-bottom but the rails decide last, so anything that prescribes
loaded work has to be reconsidered afterwards. Lines are tagged
(`CoachDecision.source`) and filtered: `load-advice` and `loaded-session` are
dropped outright when `loadPermission === 'none'`, `deload` when a rail turned
the day into something else, and the plateau line is composed *after* the rails
so it can defer instead of telling a sore athlete to train more (or to "keep
training normally" on a scheduled easy week). Three bugs of this shape were
found in the V2 review and three more on 2026-10-05 — found by printing the
plan for simulated athletes and reading it, which is worth repeating whenever a
decision is added.

### Evidence tiers

`docs/research-ledger.md` has four passes; §13 (2026-11) is the multi-skill
one, with its full reports under `docs/research/`. The second (2026-08-05) was
adversarially verified and its most important output is a **null result**:
nothing could be established about any competitor's actual mechanics from
public sources — every such claim failed 3-vote verification, almost all
because they were arguments from absence in marketing copy. Twenty refuted
claims are recorded there *by name* precisely because they are attractive
enough to be re-derived by accident. Read it before writing anything
comparative, and before quoting any pose-estimation accuracy figure.

When writing athlete-facing copy, keep these distinguishable:
STRONG (meta-analysis/RCT) · MODERATE · CONSENSUS (coaches agree, no trial) ·
INFERENCE (mechanics) · OPEN. Notably, **direct planche research is thin and
validates none of the app's specifics** (modelling, one acute EMG study, small
uncontrolled elite-rings interventions — ledger §11), so almost everything
progression-specific is CONSENSUS or INFERENCE and must not be phrased as
science. Do not write "there is no research": that narrow-search zero was
corrected in the 2026-10-05 audit. Likewise a nonsignificant result is "no
difference detected", never equivalence or "costs nothing". `docs/research-ledger.md` holds the sources and their tiers.

`src/lib/claims.test.ts` enforces the ledger's "must not claim" list on every
string the app can show (it parses string literals, templates and JSX text, not
comments). When it flags new copy, rewrite the copy. Loosen a rule only for a
sentence that genuinely denies the claim, and add that sentence to the test's
allowed list; the removed-sentences list must keep failing. Tips carry a
`basis` (`src/data/tips.ts`) that is shown beside them — a tip may not sound
more certain than its basis.

## The camera form judge (the part most work touches)

- `src/lib/poseForm.ts` — the verdict. `judgeTrackedFrames(input, exerciseId,
  {explain?})` is a **pure function**: detections in, verdict out. Everything
  DOM-ish (decode, model, rotation probe) lives above it in `analyseClipNow`.
  Pass `{explain: true}` to get the per-moment working (`result.explain`) —
  which frames convicted, envelope state, aggregate vs sustained faults.
- `src/lib/poseBackend.ts` — BlazePose (MediaPipe Tasks, primary) + MoveNet
  (fallback), normalized to shared joint names. Side-view gate:
  `apparentBodyWidthRatio` > `MAX_SIDE_VIEW_RATIO` (0.42) refuses the clip.
- `src/lib/poseSynth.ts` — skeletons built **from known angles** (signed elbow
  bend, `secondArm`, `armYawDeg` flare, `secondLeg`, foreshortening, AR(1)
  noise, roll). `IDEAL` holds a textbook rep per position. `PROPORTIONS` were
  measured off real BlazePose output — not an anatomy table.
- `src/lib/realPoses.fixture.ts` — real BlazePose landmarks from real photos,
  including negative controls that must be refused or never pass clean.
- `src/lib/realClips.fixture.ts` — whole real holds from an athlete's phone
  (shared via problem report, kept with permission; landmark numbers only, the
  14 joints the judge reads, no video or face points): a tuck filmed sideways
  under rotation lock, and the same athlete upright with a visibly bent elbow.
  Their truth was checked by drawing the landmarks over the original frames.
  To add one: replay the report's `poses` through `judgeTrackedFrames`, strip
  and round, and assert the stripped copy judges identically to the full one.
- `src/lib/formJudge.eval.test.ts` — the accuracy eval: every position × every
  fault × seeds, robustness, asymmetric arms, real photos.
- `src/lib/benchTools.ts` — `selfTestJudge()` (in-bundle accuracy smoke test)
  and `fixtureFromPoses()` (freeze a capture as a fixture).

### Non-negotiable invariants

1. **Thresholds are measured, not chosen.** Every tolerance in
   `MATERIAL_TOLERANCE`, every profile floor, `MIN_EXTENDED_LEG_REACH`,
   `SHRUG_MIN_RATIO` came from sweeping synthetic holds of known angle and
   from real-photo measurements. Do not retune against a single clip or a
   different assumed noise level without re-measuring (real landmark jitter is
   ~1.5–2% of torso, measured from real video).
2. **Scoring and accusing are different bars on purpose.** The 0–100 score
   deducts inside FIG-style bands well before a red fault is named; a fault
   additionally needs to clear measured camera error and persist (~1s
   sustained). They are not meant to agree.
3. **Refuse over guess.** Front-on clips are refused; thin coverage becomes
   `unseen`, never a silent pass or a confident accusation; elbows `unseen`
   blocks progression credit. When adding a criterion, wire it through
   `JudgedCriteria`/`CoverageCounts` like the others.
4. **Elbow bend is signed** (flexion moves the elbow toward the hips;
   hyperextension clamps to 180 = lockout). Near+far arms are **averaged**
   when the far arm is genuinely separate — worst-of was tried and it
   manufactured false accusations.
5. Two refuted "improvements" — median-smoothing metrics over time, and
   measuring lean along the torso axis — made accuracy worse. The reasons are
   documented inline; re-measure before resurrecting either.
6. **Evidence the camera did not have cannot become a pass** (2026-10 audit).
   The side-view gate runs per moment — a front-on moment is not measured, and
   a far side too faint for the precise bar is checked at the looser one, so a
   weaker prerequisite cannot flip a refusal into a pass. Filled-in joints
   (`Kp.origin`) are never bridged across more than `MAX_BRIDGE_SPAN_SEC`, and
   count toward coverage only while they are the minority. A seek that never
   delivers a decoded frame is a missing moment (`seekTo` returns `timeout`),
   never a pose labelled with the requested time. One arm's hyperextension
   cannot numerically cancel a resolved bend in the other.
7. **Persistence is roughly a second, in time.** `minimumBadSamplesFor(gap)`
   keeps three samples at normal spacing and two when the spacing alone exceeds
   the duration; sampling is three a second up to `MAX_SAMPLES`, and wider
   spacing is disclosed with the verdict. Bump `JUDGE_VERSION` whenever a
   verdict on the same detections can change — it is stored on every reading
   with the model id (the model URL is pinned to `float16/1`).
8. **The floor is where the body says it is** (judge v3). The camera screen
   asks for the phone on its side, and with rotation lock on the recording
   stays portrait with the scene lying sideways — a real clip read a level tuck
   as sagging and leaning backwards. `floorEdge` decides from the trunk (≥68°
   from the picture's horizontal = on its side; measured: upright never above
   61° across 3,780 synthetic stress holds, real turned frames 72–85°) and the
   arms (≥120° from the picture's down = upside down), then `turnUpright`
   rotates the *measured* landmarks; the replay track stays as recorded. The arm
   direction alone cannot decide this — synthetic overlap was 1°–97°.
   That is the *support* rule only. A hang's trunk is the thing being judged,
   so it cannot be the reference: the trunk rule turned a dead hang a quarter
   and certified it as a level lever, score 100 (first independent review).
   `readFloor` (judge v6) uses the plumb line from the hands to the centre of
   mass for a hang — weight above the hands is refused as not a hang — and
   judges a handstand only in an upright picture (arms within
   `INVERTED_ARM_SLACK_DEG` of picture-down), refusing anything else, because
   joint for joint a handstand turned over is someone standing with their arms
   up. Synthetic hangs are *balanced* (`SynthParams.balanced`): the wrist sits
   over the centre of mass, or the skeleton is one nothing could hang.
9. **"Clean" in the UI means camera-verified clean** (`verifiedCleanRatio`):
   `cleanRatio` is time before a sustained breakdown and stays the training-dose
   number (`trainingSetValue` caps on it — zeroing it would turn a 7s soft-elbow
   hold into 0s of training). But bent arms *inside* the window (`heldIssues`)
   mean none of it was verified clean, so trends, the coach's form signal and
   the result panel read 0 there.

9b. **Judge v8 (2026-11-21, Fitness Lab goal).** Three fixes, all pinned by
   decision: (a) a support hold's floor is also read from the plumb line —
   between `AMBIGUOUS_TRUNK_DEG` (45°) and `SIDEWAYS_TRUNK_DEG` the trunk alone
   took a hips-high tuck on a sideways phone for upright and read hips *above*
   the shoulders as a sag (−0.87 for +0.5); weight off to the side of the hands
   (`PLUMB_SIDEWAYS_RATIO`, measured 0.6 upright vs 0.88+ turned) turns it
   (`signConvention.test.ts` pins hip, lean and shrug in all four picture
   orientations and both facings). (b) `judgeTrackedFrames` judges only the
   hold (`lib/holdWindow.ts`): feet-down stretches before the lift and after
   the landing (`FEET_OFF_HOLDS`) and moving edges (`SETTLING_SPEED`) are
   trimmed by re-basing the input (`timeOffsetSec` carries the offset, so the
   replay stays aligned); nothing in the middle of a hold is ever cut, and the
   result's `holdWindow` says what was judged. (c) Straight-arm *support*
   elbows are measured from the athlete's lockout (`lib/lockout.ts`,
   `withLockout`): `JudgeInput.lockoutDeg` travels with the detections (absent
   = 180, which is what every synthetic eval uses), the app sends the
   calibration (Settings → Lockout calibration, `lockoutFromReadings`, refused
   under `MIN_LOCKOUT_DEG`) or `UNCALIBRATED_LOCKOUT_DEG` = 173 (named bar
   165°, the athlete's ask). Real soft elbows still never pass: named, or
   unseen when the readings scatter (`lockout.test.ts`).

## The coach

- `src/lib/athleteSynth.ts` — training histories built **from known truth**
  (which stimulus the body answers, gain rate, honesty of filming, layoffs).
  `simulateSeason` runs the loop *closed*: the coach's target shapes what the
  athlete logs, and that log is its next input.
- `src/lib/coach.eval.test.ts` — the accuracy/safety eval: responder
  identification for all five strategies, pain-day rails, hard-limit sweeps,
  a 200+ athlete fuzz for placeholders/NaN/contradictions, degenerate
  histories, and season-long feedback behaviour.

### Things measured, not assumed

1. **A gain smears across the attribution window.** Sessions either side of the
   one that caused it collect near-identical credit (measured: 0.2475 each on a
   noiseless history). Under a *fixed* rotation the true cause is unidentifiable
   — that is the data, not a bug. The real bandit varies its order, and then the
   responder is found every time. `pickStrategy` therefore refuses to claim
   "your fastest gains" when the lead is under 0.5s/week.
2. **An easy week counts by its load, not its name.** `weeksSinceDeload` once
   reset only for a workout called "Deload Flow" and otherwise counted from the
   first session ever — so past five weeks anyone who backed off their own way
   got a *permanent* deload. The calendar is now walked so a week with no
   sessions counts too.
3. **The working target assumes the top set reflects capacity.** It is a
   fraction of recent session bests, so an athlete who never exceeds the number
   they were given makes the log echo the target back and it compounds
   downward. The `to-target` compliance mode in `simulateSeason` pins this.
   `completedBaseTarget` stops the fall, but only a measured max moves the
   target *up* (the hit-rate nudge applies to a base that never absorbs it,
   and at short targets it rounds away). The re-test was once only a
   suggestion beside a separate Max test button, and an athlete who never
   took it held 5s of lean for twelve weeks while the simulated hold grew from
   8s to 30s. A due re-test is now `plan.queueRetest`: one max clean hold at
   the bar, first in the main work (the attempt block, its own note), and
   `measuredMaxIn` counts it — like an unlock attempt — on the re-test clock,
   which reads the *current* step only (the test that unlocked a step measured
   the old hold).
   The season eval asserts the obedient athlete's targets now climb. Set logs
   keep no role, so `isBarAttempt` (a key hold targeted at the bar) is how a
   max effort is told from a working set: the hit rate skips them — it once
   read a max test's attempts as misses, and every test was followed by "most
   sets fell short — easing the target back". The working target lives in
   `lib/workingTarget.ts` (`adaptiveTarget`, `workingTarget`), shared by the
   session and the coach, so the nudge line quotes the real whole seconds —
   and names the capacity cap when that is what held the target (for a
   to-target athlete the longest hold on record *is* the last target).
   Accessory reps echo the same way — the rep screen starts at the target —
   so the pressing trend reads only sessions whose best set went past or fell
   short of its target; a run of exact hits is "unknown", never "flat".
4. **Noise is spread around the trend, not around the median.** `sig.noisy`
   once used MAD/median of the last six bests, so a steady 6→17.5s climb read
   as ±25% "noise": targets froze and the earned unlock attempt was withheld —
   from fast-improving beginners above all. `spreadAroundTrend` measures
   residuals from a Theil–Sen line; scrambling the same values is still noisy
   (`v2.test.ts`, "a fast, steady climb is progress, not noise").
5. **A rate over a window divides by the time actually trained.** Chronic load
   and `sessionsPerWeek` both once divided by a flat 28 days, so a fortnight-old
   athlete at 3/week read as 1.5/week. Any new per-week signal must do the same
   (`Math.min(window, timeSinceFirstSession)`), or new athletes inherit a deficit.
6. **A hold stopped at its call is a floor, everywhere** (2026-11 second
   review). `sessionLearningPoint` marks a session's value a floor when the
   set that set it was `stoppedAtTarget` — reached its target and was not
   meaningfully passed, unless the athlete said balance/technique/effort ended
   it; a later set falling short does not turn the best one into a
   measurement. `LearningPoint.cappedAt` and the verified series' `floor`
   carry it. Readers that need a measurement read measured points only:
   noise, trend and outliers (`signals`), the plateau and breakthrough
   (`measuredSeries`), the forecast (whose `need` then says so), the
   capability jump, the strategy reward (measured sessions, baseline within
   `PRIOR_WINDOW_DAYS`) and the debrief's "clean hold grew". Readers that need
   a level raise floors to `measuredLevel` — the latest measurement, or the
   median of the last three when that is higher (a high reading corrects itself
   through missed targets; a low one never does for an athlete who stops at the
   call) — in `adaptiveTarget`, and `capacityOn` keeps it beside its last six.
   `sessionTargetCap` (done as prescribed, for `completedBaseTarget`) is a
   different question and ignores the end reason. Found by running the real
   loop (`closedLoop.eval.test.ts`): targets vary by strategy (0.7×–1.25×), so a
   noise-free athlete gaining every session read "going backwards" for weeks,
   one re-test kept technique running nine sessions, the capacity cap fell to
   2s targets at a true 10s, and they never left the straddle. The eval has a
   slow athlete whose next shape stays out of reach for weeks, because the fast
   one promotes before most of these bugs can show; all six parts of the fix
   were mutation-checked against it. Fixtures that mean "a measured best" say
   so with `endReason: 'effort'` — a hold logged at its own target with no
   reason reads as stopped at the call.
   An independent review of that commit found twelve more, all now pinned in
   audit.test ("found by a review of the floor rule") and mutation-checked one
   by one: **noise must never block the in-session re-test** (it blocked the
   only thing that adds a measurement, so stale scatter meant "noisy" for
   good — the standalone max-test suggestion still waits it out); the spread
   and trend read measurements from the 56 days before the *latest
   measurement*, not the clock (sparse trainers keep their context);
   `measuredLevel(points, asOf)` counts only `MEASUREMENT_FRESH_DAYS` (42)
   before the newest session in `capacityOn`/`adaptiveTarget`; a session
   with a bar attempt is measured by its non-floor sets (`calledAtTarget`
   lifts a failed working set to its target when the walk overlaps the call,
   and those lifted floors had outranked the re-test); `stoppedAtTarget` reads
   the band on `trainingSetValue`, lets a trusted camera breakdown win over
   any stop (read from the camera's own `cleanSeconds` — the stopwatch, net
   of a walk allowance, reads short for a quick walker); `capacityReading`
   does not lift a hold the athlete said ended at their limit; the verified
   series reads the weaker side and the camera's own credit;
   `workingCeiling` keeps working targets a second short of the bar so
   `isBarAttempt` stays true to its name; the measured-lift line needs a
   measurement newer than `sig.lastWorkingTargetAt`; and the floors copy
   needs `mostlyFloors`.
   Then the closed loop got athletes who train like people (`Realism`:
   day-to-day swing, later sets harder, a walk that is not the assumed 5s,
   some sets filmed — logged through `stoppedAtTargetCall` like the player).
   A 7s walker down at the call logs ~2s over with no call flag, so the stop
   band (`stopBandSec`, shared with `completedAtTarget`) widens by the walk the
   *assumed* 5s may have missed — never for a measured walk, which is the
   slowest of three; without it that athlete never left the tuck and was told
   "going backwards" for fifteen weeks. The camera decides over any band or
   flag (`cameraMeasured`): clean time certified well past the call, or a
   breakdown *seen* inside what it analysed (`cleanRatio` < 0.98, not footage
   that ran out). It analyses only the credited stretch — up to the target for
   a call-stopped hold (SessionPlayer `analysedSec`) — so it can never see
   more than that; the loop's simulated camera mirrors this, and an earlier
   fixture that let it see past the window described an impossible hold.
   `capacityReading` never lifts a video-timed or edited hold, and set-to-set
   advice stops at `setToSetCeiling` like every working target.
   Camera time is hold time (`cleanHoldSec` adds `recordingOffsetSec` for a
   stopwatch hold), and only a *seen* breakdown bounds a hold
   (`sawBreakdown`: the judge's `cleanRatio`, which is over the filmed part of
   the requested window, so footage that ran out is never one) — in
   `capacityReading`, `cameraMeasured` and `completedAtTarget` alike. A
   measured walk is recorded (`timing.walkMeasured`) so a 5.0s measurement is
   not mistaken for the assumed walk. Trends and noise read camera points
   alone once three are in the window (`LearningPoint.camera`), like surfaces.
   Known limit, from a 45-athlete sweep: slow gainers (~0.45s/week) with an
   unmeasured walk still get a few "flat — no visible cause" days, because
   working-set failures happen on bad days and the gain is inside the day
   swing. That verdict changes nothing in the plan; measuring the walk shrinks
   it. Redesigning the plateau test to need statistical support was judged
   riskier than the hedged copy. All five realistic
   athletes are pinned (no noise or plateau days, at least two steps up);
   their seeds matter, so re-measure rather than loosen if one moves. A
   realistic athlete who never films stayed at the tuck for sixty sessions
   with 23s max holds on a 20s bar and was never told why (unlock attempts
   queue only from verified holds); the plan now says so whenever the fresh
   stopwatch level (fresh against *today*) reaches 85% of the bar and the
   verified best has not — asking whether the max holds were filmed, not
   whether anything was, worded for the frog stand's replay review, and
   tagged `loaded-session` so a no-load day drops it.

## Camera lifecycle

`src/lib/recorder.test.tsx` drives `useFormRecorder` against a simulated
device (`// @vitest-environment jsdom`, fake `getUserMedia`/`MediaRecorder`).
It exists because the real thing needs hardware and every earlier audit could
only *read* it. The assertions are about tracks, not pixels: every stream this
app opens must be stopped on every exit path (release, unmount, lens change,
denial) and a retired request must never strand or overwrite a live one —
those are the failures that leave the camera indicator burning. Verified to
have teeth by mutation: deleting `stopStream()` from `teardown` fails four of
them. Real-hardware behaviour is still unproven.

## Check this phone (device behaviour no test here can reach)

Settings → Check this phone (`components/DeviceCheck.tsx`, `lib/deviceCheck.ts`)
runs, on the athlete's own device, what a session relies on: the target chime,
the spoken call, the back camera (preview stopped on every exit — tested like
the recorder), the wake lock and the share sheet. The result is per device
(`planchelab.deviceCheck`), travels in every problem report
(`ProblemReportRuntime.deviceCheck`), and "Copy result" gives a pasteable
summary. iOS context it guards: audio and speech start only from a gesture
(`installAudioUnlock`), the silent switch mutes Web Audio
(`soundThroughSilent`, audio session "playback"), and home-screen apps before
iOS 18.4 refused wake locks. None of it has been verified on a physical iPhone
from this repo — the check exists so the athlete can.

`lib/install.ts` says whether the app is installed. It matters because the
history *is* the browser's storage: Safari clears a site's script-written
storage after about a week of use in which the site was not opened, and a
Home Screen app is exempt — but it also starts **empty** (it does not share
the tab's storage), so the guidance is export → Add to Home Screen → “I have
a backup file” on the first screen (`Onboarding`'s restore path, the same
validation as Settings → Import). Never tell an athlete their data moves
across on its own. The PNG icons come from `scripts/make-icons.mjs`.

## Testing tools

- `#devlab` (linked from Settings → About and the Learn guide "How the camera
  judge works") — the bench: synthetic scenario sliders with ground-truth vs
  measured, real file/URL analysis, a one-tap self-test, and the automation
  API on `window.__planche`. Start with `window.__planche.help`.
- For real photos in an automated browser: `commons.wikimedia.org` blocks
  CORS; resolve direct `upload.wikimedia.org` URLs via the Commons API with
  `origin=*`, and send a User-Agent when downloading outside the browser.

## Data and session contracts (2026-10 audit)

- **Every workout starts from a `WorkoutRequest`** through `finalizeWorkout`
  (or `finalizeFromPlan` for a screen previewing many). Views never build a
  workout to start; a re-plan after a check-in rebuilds from `requestFor(w)`, so
  a 15-minute version stays one. `plan.challengeAllowed` is the only gate for a
  max test or a queued unlock attempt — nothing may recreate one after it. It
  is false on every lighter `dayType` (technique, deload, recovery) as well as
  on pain and low energy: it once asked only about those two, so a second max
  test was offered right after the first, on a scheduled easy week.
  `challengeBlockedReason` names which, and a scaled template says why
  (`restrictTemplate`) — "low energy" only when the athlete said so.
- **Joint reports are a timeline** (`state.symptoms`, read through
  `readinessTimeline`): onboarding answers, check-ins (recorded the moment they
  are given, so a discarded session cannot lose one) and mid-session reports.
  Future-dated reports are ignored; a correction withdraws, it is not recovery
  (UI: Undo on a mid-set report, and Settings → Joint reports; the strategy
  reward honours corrections too).
- **Attempts keep their provenance.** `SetLog.raw` survives edits and
  interruptions; `timing.method` says stopwatch / interrupted / edited / video
  (a `video` hold's value is the interval marked on its clip — no allowance is
  taken off it, and the form check analyses exactly that stretch via
  `windowStartSec` / `PoseTrack.offsetSec`);
  `endReason` and `assist` are optional and absent means unknown. Assisted or
  import-repaired sets never qualify; endings the athlete called an
  interruption or timing problem are kept out of the working dose.
- **A session's end is when training ended** (`endedAt`, stamped as the
  summary opens); `savedAt` is separate, and `completion: 'partial'` marks
  skipped or unstarted work. Every unsaved exit goes through one
  save / discard / keep prompt.
- **The store converges.** Every change bumps `rev`; deletions leave
  tombstones; settings/profile merge per field (`fieldTimes`); a reset, import
  or sample load starts a new `epoch`, and a tab holding a retired epoch cannot
  merge back. `IMPORT_REPLACE` refuses a stale `expectedRev`. Unreadable saved
  data is quarantined byte for byte and writes are held until the athlete
  chooses. Reset retires the epoch first, then `eraseRecoveryCopies`.
- **The recorder reports capture, not intent**: `off | starting | live |
  recording | denied | unavailable | busy | unsupported`. `start()` records
  only from a live stream — it never opens a camera mid-hold — and every
  recording owns its own chunk buffer.

## Sessions, the bridge and judge v4 (2026-11 upgrade)

- **Every generated session has one shape** (`todaysSession`): warm-up →
  next-shape attempts (when the bridge is open) → key hold → transition drill →
  the step's push-up version (`role: 'press'`, `data/pressing.ts`) → pressing
  accessory (PPPU, or pike when the press already is one) → straight-arm work
  (leans from the frog stand up; scap push-ups below) → core → cooldown. Blocks
  carry a `role`; `fitToBudget` trims by role — goal mobility and generic core
  first, accessory sets to two before any strength block goes, the push-up
  version last among accessories, main sets only after every accessory — and
  returns what it dropped, which the session states. Notes about a block that
  was trimmed away are dropped with it (`about` arrays).
- **The press trails the hold** until the hold reaches half its bar
  (`PRESS_AT_LEVEL_SHARE`), steps down the ladder for missing kit, and steps
  down to the PPPU on a `loadPermission === 'reduced'` day.
- **Accessories use double progression** (`accessoryProgression`): every set at
  target → +1 rep / +10%; at least half → repeat; most short → what was
  achieved. It replaced "60% of recent bests", which ratcheted a completed
  dose downward each session. Placement answers may still only *lower* a
  default when nothing is logged. A swap to an easier version
  (`capacityAdjustBlocks`) must be able to end: the swap is why the harder
  movement is never logged, so it once re-read the setup answer forever —
  every push-up answer under "20 or more" kept a lean-step athlete off PPPUs
  for good. `READ_FROM_EASIER` reads the harder movement from the easier one's
  log (push-ups ÷3 for a PPPU, knee push-ups ÷2, tuck hollow ÷2 — cautious
  conventions) once that says more than the answer did, and the swap note
  names the number that moves it back up.
- **The key hold aims at about a minute of practice** (`KEY_HOLD_AGGREGATE_SEC`,
  3–6 sets, counted on the day's base target so the strategy's set delta keeps
  its meaning; fatigue days take `LIGHT_DOSE_SHARE` of it). Sources: Lum &
  Barbosa 2019 (ledger §1 — 30–90 s a session for strength, MODERATE for
  isometrics, INFERENCE for the planche) and Sommer's steady-state cycle via
  Antranik (CONSENSUS, ledger §12). The sets
  above the old fixed count are `Block.reach`, and `fitToBudget` gives them up
  before any strength block — the user asked for the press and leans at every
  level — while the kept dose still goes last.
- **Short holds get more sets** (`mainHoldSets`) and slightly shorter rest
  (`restAfterHold`, floor 90s). Per-side key holds start a set lighter.
- **Easy days keep the session's shape.** Why the day is easy decides what
  eases: a fatigue day (`dayType` technique or deload) keeps the press (never
  a planche push-up), leans and core at `LIGHT_DOSE_SHARE` of the dose
  capacity chose, inside a 30-minute cap. Those blocks are `light`, their sets
  are logged `light`, and light sets never move `accessoryProgression` or
  set-to-set targets (`adjustsSetToSet`). A form-repair day (strategy
  technique on a push/build day) eases only the key hold — the limiter's work
  *is* the repair; easy days once dropped every lean and press, so the lockout
  leans never reached the soft-elbow athletes they were built for. A second
  loaded session on the same day stays skill only. The old test pinned
  `strategy`/`dayType` by hand and missed this; assert on `buildPlan`'s plan.
- **The walk-back allowance can be measured** (`Settings.walkBackSec`,
  Settings → Measure my walk): the slowest of three timed walks from the hold
  position to the phone, clamped `WALK_BACK_MIN_SEC`–`WALK_BACK_MAX_SEC`,
  replaces the assumed 5s for main Path holds — both ways. It is a
  measurement, not the "dial that enlarges your records" the
  `stopLatencySecondsFor` comment warns about, and a filmed hold's credit is
  still capped by the verified stretch. The beep (`signalTone`, primed by the
  starting tap) plays with sounds off. Unmeasured athletes keep the 5s.
- **In-hold cues follow time held** (`holdCues`): the target call, spoken
  counts and ring use the stopwatch since Go; the stop allowance comes off the
  logged value only. The cues once used credited time, written for a reaction
  delay of tenths — the 5s walk-back allowance then made every target call five
  seconds late for a phone across the room (working sets ran to the max). The
  PR buzz stays on credited time, so walking is never celebrated. Once holds
  stop at the call, the fixed allowance lands logs at target ± (walk − 5s), so
  a hold stopped within the allowance of its call is recorded `calledAtTarget`
  and read as reaching the target by `sessionTargetCap`, the hit rate,
  set-to-set advice, accessory progression and — at the source —
  `sessionLearningValue` (so `capacityOn`'s target cap sees it too), unless
  trusted camera evidence saw an earlier breakdown. Without it a compliant
  athlete who walks back faster than the allowance ratchets down session after
  session (pinned in holdCues.test, with the capacity cap modelled). The
  timer runs on through the walk, so the call can sound after an athlete who
  failed is already down: flagging is limited to working sets and accessories
  (`callMarksCompliance` — never attempts, bridge, tests or the minimum dose),
  a call-stopped hold that logged 0 still counts, and a filmed one is checked
  up to its target so a confirmed camera reading decides (`capacityReading`).
  A warm-up primer is never the in-session best, and "PR secured — exit under
  control" (and its buzz) waits for the target — it once preempted it.
  The exception is a bar the *logged* value must clear — an unlock attempt
  (`role: 'attempt'`) or a max test: there `holdCues(…, banking = true)` calls
  on credited time and the ring fills on `towardSec`, so coming down at the
  call clears the bar after the walk. On time held, a 3s walker logged 18s of
  a 20s bar they had held.
- **The minimum dose** (request source / workout kind `micro`,
  `microDoseWorkout`): a short warm-up and five ~3s maximal holds at the
  hardest clean shape (the next shape when the bridge is open). Gated by
  `microBlockedReason` — the max-test gate plus no lighter day, no form repair,
  nothing loaded today, once a day. It is extra: `sessionLearningValue`, the
  hit-rate and frequency signals and the weekly goal all skip `micro` sessions,
  its targets never move set to set, and it sets no records (a record is the
  capacity fallback for an athlete with no history — found by running a fresh
  athlete through the app).
- **Set-to-set targets** (`lib/autoregulate.ts`) are *derived*, not stored:
  the player keeps which logs belong to which block (`blockLogAts`, persisted
  in the draft) and recomputes the next target from them, so edits, ratings
  and "interrupted" end reasons feed back. Logs record the target actually
  given. Never for warm-ups, cooldowns, attempts (unlock *and* bridge), tests
  or per-side blocks — an attempt has no `calledAtTarget`, so a quick walk
  back under the 5s allowance read as a short hold and cut the opener.
- **The bridge** (`lib/bridge.ts`): at half the current bar (from day one at
  the lean) sessions open with short attempts at the next step's key hold —
  section `main`, `role: 'bridge'`, so they are filmed and judged — only when
  `plan.challengeAllowed`, never beside an unlock attempt, never on easy days.
  They are attempts, sized like one: the target is the next shape's
  `startSec` (its early-promotion hold), held as long as it stays clean, the
  call on credited time (`holdCues` banking). Sized at 70% of the best recent
  attempt, an athlete who came down at each call was walked from 2s to 1s for
  good. A due re-test displaces them for a day; a skipped one
  (`Session.retestOffered` with no bar attempt) backs off for a week so it
  cannot displace them every session. **Early promotion** (`earlyPromotionEarned`, used by `applySession`): the next
  shape's `startSec` held with the full evidence chain while the current step
  is verified past half its bar opens the next step (`events.unlockedVia`).
  Deterministic from history like every other unlock.
- **Judge v4** (`JUDGE_VERSION = 4`): `sustainedSofteningStart` (pooled 1.5s
  windows, 13° bar, 1s persistence, locked-before rule — swept to zero false
  accusations at 2% noise in 1,800 holds); a "hyperextension" past
  `MAX_PLAUSIBLE_HYPEREXTENSION_DEG` is read as flexion; joints outside the
  picture are unobserved; a bent near arm is graded alone, a far arm that alone
  reads bent leaves elbows unjudged unless the average already names it;
  `coverage` is the share of the *verified window's* requested moments seen in
  full; steadiness is `drift` — the robust spread of hand-relative shoulder and
  hip positions (camera motion cancels; `wobble` is legacy and no longer
  written). Never say why the body moved.
- **The footage must cover the hold**: a recording shorter than its credited
  hold is judged for what it filmed and says so (`unfilmedSec`, persisted);
  under a second of footage is refused. The unfilmed tail is never verified
  and never taken off the training dose (`trainingSetValue`). Found end to end
  with a fake camera whose static canvas made a 0.015s clip of a 2.9s hold.
- **One clean-time contract**: `cleanEvidence(auto)` is verified / fault /
  unknown. Unjudged elbows or coverage below `MIN_VERIFIED_COVERAGE` are
  unknown — never zero, never verified — and block progression credit. The
  "Verified clean" subscore uses the same rule; raw `cleanSeconds` stays the
  training dose.
- **Live elbow cue (beta, `settings.liveCues`, off by default)**:
  `lib/liveCue.ts` decides, `components/useLiveElbowCue.ts` reads the
  recorder's stream through a detached video element during a filmed hold.
  Same bar as a sustained momentary fault (every reading in ~1.2s beyond 16°,
  ≥3 readings, nothing in the first second), one cue per hold, never while
  `analysisInFlight()`. It only speaks; the verdict after the set is unchanged.
  Verified on the real model with a live canvas stream; not yet on a phone.
- **Credit is bound to the clip window** (`countedClipWindow`): progression
  credit is the overlap of the verified stretch and the hold's counted stretch,
  and a late reading whose start no longer matches the hold's
  (`readingFitsWindow`) is refused at every merge boundary.

## Five skills (2026-11, "Calisthenics Lab")

- **The skill of a state is the skill of its `stepId`.** `SkillId = planche |
  frontlever | handstand | ninety | flag`; step ids are unique across roads.
  The planche keeps the top-level fields — a save from before the upgrade is,
  unchanged, a planche-only athlete — and every other skill lives in
  `AppState.tracks[skill]`. `skillView(state, skill)` (`lib/skills.ts`)
  projects the athlete *as* one skill, so the coach, forecast, plateau, signals
  and form trends run on a view without knowing it; `wholeState(view)` recovers
  the rest. `profile.skills` is the priority order; a dropped skill keeps its
  track for when it is added back. State version 8.
- **A skill is a definition** (`data/skills/<skill>.ts`, `SkillDef`): steps,
  exercises, the session's shape per step (`program`), camera placement and
  honesty copy, prerequisites, safety, sourcing, each fault's limiter and
  prescription (`issues`), and optionally a rep ladder. `skillSession` builds
  any non-planche session from it; the planche's is still built by hand in
  `workouts.ts`. Screens print the definition's own sentences, and a skill's
  Learn guide is *generated* from it (`skillGuide`), so the two cannot drift —
  the handstand guide once promised a camera rep count the app does not have,
  because the sentence lived in one place and the decision in another.
- **Sessions record every skill.** `Session.skills[skill]` holds its step,
  strategy, `baseTargetSec` and `retestOffered`; `Session.roles[skill]` what
  its part was (`lead | partner | maintenance | practice`). The base target is
  kept for *every* role: without it a maintenance dose done exactly as asked
  came back 40% shorter each session (15s → 1s, simulated).
- **The line-up** (`lib/lineup.ts`). The first priority leads every session.
  `fullParts(minutes)` is 1 under 25 and 2 from there; `shortDoses(minutes)`
  is 0 under 30, 1 to 50, 2 beyond. The partner slot goes by days since a
  *full* part (`daysSinceFullPart`: led or partnered — a short dose keeps a
  position, it does not train it) × priority × a bonus for a different family
  (a pull beside a push) × joint overlap. A short dose goes to whoever has
  waited longest for any practice, weighted by the athlete's order — two sets
  (`maintenance`), or balance practice for a balance skill (`practice`).
  **Nothing outranks the athlete's order**: practice once rode along in every
  session, so the last-ranked handstand appeared in 30 of 30 sessions and the
  third priority in 7. A niggle named today (`niggleRegionsToday`) sends the
  second part and the short doses to skills that do not load the area. With
  one slot the skills take turns, the first priority at weight 2. All of it is
  CONSENSUS or the app's design (ledger §13.2) and the copy says so — and
  never promises a day (“later this week”) it cannot know.
- **A full part is its hold and the strength work behind it**
  (`data/mixedSession.ts`, `FILL`). Each part's key hold goes in at a floor;
  then the lead's moving version, its next-shape attempts, the partner's
  moving version and next-shape attempts; only then more sets of the holds,
  core, and the rest. When every hold went in first, a second skill's holds
  took the room its strength movement needed (front lever: a pull in 4 partner
  sessions of 13; flag: 0 of 7), and with next-shape attempts last it sat on
  its first step all season. A short dose that does not fit beside the two
  full parts is dropped whole and said. `finalizeFromPlan` hands back the
  line-up of the session it *built* (empty for the pain-safe one), and saved
  roles come from what was logged (`rolesTrained`), not what was planned.
- **One or two sessions are not a level, and floors never are** (`settled`,
  `toldHold`): until a step has three logged sessions *and* one of them is a
  measurement (not a hold stopped at its call), the placement answer for that
  exact hold stands beside them in `adaptiveTarget` and `capacityOn`. One 2s
  hold in a first session once became "the most they have shown" and the next
  session asked for five sets of one second; and an athlete who said ten
  seconds, then stopped every working set at its six-second call, had "shown
  six" — next-shape practice opened for two sessions and shut until the first
  re-test.
- **A bar attempt that fell short waits a week** (`BAR_ATTEMPT_SPACING_DAYS`,
  `signals.daysSinceFailedBarAttempt`): re-queued every session, a 30s
  wall-plank attempt ran five sessions running at 27–28s, taking the one
  maximal effort each time. A re-test is a bar attempt too. The app's own
  rule, and the decision line says so.
- **The first loaded session after a pain report is a step back**
  (`signals.returningFromPain`, 14 days): never a push day, target factor ≤ 1,
  volume ≤ 0.85, `challengeAllowed` false — whatever today's check-in says.
  One loaded session later the plan equals a never-hurt control. Both rules
  are pinned by decision in `returnRails.test.ts`.
- **The athlete's own week** (`lib/weekPlan.ts`, `settings.weekPlan`,
  `SET_WEEK_PLAN`). Each weekday can be given up to three skills in order, or
  marked rest; a day left out is the coach's. `todaysLineup` trains an
  assigned day as written (first leads, second partners, third a short dose;
  only the minutes can leave one out, and the reason says so) and falls back
  to the priority line-up on open and rest days. An explicit pick on the Train
  tab still outranks the plan. Saving a plan sets the weekly goal to its
  training days. Skills the athlete dropped or has no kit for are filtered at
  read time (`readDay` → `unavailable`), never trained because a plan names
  them. Copy says "your plan" — nothing about a schedule being best
  (`coverageNotes` is CONSENSUS and says so). The season eval runs twelve weeks
  on a Saturday-lever / Sunday-planche / Wednesday-both plan
  (`runSkillLoop({ trainOn, weekPlan })`).
- **One maximal effort a session** (`data/mixedSession.ts`, `effortSkill`):
  the lead's by default; when the lead held it last session and another skill
  has one queued, that skill takes today's. Only a max effort raises a target,
  so a skill that never leads must still get its turn.
- **Rep ladders** (`lib/repLadder.ts`): the handstand push-up and 90° push-up
  lines move on their own standards, derived by replay like every unlock.
  **The camera does not count reps.** The judge samples three moments a
  second; no source measured depth or lockout near that rate and the bottom of
  a two-second rep can fall between samples (ledger §13.8). So a rung's
  evidence is the frog stand's: a filmed set, rated Clean, that the athlete
  passes on the replay against the rung's `check` list (`RepReviewRow`), and
  `verifiedReps` credits nothing else. `rungInPlay` decides whether a rep set
  is worth filming — the current rung of an active skill, in real work — and a
  count raised after a review loses the review. Do not add a count without the
  sampling study the ledger names. **A rung can wait for a hold**
  (`RepRung.needsStep`): on the skill's own road, or on another's — the 90°
  push-up's last rungs start and finish in a handstand, so they wait for the
  handstand road. A placement answer does not open a gate: the line starts
  below the first closed one (`LadderStatus.placedPastGate`). It once started
  an athlete on a freestanding handstand push-up with no freestanding
  handstand.
- **Judge postures** (`Posture = support | hang | inverted | flag`, judge v6).
  The view gate, the floor rule and the elbow reading are per posture. A
  hanging, inverted or front-on elbow is read coarsely (`coarseElbow`,
  `POSTURE_TOLERANCE`, measured on real photos: hang 36° / 44° momentary,
  inverted 30° / 38°, flag 24° / 32°). **A coarse reading is not a pass for
  the arms**: the result carries `coarse: ['elbows']` (persisted on
  `AutoForm`, listed in `sanitizeAuto`), shows no "Straight arms" subscore
  unless a bend was named, calls the clean window "Shape held" rather than
  "Verified clean" (`cleanEvidence(...).armsUnmeasured`), and progression asks
  the athlete to confirm the lockout on the replay (`FormCheck.armsConfirmed`,
  `requiresArmsConfirmation` — one button with the flight confirmation,
  `athleteConfirmationLabel`). A test keeps `ARMS_PROMPT` in step with the
  coarse profiles. The flag is judged front-on
  (`MIN_FRONT_VIEW_RATIO`–`MAX_FRONT_VIEW_RATIO`, an oblique shot refused) and
  its floor comes from the wrist-to-wrist line; a hang's from the plumb line
  and a handstand only upright (invariant 8). An inverted hold is judged only
  when the body rises from shoulders to feet by `MIN_INVERTED_RISE_DEG` (judge
  v7; measured: floor planks and leans −13° to 14°, wall planks 36°+, real
  handstands 59°+) — a plank on the floor once passed clean as a wall plank.
  `skills.test` carries a judged synthetic clip through the stored reading to
  `progressionCredit` for every graded hold of the new skills: add a hold, and
  that test must cover it. `shoulderOpeningDeg` and `tiltDeg` are the handstand's and
  flag's own criteria. Review-only holds (`isReviewOnly`: frog stand, active
  hang, supported and vertical flag) carry `noChecks` profiles, and a test
  keeps the two lists in step.
- **Limits, said plainly.** Only one clean side-on real front-lever photo was
  found, so its thresholds sit well clear of it; the 90° hold has no real-photo
  fixture; straddle shapes show about 3% false "knees" at 2% noise; and the
  filming flow — hold and rep sets alike — has been driven end to end only
  with a simulated camera (a canvas stream behind `getUserMedia`), never a
  physical phone.
- **Fuzz.** `multiSkill.fuzz.test.ts` runs 120 seeded athletes nobody designed
  for — any skills in any order, any subset of the kit, ten to ninety minutes,
  any starting step — and holds every generated session to the same few
  rules: no movement that needs kit the athlete lacks, only trainable skills
  in the line-up, one maximal effort, the time asked for. It found the lone
  skill with no kit (a front lever, no bar) being handed a session named and
  purposed as lever practice over arm circles and a hollow hold; that session
  is now "waiting for kit" and says so (`skillSession`).
- **Evals.** `multiSkill.eval.test.ts` runs closed-loop seasons through
  `lib/skillLoop.ts` (each skill alone, three and five skills, 20-minute
  sessions) and `skills.test.ts` covers the registry, tracks, placement,
  ladders, line-up, guides, badges and tips. Both were mutation-checked; the
  seasons found four faults no unit test could (targets decaying to 1s, a
  re-test that never came, a third skill never trained in full, a second skill
  never trained in short sessions).

## Figures, the road and the share card (2026-11)

- `lib/figure.ts` builds every position's side view from body geometry:
  `PROPORTIONS` from poseSynth and each step's lean and hip/knee angles, so
  the pictogram is the shape the judge grades. With real proportions a hip at
  shoulder height hangs the knees within a few units of the floor, so flying
  shapes are drawn on parallettes (`bars`). `components/Figure` renders it;
  `tone="accent"` is for the one hero figure on a screen (its gradient is in
  user space — a bounding-box gradient draws nothing on a level limb).
- `lib/journey.ts` dates the road by replaying history from the same base as
  `rebuildDerivedState`: the session that opened each step, days and sessions
  per step. A step that was placed or jumped to has no date — never a guessed
  one.
- `lib/highlights.ts`: per step, the first filmed hold the camera could read
  and the best verified hold are pinned, exempt from the 30-day sweep. Pins
  are owned: only pins this made are removed (when a better hold replaces
  one), a pin set or cleared by hand is never touched again
  (`releaseMilestonePin`), and the launch sweep runs after the sync and only
  once history has loaded — a sync against a still-empty state would unpin
  every milestone and the sweep would delete them.
- `lib/shareCard.ts`: card data and copy are pure and tested; drawing reuses
  the figure geometry via `Path2D`. Only numbers the app already shows, each
  able to be absent (no verified hold → "—"). Made and shared on the device.

## The gym side (Fitness Lab, state v9)

- **Gym history lives beside the skill history, never inside it**
  (`AppState.gym`, `lib/gym/`). The skill coach, records, achievements and
  every eval replay `state.sessions` exactly as before; nothing on the gym
  side may write into it. `sanitizeGym` / `mergeGym` / `reduceGym`
  (`lib/gym/state.ts`) are wired into `normalizeStateWithReport`,
  `mergeExternalState` and the `GYM` action, with tombstones like sessions.
- **Loads are stored in kg**, with the unit they were typed in kept for
  display (`lib/gym/units.ts`). Steps come from the equipment in its own
  unit (`data/gym/catalog.ts`), overridable per location (`gear`).
- **Exercises are data** (`data/gym/exercises.ts`): pattern, primary (1 set)
  and secondary (half a set) muscles, equipment needs as any-of groups, joint
  stress, `technical`, `carries` (skills it builds toward — CONSENSUS).
- **Double progression** (`lib/gym/progression.ts`, CONSENSUS): a step up
  needs at least two working sets at the top of the range at the target
  effort; a first machine load is never guessed (machines differ between
  gyms) while free-weight estimates carry across locations; under 18 (or age
  unknown, `conservative`) ranges never go under 6 reps and jumps are one
  step. e1RM refuses past 12 total reps and for unloaded sets.
- `lib/gym/builder.ts` builds a gym session from slots by focus, fitted to
  minutes (last slots dropped first), steered by the planner: muscles off,
  joints to avoid, priority muscles (win their slot, +1 set), a volume factor
  for light days, goal-driven rep ranges, explosive work first for power.
- **The shared planner** (`lib/plan/`): `load.ts` counts gym sets, skill sets
  (by exercise category — an inference) and outside activities in the same
  muscles and joints; `planner.ts` `planToday` splits the minutes (skills
  first; skills' weight against the strongest gym goal, blocks never under
  15/20 min), applies the straight-arm rest rule per family
  (`lastHardStraightArm`, push = planche/90°, pull = lever/flag), steers the
  gym focus away from the family trained today and from tired or covered
  muscles (a leg activity in 48 h removes leg work), keeps reported joints out
  for 72 h, and calls deloads (`gymDeloadDue`, sooner under 18). Every choice
  adds a reason line; `skillGoalPace` returns `unknown` rather than a guess.
  Prefs and activities live in `state.gym` (`setPrefs`, `logActivity`).

- **Rules the review pinned (2026-11-22, gym.test / plan.test):** pain
  memory is the union of every non-good report in the last 72 h, never only
  the latest (knee is a `BodyRegion`); a load step needs logged effort on
  at least two top-of-range sets (or two unrated sessions in a row at the
  top, `unratedTwice`); any switched-off *primary* muscle keeps a
  movement out; under 18 by birth year means `year - birthYear <= 18`, and
  power/explosive ranges are 6–8 then (hard bodyweight movements,
  `isHardBodyweight`, are 4–6 slow reps under 18 and 3–6 over); a week under 70% of the usual volume
  ends a hard run; a stall needs an estimate in both weeks; `mergeGym` must
  return `local` itself when nothing changed (order-insensitive compare), or
  two tabs ping-pong; a new gym start never overwrites an open draft.
- Season and events: `prefs.season === 'in'` caps the gym at 0.7 of the
  sets; a leg-heavy activity logged for the next 36 h keeps legs out and the
  day at 0.8. Today's own sessions never trigger today's rest rule.

- **Second strict review (2026-11-22, scored 46 UX / 44 logic; all fixed,
  each pinned by decision and mutation-checked):**
  - Shared recovery (`load.ts` `familyEvents`): a skill session with 3+ main
    sets of a family, or a gym session with `HARD_GYM_FAMILY_SETS` pressing
    (push) or pulling (pull) working sets — and a planned push/upper or
    pull/upper gym day — is a hard family event. Events on different days sit
    `straightArmRestHours` apart in both directions; the same day may hold
    both (skill first). Only for families the athlete has a skill in.
  - Minutes are measured: `MIN_SKILL_MINUTES = {1: 18, 2: 25, 3: 30}` (what
    `finalizeWorkout` honours), `MIN_GYM_MINUTES = 20`; a day under 38 min
    gets one block. The builder fits strictly (`GymPlan.fits`), and a focus
    counts only when it builds 2+ items at the active place.
  - The planner reads `settings.weekPlan` (`readDay`): assigned days train as
    written, rest days rest. No place or no gym goals: no gym block. Without
    gym prefs, minutes come from `settings.sessionMinutes`, never
    `defaultPrefs`. Skill lines come from the built session (`skill.hard`).
  - The Gym tab plans today *as a gym day* through `gymToday(state, {now,
    minutes, focus, location})`: the same engine, so the season cap, sport
    legs (also on a rest day), deload, knee rule and the 72 h pain union hold
    for Auto and for a picked focus alike. Today's choice (kind and minutes,
    this calendar day only) lives in `lib/plan/todayChoice.ts` and every
    screen reads it; `lib/plan/screens.ts` (`trainingWeek`, `homeToday`) is
    what Home shows. Every `planToday`/`soreJoints` memo is keyed on
    `useToday`, so a screen left open past midnight re-plans.
  - `focusOpen`: a focus needs more than half its main muscles switched on.
  - A logged activity replaces a scheduled sport slot only when it is the
    same kind (or practice ↔ game). Weeks with fewer than `MIN_RATED_SETS`
    rated sets count as hard for the deload run.
  - `GymExercise.assisted`: the logged weight is help — progress takes it
    off; no e1RM, no heaviest record. Bodyweight-load e1RM is refused.
    `suggestLoad` reads the working load (the load most sets used).
  - `liftTrend`: no new best in `STALL_SESSIONS` (3) sessions, within 56
    days and current within 21, is a stall; the builder lends the slot to a
    same-pattern variation and says so (`GymPlan.notes`), never a favourite.
  - Speed and power climbs from the lowest unlogged rung. Youth swaps put
    `technical` lifts last; explosive movements swap only to explosive ones.
  - `mergeGym` merges ratings, favourites and hard-here marks per key by
    their own times (`ratingAtTime`, `favoriteAtTime`, `hardHereAt`), with
    removals kept. `doubtedLoad` (1.5× the best) asks before a set is saved;
    a saved gym session can be deleted or corrected (`correctSet`).
  - Onboarding is one flow: goals → skills → places → schedule → muscles →
    age and safety (`summariseSchedule` derives the weekly goal and minutes).
  - **One main session a day** (the athlete's ask): `TodayPlan.kind` is
    `calisthenics | gym | rest`, chosen by the week engine (goal share,
    family targets, pairing a family's gym day with its skill, sport, sets).
    A gym day may carry an opener (`skill.opener`, `OPENER_MINUTES` = 18):
    `gymOpener(state, focus, location, now, minutes)` — push focus → push
    skill, pull → pull, upper → either; never lower/full/athletic; only with
    the rest rule, no sore family joint, no pain, the kit at the place and in
    the profile, and 38+ minutes. `minutes` there is the whole session. The
    Today card, Home and the Gym side start the opener as an ordinary
    one-skill session and the lifts follow through `rememberNextBlock`.
    "Today's calisthenics" on Train and Home is the calisthenics day's block
    only — never a gym day's opener.
  - Third review round (58 UX / 53 logic), fixed and pinned in
    `plan/round2.test.ts`, `gym/round2.test.ts`, `data/youthWarmup.test.ts`:
    kit at a place is its own list plus the athlete's *portable* kit
    (`PORTABLE_KIT`), and `WorkoutRequest.kit` is the kit for that one
    build — it *replaces* the profile's list, floor always kept
    (`withRequestKit`); no opener after a hard session of the family earlier
    the same day, and planned family days hold; calisthenics days only for
    skills with kit; the weekly goal spreads open days; the RPE-9 deload is
    decided at the week's start; same-calendar-day sport keeps legs out;
    rest between *planned* days counts calendar days (`apart`), logged ones
    real hours. Youth warm-up (`data/youthWarmup.ts`): under 18 or age
    unknown, straight-arm skills get a longer warm-up, forced on — the evals'
    athletes are adults (`birthYear: 1990`) so they measure the standard
    session. Holds count seconds (`count: 'seconds'`, `countUnit`,
    `longestHold`); wrists are tagged on free-weight and bodyweight presses,
    dips, push-ups and curls; a loaded lift is never logged at 0 kg
    (`isUnloadedSet`); prefs merge per field (`TrainingPrefs.fieldTimes`);
    the gym player makes the app behind it inert (`useInertBackground`).
  - Fourth review round (52 UX / 60 logic), fixed and pinned in
    `plan/round3.test.ts`, `gym/review4.test.ts`, `onboardingFlow.test.ts`:
    `buildGymSession` fits the normal session first, then a factor below 1
    cuts the total working sets to about factor × normal (sets go to 1 before
    lifts go) and above 1 adds a set per lift while it fits
    (`setsForFactor`; `warmUpMin`, 2 after an opener). A lighter week the
    plan called ends the hard run whatever its sets. Time away: a last
    performance over 28 days never steps up, over 42 steps down, and the
    first gym session after 21+ days keeps at most 0.8 of the sets. A picked
    skill day inside the rest rule is named (hours and rule) and still
    builds. Openers are `OPENER_MINUTES` (18) under 60-minute days and
    `LONG_OPENER_MINUTES` (25) from 60. `maxCountFor` keeps holds to 3600 s
    and reps to 1000; `toggleHardHere` no longer stamps the place; swaps and
    additions keep the day (`GymDraft.volumeFactor`/`goals`, `dayOfItem`);
    `usePlanClock` re-plans open screens every 15 minutes; onboarding moves
    the goal past the placement (`goalPastPlacement`).
  - Fifth review round (54 UX / 46 logic), fixed and pinned in
    `plan/round4.test.ts`, `gym/review5.test.ts`, `progressTotals.test.ts`,
    `sessionSummary.test.ts`, `firstSessionTarget.test.ts`: `decide()` makes
    the coach's own call first and a pick only overrides it when they differ
    (a forced gym keeps the coach's pairing), so `planToday`, `{kind:'gym'}`
    and `gymToday` agree. Skill days credit muscles from the session they
    build (`builtSkill`); after the week is planned each gym day is steered —
    a muscle past `STEER_LINE` (1.3×) of its weekly top is kept out while the
    focus still builds, and the two furthest under go in as `priority`
    (carried on `TodayPlan.gym`, `GymToday`, `GymPreset`). Known limit: side
    delts still land short in short weeks (one priority set; isolation trims
    first). `shortVersion` routes Home's 15/20-minute buttons through the
    coach. Calisthenics is built with the athlete's kit plus the kit where
    they are (`placeKit`, `atActivePlace`). A new joint at the lifts' pain
    check re-plans through `gymToday`. `dayFinished`/`trainedToday`: a done
    main session ends the day's recommendations and the max test.
    `insideRest` allows an hour across a clock change; `LIFT_DROP` (5%) calls
    a lighter week; `NEXT_BLOCK_HOURS` (8) outlives midnight. Data:
    `mergeGym` never leaves zero places; free-weight time away reads the
    lift's latest session at any place; sets carry `editedAt` and
    `mergeSession` merges per set; `cycleMuscleState` advances from the
    stored state. Progress counts through `progressTotals` (working sets,
    skill hold time as the week tile counts it, one history of both kinds).
    The summary reads `summaryLastSet`, warm-up and cooldown holds take no
    stop allowance (`stopAllowanceFor`), and the 12 s → 1 s first-session drop
    was correct by the rules (no told hold): the copy now says so. The
    session player is portalled and makes the app inert; toasts are
    portalled beside it.
  - Sixth review round (52 UX / 47 logic) — **the first priority is
    protected** (the athlete: "make sure I won't lose my planche progress,
    stuff too spread out"). `reserveExposures` reserves every day its rest
    rule allows (a planche-only athlete's days); each exposure carries the key
    hold's kept dose (`keepsDose`; an opener short of it is `half`, counts ½);
    at most one first-priority opener a week (`openerAllowed`), 25 minutes
    from 45-minute days (`openerMinutesFor`); a partner stays only while the
    lead keeps its alone-dose (`exposureParts`), and `mixedSession` fills the
    first priority's key hold to its full time before the partner's extras.
    `plan/wholeAthlete.eval.test.ts` (helper `wholeAthleteLoop.ts`) pins it
    against a planche-only control on the same days — key-hold sets 89%
    default, 95% at 72 h, 89% Sun/Tue/Thu, 88% with Home active; re-measure,
    never loosen. Re-tests read `Signals.skillRestDays` (identical to
    `restDays` for a planche-only athlete). A niggle moves the lead
    (`niggleOrder`). `WorkoutRequest.insideRest` steps a picked day back.
    Logged rest counts calendar days with a `REST_SLACK_HOURS` (12) floor;
    today plans from the state as the day began (`asTodayBegan`), so
    following the plan never re-plans it. Steering is `TodayPlan.gym.spare`
    (which movements), never `musclesOff`; the day's named pattern keeps 2
    sets. One-skill days take turns (`turnOf`). Gym days carry
    `TodayPlan.gym.placeId`; legs get the week's last sport-free day every
    other week (`LEG_DAY_EVERY_DAYS`). Screens: `dayStage` (open /
    lifts-next / done, day marks in nextBlock); holds show the timer beside
    the counted value (`countedNote`); `youthCeiling` caps an under-18 jump
    across units; one gym sheet at a time (`askStillApplies`). Pinned in
    `plan/round5.test.ts`, `round5skills.test.ts`, `plan/review6.test.ts`,
    `gym/review6.test.ts`, `gym/loadAsk.test.ts`.
  - Round six, part two (2026-11-23). **Light pressing beside the
    planche**: `weeklyPress` keeps one gym chest press a week for an athlete
    with a push skill, gym goals and the chest on. A pressing day near a
    planche day is light (`TodayPlan.gym.lightPress`): `LIGHT_PRESS_SPARE`
    (front delts, triceps — every press, dip and shoulder press leans on one)
    travels in `gym.spare`, so the named press keeps two sets and the day
    stays under `HARD_GYM_FAMILY_SETS`; a light day is never a push event.
    Light choices are offered only to a week with no gym pressing, only on a
    gym day with a calm choice of its own (the rule never changes a day's
    kind), anchored on a hinted day (unhinted days can flip kind later in the
    week); pressing logged this week satisfies it. **An explicit time is the
    budget** (`sessionBudget`, `MAX_REQUEST_MINUTES` = 120, 30 on a light
    day): it once only shortened a session, so a planned 60-minute day built
    the setup answer's 45. "Short" is still measured against the usual
    length. **Screens build where the plan has it**: a gym day at its planned
    place (`resolveGymPlace`; Home being active is not a pick), a calisthenics
    day with the plan's kit (`calisthenicsRequest`, `atPlanPlace`); the
    athlete's place for today is `TodayChoice.placeId`; every lifts build
    passes `steerInput` (priority and spare) — dropping `spare` turns a light
    day hard. Pinned in `plan/round5b.test.ts`, `plan/screens.place.test.ts`
    and the eval's `expectWeeklyPressing`. Measured against the control:
    planche key-hold sets 0.947 default, 0.947 at 72 h, 0.895 Sun/Tue/Thu,
    0.912 with Home active. The longer budget costs the lever two partner
    parts late in the default run (advanced tuck 11-30 → 12-05) because the
    stronger planche needs its dose first — the first-priority rule working.
  - Seventh review round (62 UX / 55 logic; the logic loop had the planche
    at 91% of the control, so this round was the other skills and the gym).
    **HSPU pressing is heavy pressing**: `load.ts` `HARD_PRESSES` (from the
    wall negative up, read off the ladder's own data; pikes excluded) count
    with the push family (`restFamilyOf`, 3 sets, `press: true` events), the
    planner never puts a hard HSPU session on a push-rest day, and
    `insideRestRule` names it; the handstand hold stays balance. Ladder
    rungs are credited like the gym's version (`pressLoading`: front delts
    and triceps, never chest — INFERENCE). **The gym focus sees the planned
    week** (`allocate` counts planned calisthenics days up front; `spent()`
    keeps a focus whose main muscles are past the steer line from being
    chosen while another fills the day — a planche opener day can be upper),
    light pressing is not offered when a later gym day opens with a push
    skill (`heavierLater`), the athlete's priorities are never in the steer's
    spare list (`PAIR_HELD` keeps the light pair off non-light days), and the
    builder fills long days (fill after the fit: priority, then the focus's
    own unspared muscles, then the rest; push days add only pressing, pull
    only pulling, full/lower neither; ≤10 sets a muscle, ≤30 a session, the
    app's own ceiling) while `priority` beats every spare but the light pair.
    **One pain memory**: `standingReport` keeps the latest non-good report
    current for the lifts as the coach does, and the gym's "Nothing hurts"
    records an all-good check-in when a joint is still held. **Gym-only
    skills** move to the gym in an end-of-week pass of `planSkills` (a skill
    with no lead or partner part that week takes the partner or short slot
    on the first calisthenics day whose lead trains there, the lead keeping
    its dose); `SkillBlock.roles` parallels `skills`, and
    `plan/skillWeek.ts` `skillWeekLines` shows each skill's week (or one
    reason it has none) in WeekPreview. **Time away is a rail**
    (`CoachPlan.gapReturn`, `gapReturn.test`): the first loaded session
    after a long gap is never push, factor ≤ 1, never `intensity`, base ≤
    the last base trained at (`cappedBase`), nothing maximal. Also:
    `steerOutside` keeps the steer for "Train again"; `weekly.ts` refuses on
    an empty week and names what the gym time cannot cover; failed machine
    steps hold the lighter load to `hi + 2` reps (`failedStepsAbove`); a
    youth rep floor for jumps (`YOUTH_REP_FLOOR`, 6–8); locations merge per
    field; ladder days fill an explicit time (`fillLadderDay`); the debrief
    names a setup answer that holds a target down. Pinned in
    `plan/round6.test.ts`, `gym/review7.test.ts`, `gapReturn.test.ts`,
    `debriefFallingTarget.test.ts`, `ladderDayFill.test.ts`,
    `plan/skillWeek.test.ts`, `onboardingKit.test.ts`; the eval has a
    gym-only three-day variant (front lever 0 → 1–2 sessions a week).
    Measured: planche key-hold sets 0.958 default, 0.921 at 72 h, 0.895 on
    three days, 0.912 Home, 0.904 gym-only three days. Known limits: 13–17 of
    ~21 muscles stay under their weekly floor with two short gym days (the
    summary says so); the long-head triceps slot rarely fits a 20-minute
    pressing day.
  - Eighth review round (58 UX, partial / 55 logic; the loop had the
    planche at 207 of the control's 208 key sets). **Time away per skill**:
    `Signals.gapDays` (the skill's own days since it trained;
    `skillRestDays` once trained, else `restDays`) drives `longGap` and
    `gapReturn`, and a one-skill gap ignores "trained elsewhere"
    (`gapPerSkill.test`). The parent note reads `conservative`. A key hold
    under `FAR_UNDER_SHARE` (0.5) of its target is not praised, and a step's
    first hold is "First hold logged", not a record (`splitRecords`,
    `lowHold.test`). Train withdraws "instead of the gym" once a skill
    session is saved on a gym day (`offersCalisthenicsInstead`). Gym:
    `LoadSuggestion.repsToMoveUp` is shown and pre-filled when held back;
    `stepDownKg` steps off the real load before rounding (a unit switch is
    one step down, not two); under 18 a step over `YOUTH_LARGE_STEP_SHARE`
    (0.25) of the load is earned with hi+2 reps or two rated top sessions
    (`gym/review8.test`). Copy: a wall-only wait says where to tick it
    (`onlyWallMissing`), the streak says what it counts (`streakText`).
    Not done: the dropped-names list still names a movement kept as a
    warm-up primer — the fix changes `ladderDay.golden.json` and waits for
    a deliberate regeneration.
    Planner: **one joint memory for the line-up** — `lineup.ts`
    `standingNiggle` steers by the latest niggle until a later check-in (not
    only today's), the planner carries `DayCtx.standing`, and `reportLine`
    says who changes what (the lifts keep their 72 h union); `WeekPlanCard`
    reads the same memory. **Order between lower skills**: a pressing opener
    (HSPU) may open a push day (`openerFamily`), and `rankPass` moves a part
    to a higher-ranked skill with fewer full parts, under every rest rule and
    the planche's dose — for planche > HSPU > lever the HSPU's pressing
    shares the planche's rest days, so the lever can still get more
    (measured, not forced). **A focus is its focus**: `viable` needs two
    movements of the focus's own muscles (`ownMovements`, no core). Family
    and exposure lines appear only when today trains that family hard and
    the count matches the week. `LEG_DAY_EVERY_DAYS` stays 10 (7 cost the
    planche 0.921 → 0.895 at 72 h and the lever its pull days). Pinned in
    `plan/round7.test.ts`; the eval asserts at most 2 weeks where the second
    skill has fewer full parts than the third.
  - Ninth review round, by area (gym-only UX 41, data integrity 36). **The
    recovery copy is recovery**: boot always reads the IndexedDB mirror and
    merges it in (`mergeExternalState`), nothing is mirrored before that
    read (`mirrorOpen`), a failed primary write says so once, and a late or
    different mirror is set aside in quarantine. A draft with logged sets is
    never deleted for its age (`MAX_EMPTY_DRAFT_AGE_MS` is for empty ones).
    Same-epoch merges OR `onboarded` and keep the earlier `startedAt`;
    `COMPLETE_ONBOARDING` over history fills only unstamped fields
    (`completeOnboardingOverHistory`). A save from a newer `version` holds
    every write (`isNewerSave`, `PersistStatus.newer`, App's banner).
    Unrelated epochs: history beats setup beats a placeholder
    (`substanceRank`). Birth years clamp to 1920–2200, never to the device
    year. `settings.goalHistory` (declared in `stats.ts`) judges each week by
    its own goal (`goalForWeek`); the goal counts training days of every kind
    (`goalDaysInWeekOf`; the plateau's frequency cause reads
    `trainingDaysPerWeek`). Gym: `sanitizeGymReport` reports losses into
    quarantine and keeps unknown exercise ids; a save with no gym state
    creates it; `activeLocationAt` merges by time; `nextTimeLines` and
    `noMaxReason` (`gym/sessionLines.ts`) show each lift's next session at
    finish and in the detail, with effort and notes; `openDraftFor` keeps the
    open-session card true and Start says it resumes; `finishBlocker` refuses
    to finish over a pending ask. Pinned in `dataSafety.data8.test.ts`,
    `dataSafetyBoot.test.ts` (jsdom), `gym/review9*.test.ts(x)` and
    `diagnoseFrequency.test.ts`.
  - Skill days are requests (`{source: 'auto', skills: [skill]}`); a ladder
    day adds `focus: 'ladder'` (rung first, 5 sets). `ladderDay.golden.json`
    pins every session built without it — regenerate only for an intended
    change (`WRITE_GOLDEN=1`).

## The design system (Phase 5)

- Tokens in `src/index.css`: `text-caption/footnote/body/title3/title2/
  title1/display/hero`, `rounded-control/inner/card/sheet`, `--space-*`,
  `--dur*`, `--ease-out`, `--ease-spring` (a `linear()` spring). Primary
  buttons are one solid accent; no decorative gradients. Everything that
  moves is off under `prefers-reduced-motion`.
- Components in `src/components/ds/` (Button, Card, Sheet, SegmentedControl,
  ToggleChip, Stepper, Metric, CountUp, RingTimer, SwipeRow, EmptyState,
  ErrorState, Skeleton, BadgeGlyph). New UI uses them; `Sheet` shares
  Modal's focus trap through `useDialogFocus` and stays portalled.
- Icons are SVG only (`Icon.tsx`); achievements and Learn guides carry
  `IconName`, never emoji. Swipe is never the only way to do something.

## Conventions

- User-facing changes get an entry in `src/data/changelog.ts`, written in the
  athlete's language, newest first.
- New achievements require bumping `ACHIEVEMENT_VERSION` so saved history is
  reconciled once (also the way to recount records: warm-up and cooldown sets
  never set one). A badge or tip about one skill carries `skill`, and is only
  shown to an athlete who trains it.
- Never pass regular expressions or backslashes through a shell heredoc: a
  `\b` became a backspace character inside a pattern, which nothing shows in
  a diff. `claims.test.ts` now fails on any control character in `src`.
- `AutoForm` fields must be listed in `store.tsx`'s `sanitizeAuto` or imports
  strip them. `PoseFormResult.track`/`explain` are transient — never persist.
- Progression credit demands: athlete-confirmed Clean + camera pass (no
  `arms` flag, ≤1 secondary flag, elbows seen) + flight confirmation on true
  flight skills + the athlete's lockout confirmation wherever the elbows are
  read coarsely. Don't weaken these to make a test pass.
