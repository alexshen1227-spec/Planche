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
