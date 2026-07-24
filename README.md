# Planche Lab

A local-first web app for learning the planche — from your first planche lean to the full hold.
Guided timer sessions, an 8-step progression road with automatic unlocks, adaptive programming, PRs, streaks, charts and achievements.
All data stays in your browser (localStorage); nothing leaves your machine.

**Live app:** https://alexshen1227-spec.github.io/Planche/

Every push to `main` auto-deploys via GitHub Actions (`.github/workflows/deploy.yml`). Running clients
poll `version.json` and show a "new version — refresh" prompt when a deploy lands.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

`npm run build` type-checks and produces a static build in `dist/` (serve it with anything, e.g. `npm run preview`).

## What's inside

- **Onboarding** — quick placement quiz sets your starting step and weekly goal.
- **Home** — current step, progress to the next unlock, weekly ring, streak, tip of the day.
- **Train** — an **adaptive** auto-generated session for your current step: working targets adjust to how your last session actually went, rested days become Push Days (with an unlock attempt queued when you're ≥85% of the bar), heavy yesterdays become Technique Days, and everything trims itself to your session-length budget (default 30 min) with a short wrist warm-up and cooldown built in. Plus six focused templates, a max-test mode, and quick-log.
- **Session player** — 5s lead-in, ring-timer stopwatch for holds (Space to start/stop), automatic logging, rest countdown (+30s / skip), live PR detection with haptics, **voice cues** (spoken 5-second counts and go/target calls — you can't read a screen mid-planche), "vs last time" insights, RPE + notes, celebration screen with confetti for PRs / unlocks / achievements. Keeps the screen awake while training.
- **Path** — the 8-step road (Foundations → Lean → Frog → Tuck → Advanced Tuck → One-Leg → Straddle → Full) with coaching notes, form checklists, common mistakes and unlock bars. Clear a bar and the next step opens automatically.
- **Library** — 27 exercises with how-to steps, cues, mistakes and your best marks.
- **Progress** — hold-trend chart with goal line, weekly volume chart, a GitHub-style consistency heatmap, PR board, 24 achievements with live progress bars, full session history (delete recalculates everything).
- **Settings** — dark/light/system theme, sounds and countdown beeps, rest durations, weekly goal, session length, JSON export/import backup, sample-data mode, full reset.
- **Safe on device** — the app is a full PWA: a service worker precaches everything so it opens with no signal; `navigator.storage.persist()` asks the browser to protect the data from cleanup; every change is mirrored to a second on-device copy in IndexedDB and silently restored if localStorage is ever wiped or corrupted; and the dashboard nudges you to export a backup file once real history accumulates.

## Stack

Vite · React 19 · TypeScript · Tailwind CSS v4. No backend, no router, no state library — one reducer + localStorage.

## Notes

- Sessions are pure data; PRs, unlocks and achievements are derived by replaying history through `src/lib/engine.ts`, so deleting/importing sessions always stays consistent.
- Not medical advice. Straight-arm training is heavy on wrists, elbows and biceps tendons — warm up, stop holds ~2s before failure, and back off at the first sign of joint pain.
