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
  must not rotate the estimate. `goalOutlook` measures only from completed
  steps at Tuck or above — extrapolating the quick early steps onto the hard
  ones produced "1–14 weeks to a straddle", which is wrong rather than wide.
- `src/lib/plateau.ts` — `diagnosePlateau` separates *is it stalled* from
  *why*. Cause order is deliberate: noise first (every other prescription
  would be acting on a fiction), then recovery (the one cause where "train
  more" is actively harmful), then form, then frequency, then the ceilings.
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
(`CoachDecision.source`) and filtered: `load-advice` is dropped outright when
`loadPermission === 'none'`, and the plateau line is composed *after* the rails
so it can defer instead of telling a sore athlete to train more. Three separate
bugs of this shape were found in review; assume a fourth if you add a decision.

### Evidence tiers

When writing athlete-facing copy, keep these distinguishable:
STRONG (meta-analysis/RCT) · MODERATE · CONSENSUS (coaches agree, no trial) ·
INFERENCE (mechanics) · OPEN. Notably **there is no peer-reviewed research on
planche training itself** — zero PubMed results — so almost everything
progression-specific is CONSENSUS or INFERENCE and must not be phrased as
science. `docs/research-ledger.md` holds the sources and their tiers.

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
   downward. The `to-target` compliance mode in `simulateSeason` pins this; the
   max-test suggestion is the corrective and the eval asserts it engages.

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

## Testing tools

- `#devlab` (linked from Settings → About and the Learn guide "How the camera
  judge works") — the bench: synthetic scenario sliders with ground-truth vs
  measured, real file/URL analysis, a one-tap self-test, and the automation
  API on `window.__planche`. Start with `window.__planche.help`.
- For real photos in an automated browser: `commons.wikimedia.org` blocks
  CORS; resolve direct `upload.wikimedia.org` URLs via the Commons API with
  `origin=*`, and send a User-Agent when downloading outside the browser.

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
