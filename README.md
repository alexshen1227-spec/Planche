# Calisthenics Lab

A local-first web app for learning five bodyweight skills — the **planche**, the **front lever**, the **handstand and handstand push-up**, the **90° hold** and the **human flag** — each as its own road from a first drill to the full skill.
Guided timer sessions, 29 steps across five roads with automatic unlocks, sessions that share the time between the skills you choose, an on-device camera form judge, PRs, streaks, charts and achievements.
All data and clips stay in browser storage; nothing leaves your machine.

(Formerly Planche Lab. Saved data from that version opens unchanged: the planche is simply the first skill in your list.)

**Live app:** https://alexshen1227-spec.github.io/Planche/

Every push to `main` auto-deploys via GitHub Actions (`.github/workflows/deploy.yml`). Running clients
poll `version.json` and show a "new version — refresh" prompt when a deploy lands.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

`npm run test` runs the regression and evaluation suite (about a thousand tests, no model downloads). `npm run check` runs the tests plus the production type-check/build.

## What's inside

- **Onboarding** — pick your skills and put them in order, then a short interview places you on each road and says how confident that placement is. Missing kit (a bar, a wall, a pole) is named, and a skill waits rather than being programmed without it.
- **Home** — the step you are on for the skill you are viewing, progress to its next unlock, what today's session trains and why, weekly work, streak, a tip for a skill you actually train.
- **Train** — an **adaptive** session built for today: working targets follow how your last sessions went, rested days push, heavy yesterdays ease, and everything trims itself to your session length. With more than one skill the session is shared: your first priority leads, a second skill gets a full part when there is time, a third a maintenance dose, and in short sessions the skills take turns. Plus focused templates, a max test per skill, a seven-minute minimum dose and quick-log.
- **Session player** — a brief that says what changed today and why, a lead-in, a ring-timer stopwatch for holds (Space to start/stop), automatic logging with the raw timer reading kept, rest countdown, live PR detection, **voice cues**, an optional "why did it end?" and an independent pain report after each set, **finish early** (saves only what was done) and an explicit save/discard prompt on every exit. Keeps the screen awake while training; the camera only films once it is actually live, and says so when it is not.
- **Path** — every road with coaching notes, form checklists, common mistakes and unlock bars, and the push-up lines (handstand push-up, 90° push-up) beside the holds. Unlocks require an athlete-confirmed Clean hold *and* filmed evidence: a passing camera check, or — for shapes the camera cannot grade honestly — the athlete's own review of the replay against a checklist.
- **Learn** — 91 exercises with how-to steps, cues, mistakes, your best marks and your filmed sets. Plus 14 guides (one per skill, written from the same definitions the road screens use; training more than one skill; how the camera judge works; equipment; and more) and a glossary.
- **Coach** — an on-device optimizer aimed at steady, safe progress to the next step of each skill. Every number it shows can decline to exist when the evidence is not there.
  - *Learns what works on you.* A per-step bandit over five session shapes, evaluated from a robust pre-session baseline to the next comparable results.
  - *Reads everything* (`src/lib/signals.ts`): real rest taken between sets, accessory trends, warm-up adherence, RPE, rest days, max-test recency, deload age — with robust statistics so noise cannot steer it.
  - *Knows a measurement from a floor.* A hold you stopped at the target call counts as "at least this much", never as your maximum; trends, plateau reads and forecasts read measurements only.
  - *Asks.* A periodic check-in (joints, energy) that reshapes every workout type immediately. Joint reports are one timeline, kept even when a session is discarded — and a sore joint eases every skill that loads it.
  - *Watches your form.* Main holds are filmed and run through on-device pose detection (BlazePose via MediaPipe Tasks, MoveNet as a fallback — both lazy-loaded). Each position is judged by its own profile and from the view it can be seen from: side-on for the planche, the levers, the 90° hold and the handstand; front-on for the flag. It refuses rather than guesses: the wrong view is rejected, thin coverage is reported as *unseen*, machine ratings stay unconfirmed, and the athlete confirms or corrects them.
  - *Does not count reps.* Push-up sets on a rung are filmed for the athlete, who passes them on the replay; at a few samples a second the judge cannot vouch for the bottom of a rep, so it does not pretend to.
  - *Cannot go rogue.* Every output is clamped to hard limits; a pain report replaces loaded work with pain-free options; and every decision is written out in plain language.
- **Progress** — per-skill hold trends and form trends, weekly volume, a consistency heatmap, PR board, 60 achievements (a skill's badges only show for athletes who train it), what the coach has measured per strategy, and full session history showing what each set stands on (delete recalculates everything).
- **Settings** — skills and their order, theme, sounds, rest durations, weekly goal, session length, equipment and injury profile, stop-latency and walk-back calibration, "Check this phone", one-tap download of the camera checker for offline use, clip storage, JSON export/import backup, sample data, full reset.
- **Crash-proof sessions** — the live workout is mirrored to storage on every set and again the moment the page is hidden, so a phone that sleeps or a tab the OS discards resumes where it left off.
- **Safe on device** — a full PWA: a service worker precaches the app so it opens with no signal (the camera checker is a separate download on first use, or one tap in Settings); every change is mirrored to a second on-device copy in IndexedDB; saved data that cannot be read is kept aside untouched rather than overwritten; two open tabs merge field by field; and the dashboard nudges you to export a backup once real history accumulates.

## How sure is any of this?

Almost nothing about training these skills has been studied directly. The app keeps its sources and their tiers in `docs/research-ledger.md` (the multi-skill pass is section 13, with the full reports under `docs/research/`), says in the copy where something is coaching convention rather than evidence, and a test (`src/lib/claims.test.ts`) fails the build if a refuted claim reappears in anything the app can show. The unlock bars and rep standards are convention. No timeline is promised, because none is known.

## Transparency: the judge's bench

The camera form judge is the one feature whose output can't be checked by reading it, so the app ships its own test bench at `#devlab` (linked from Settings → About and from the Learn guide *"How the camera judge works"*):

- Build a synthetic pose whose **true** angles you choose — any position on any road — and read the verdict beside the ground truth.
- Run the **self-test** — the judge's promises verified on your own device, including against real photographs it must keep refusing or passing.
- Feed it your own clip or a photo URL through the exact pipeline a workout uses.
- Script all of it from the console via `window.__planche` (start with `.help`) — this is also how automated reviews drive the app. Verdicts can carry their per-moment working via `judgeTrackedFrames(..., { explain: true })`.

Thresholds are set by measurement, not judgement — `CLAUDE.md` documents the invariants and the calibration story for anyone (human or AI) working on the judge. What has *not* been verified is said there too: the filming flow has only been exercised against a simulated camera, not a physical phone.

## Stack

Vite · React 19 · TypeScript · Tailwind CSS v4. No backend, no router, no state library — one reducer + localStorage.

## Notes

- Sessions are pure data; PRs, unlocks, rungs and achievements are derived by replaying history through `src/lib/engine.ts`, so deleting/importing sessions always stays consistent.
- Not medical advice. Straight-arm and inverted training is heavy on wrists, elbows and shoulders — prepare, stop holds before the position goes, and back off when pain builds from week to week.
