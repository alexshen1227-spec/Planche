# Planche Lab — working notes for agents and developers

Local-first planche-training PWA. Vite + React 19 + TypeScript + Tailwind v4.
No backend, no router, no state library: one reducer over localStorage, with an
IndexedDB mirror for crash safety. Nothing a user does ever leaves their device.

## Commands

- `npm run dev` — dev server (honors `PORT`; defaults to 5173, strictPort)
- `npm run test` — vitest suite (pure logic; no DOM, no model downloads)
- `npm run check` — tests, then `tsc --noEmit` + production build
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

`docs/research-ledger.md` has **two** passes. The second (2026-08-05) was
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
9. **"Clean" in the UI means camera-verified clean** (`verifiedCleanRatio`):
   `cleanRatio` is time before a sustained breakdown and stays the training-dose
   number (`trainingSetValue` caps on it — zeroing it would turn a 7s soft-elbow
   hold into 0s of training). But bent arms *inside* the window (`heldIssues`)
   mean none of it was verified clean, so trends, the coach's form signal and
   the result panel read 0 there.

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
   band for a walk-back hold reaches `WALK_BACK_MAX_SEC − allowanceSec` (the
   walk the allowance may have missed); without it that athlete never left the
   tuck and was told "going backwards" for fifteen weeks. All five realistic
   athletes are pinned (no noise or plateau days, at least two steps up);
   their seeds matter, so re-measure rather than loosen if one moves. A
   realistic athlete who never films stayed at the tuck for sixty sessions
   with 23s max holds on a 20s bar and was never told why (unlock attempts
   queue only from verified holds); the plan now says so whenever the fresh
   stopwatch level reaches 85% of the bar and the verified best has not.

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

## Conventions

- User-facing changes get an entry in `src/data/changelog.ts`, written in the
  athlete's language, newest first.
- New achievements require bumping `ACHIEVEMENT_VERSION` so saved history is
  reconciled once.
- `AutoForm` fields must be listed in `store.tsx`'s `sanitizeAuto` or imports
  strip them. `PoseFormResult.track`/`explain` are transient — never persist.
- Progression credit demands: athlete-confirmed Clean + camera pass (no
  `arms` flag, ≤1 secondary flag, elbows seen) + flight confirmation on true
  flight skills. Don't weaken these to make a test pass.
