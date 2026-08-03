/**
 * What changed, in the athlete's language rather than the developer's.
 *
 * Written by hand on purpose: commit subjects describe code, and this is read
 * by someone who wants to know whether their training changed. Newest first.
 */

export interface ChangeEntry {
  /** ISO date the change shipped. */
  date: string
  title: string
  /** Where the change lands, for the coloured tag. */
  area: 'camera' | 'coach' | 'training' | 'app'
  notes: string[]
}

export const CHANGELOG: ChangeEntry[] = [
  {
    date: '2026-08-03',
    title: 'The target stays in sight',
    area: 'app',
    notes: [
      'Opening a workout now shows one clear Main target above the full block list, including the exercise, target per set or side, and prescribed set count.',
      'The next-set screen gives the target its own high-contrast badge, and the setup countdown keeps it visible while you move into position.',
    ],
  },
  {
    date: '2026-08-03',
    title: 'The skeleton stays on you',
    area: 'camera',
    notes: [
      'A landmark that teleports away for one sample and immediately returns is now repaired before the replay or form verdict uses it. If that happens repeatedly, the clip is refused instead of guessing.',
      'Skeleton replay now moves smoothly between nearby analysed moments instead of snapping from one frozen sample to the next. Real tracking gaps stay blank rather than showing a pose from the wrong moment.',
      'Shoulder-to-hip rotation is now measured as the true angle between those body lines, so camera roll, body size and shoulder width no longer distort the twist check. When both sides are clearly visible, their midpoints also steady the hip-height call.',
      'The straight-arm check now catches a persistent 4° soft elbow while retaining a small camera-error band and the multi-frame evidence requirement that prevents one jittery landmark becoming a fault.',
    ],
  },
  {
    date: '2026-08-03',
    title: 'A more skeptical camera coach',
    area: 'coach',
    notes: [
      'Camera clean time, form score and skeleton drift now use robust centres, and camera-score trends use an outlier-resistant slope. One strange clip can no longer swing the next plan.',
      'When reviewed clips repeatedly disagree with your rating or lack enough confidence, the coach says so and leaves those camera trends out of the prescription.',
      'Large skeleton movement is no longer described as your body definitely slipping. The coach asks you to check whether the dots followed you or drifted away, and never changes a target from that signal alone.',
    ],
  },
  {
    date: '2026-08-03',
    title: 'A bigger trophy cabinet and a smoother app',
    area: 'app',
    notes: [
      'Fourteen new achievements now cover early momentum, long streaks, time under tension, every major planche shape, camera reviews, high form scores, exercise variety and total set volume — 38 trophies in all.',
      'When the app updates, saved session history is now checked against new achievement rules automatically. Anything you had already earned unlocks immediately with its original first-qualifying session date.',
      'Progress now has quick section links plus a real trophy cabinet with completion progress, closest unlocks and Next up, Earned, Locked and All views. Locked badges show useful progress even from zero.',
      'The Path is much easier to scan on a phone: unlock rules are tucked behind a short explainer, cards no longer squeeze or truncate their useful text, and the active mobile tab has a clear touch target.',
      'Learn search now looks through coaching steps, cues, common mistakes and muscles — not only exercise titles — and shows a live result count with one-tap clearing.',
      'Switching tabs now returns to the top instead of carrying over the scroll position from a long page, and a first-time athlete gets an honest baseline-session explanation instead of “99 rest days banked.”',
    ],
  },
  {
    date: '2026-08-03',
    title: 'Stricter straight arms and cleaner body-line calls',
    area: 'camera',
    notes: [
      'Every graded planche level now targets a true 180° elbow lockout. A small bend must persist and clear the camera-error band before it is flagged, while natural hyperextension is recognized as lockout instead of mistaken for flexion.',
      'Tuck through Full now use progressively tighter shoulder-to-hip level standards, and the one-leg check finally grades the extended knee and the extended hip line instead of only the tucked shape.',
      'Fine elbow, hip and lean measurements now require stronger landmark confidence. A late sustained form loss is named in the verdict instead of silently shortening clean time, while isolated tracking jumps remain ignored.',
      'Shoulder rotation now compares the shoulder line with the hip line, which cancels camera tilt better than judging one shoulder pair alone. The setup preview also warns about missing elbows and a head-on camera angle before the set starts.',
      'A detected bent-arm hold can no longer count as progression-quality evidence, even when it is the only camera flag.',
    ],
  },
  {
    date: '2026-07-30',
    title: 'Floor and parallettes finally count as different records',
    area: 'training',
    notes: [
      'Equipment can now be changed in Settings, with a default surface you can override from the workout screen.',
      'Planche sets remember whether they were done on the floor or parallettes. Progress charts and PR cards can show either surface without pretending an old untagged hold belonged to one.',
      'Your goal skill, birth year and equipment live in one editable athlete profile. A Straddle goal starts useful pancake mobility earlier, while age context only makes readiness check-ins a little more attentive — it never changes earned progress.',
    ],
  },
  {
    date: '2026-07-30',
    title: 'A supported shape cannot unlock true flight',
    area: 'camera',
    notes: [
      'Tuck through Full Planche now asks you to confirm that both feet stayed completely off the floor. A side-on 2D camera can judge shape, but it cannot reliably infer toe support.',
      'Existing unlocks stay earned; the stricter flight confirmation applies only to future progression evidence.',
      'Filmed sets that missed their rest-screen review are brought back at the session summary, and multiple queued camera checks run one at a time to avoid fighting over the phone GPU.',
    ],
  },
  {
    date: '2026-07-30',
    title: 'The coach now learns the time you actually rested',
    area: 'coach',
    notes: [
      'Learned rest now removes the raw hold, the real countdown you used and the phone-reach delay. Skipping a lead-in no longer quietly distorts the next recommendation.',
      'Workout estimates include setup and phone timing and no longer count a rest after the final set, so the stated session length is much closer to the real one.',
      'An unverified PR can safely lower an overambitious first target, but it can never raise the target or unlock a step.',
      'The session trimmer now preserves both exercises chosen for a measured limiter before generic accessory work.',
    ],
  },
  {
    date: '2026-07-30',
    title: 'Small glitches that mattered',
    area: 'app',
    notes: [
      'Fresh backups from the current app can be imported again; the importer was accidentally one version behind the exporter.',
      'The rest screen now names the real next side when the coach starts unilateral work on your weaker side.',
      'Update prompts wait until a live workout is closed instead of offering a reload over the timer.',
    ],
  },
  {
    date: '2026-07-30',
    title: 'A quick drop cannot look like a clean hold',
    area: 'camera',
    notes: [
      'Touching the position for less than a second is now refused as too brief to judge instead of letting the camera grade the post-drop clip.',
      'If the body or a required joint disappears for a sustained run, the verified clean window now ends there; one isolated tracking miss is still ignored.',
      'A fast exit can shorten clean time without inventing an elbow, hip or body-line fault the camera did not actually observe.',
    ],
  },
  {
    date: '2026-07-30',
    title: 'More time to get on and off the hold',
    area: 'training',
    notes: [
      'Every main Path hold except Planche Lean now gives you an 8-second setup countdown instead of 5 seconds.',
      'Those progression holds remove 5 seconds between coming down and reaching the phone, so the saved result better matches the time you were actually in position.',
      'Planche Lean keeps its quicker 5-second lead-in and your existing calibrated stop delay.',
    ],
  },
  {
    date: '2026-07-29',
    title: 'Planche leans grow with your progression',
    area: 'training',
    notes: [
      'Tuck sessions now keep planche leans as real straight-arm strength work after the main holds instead of shrinking them to only a warm-up.',
      'Advanced Tuck tapers leans to maintenance volume, while One-Leg, Straddle and Full keep an easy technique primer without draining the longer-lever work.',
      'Lean targets now cue farther shoulder travel with locked elbows rather than rewarding extra seconds in the same position.',
    ],
  },
  {
    date: '2026-07-29',
    title: 'Jump to the progression you already train',
    area: 'training',
    notes: [
      'Any locked step on the Path can now be chosen through a three-part safety check, so experienced athletes are not forced to replay skills they already own.',
      'Skipping changes the active coach and workout plan without inventing PRs, filmed passes, verified mastery or achievement badges.',
      'Every earlier step becomes available to revisit, while steps without qualifying evidence say available instead of cleared.',
    ],
  },
  {
    date: '2026-07-28',
    title: 'Camera glitches stop becoming form faults',
    area: 'camera',
    notes: [
      'Red form flags now use the same measurement-error buffer as the numeric score. A near-threshold elbow or hip can no longer score as clean and be called wrong at the same time.',
      'Isolated joint jumps are removed before the hold is graded, and a clip whose skeleton keeps jumping is refused as unreliable instead of blaming the athlete.',
      'The checker locks onto the best-observed side across the whole clip and no longer mixes a far-side hip with a near-side shoulder. Occluded limbs join the verdict only when they are clearly visible and separate.',
      'A breakdown now needs multiple consecutive material misses sustained for roughly a second. Late movement is reported in the measurement detail without turning a brief detector wobble into several red flags.',
      'Each hold now samples about three moments per second, up to 72 across a long clip, and shows usable moments against the full sample count. Breakdown tolerance is measured in real time, so the denser check is more informed rather than harsher.',
      'Saved replay history doubled from 8 to 16 clips per exercise. The 30-day cleanup and pinned-clip protection still keep device storage under control.',
      'When the pose model stacks both wrist or ankle labels onto one visible limb, the duplicate far-side point is now removed from both the skeleton and the verdict. Impossible arm proportions are discarded instead of becoming a bent-elbow warning.',
      'The headline elbow angle now reflects the typical held position. A minority of low detector misses cannot outweigh a consistently straight arm; a real sustained bend still shortens the verified clean window.',
    ],
  },
  {
    date: '2026-07-28',
    title: 'The coach listens when you correct the camera',
    area: 'coach',
    notes: [
      'Unconfirmed camera guesses and checks that disagree with your reviewed rating stay visible beside the replay, but they no longer lower targets, pick a limiter, or teach the strategy coach the wrong lesson.',
      'Automatic ratings now include the verified clean share, so a hold that clearly left the form envelope is not pre-filled as Clean just because no single correction was stable enough to name.',
      'When you film several sets, an occasional camera flag is treated as an outlier. A limiter has to repeat across at least 40% of reviewed clips before the coach changes accessory work around it.',
    ],
  },
  {
    date: '2026-07-27',
    title: 'A form score, one fix at a time, and the skeleton the camera saw',
    area: 'camera',
    notes: [
      'Filmed holds now get a 0–100 form score, graded with the same deduction bands gymnastics judges use: nothing inside 5° of perfect, small errors to 20°, medium to 45°, and past that the position is not being counted as that skill. The score breaks down per criterion — straight arms, body line, lean, held-clean time — so you can see exactly where the points went.',
      'When several things slipped, the check now leads with the one correction worth your attention next — bent arms before cosmetic faults — instead of a wall of notes. One cue at a time is how corrections actually stick.',
      'Replays can now show the tracked skeleton drawn over your body, with the joints behind any fault highlighted. If the check reads you wrong, you will see exactly where it thought your elbow was — and if it tracked the curtains instead of you, that is visible too.',
      'Before a filmed set, the preview now runs a live framing check and tells you if your feet or hands are out of shot — while you can still move the phone, not after the effort is spent.',
      'Both arms are judged when both are clearly visible, so a locked near elbow can no longer hide the far one bending.',
      'The pose engine moved to the actively maintained MediaPipe runtime (same BlazePose model family, faster and with honest per-joint visibility), with MoveNet still standing by as the fallback — every clip still goes to whichever tracks your footage better.',
    ],
  },
  {
    date: '2026-07-27',
    title: 'The coach learns from quality, not just the stopwatch',
    area: 'coach',
    notes: [
      'When the coach measures which training approach moves you fastest, seconds the camera watched decay now count for less than seconds held clean — and an approach that precedes a joint complaint loses credit. Grinding out sloppy time can no longer teach the coach the wrong lesson.',
      'If the same body part keeps ending up out of the camera frame, the coach now says so and tells you how to place the phone — a chronically unseen knee is a tripod problem, not a form problem, and until it is fixed that check is silently skipped.',
      'Your camera form score is tracked over time. Quality climbing while hold times sit flat is called out as the real progress it is — seconds usually follow the position.',
      'Unilateral sets now start with your weaker side while you are freshest. The coach has always said to lead with the weak side; the session player used to start on the left regardless.',
      'When you are fresh, steady and overdue, the coach now actually suggests the max test on the dashboard — it used to decide this quietly and tell no one.',
      'After a session, the debrief celebrates verified clean-hold growth against your last filmed session — the realest number this app has.',
    ],
  },
  {
    date: '2026-07-26',
    title: 'Widest possible frame, and this page',
    area: 'camera',
    notes: [
      'The camera no longer asks for a specific resolution. Every size or shape you request is a licence for the browser to crop the sensor to match it — asking for 720p was quietly throwing away the edges of the frame.',
      'It now opens with no size constraint, asks for the native uncropped frame, winds any zoom to its widest, then negotiates up to the full sensor readout. On a typical phone that is 4:3 at 1920×1440 instead of a cropped 16:9 at 1280×720 — noticeably more room to fit a body end to end.',
      'The setup screen shows the lens and the exact resolution you are filming at, so you can see what you are getting.',
      'The update log is its own page now, reached from Settings, instead of a popup.',
    ],
  },
  {
    date: '2026-07-26',
    title: 'The camera check gets a second model, and stops judging your dismount',
    area: 'camera',
    notes: [
      'Added BlazePose alongside MoveNet. Every clip is now tried on both models at three orientations, and whichever tracked your footage best is the one that grades it.',
      'Coming out of a hold is a controlled collapse — bent arms, dropping hips. Those frames were being averaged into the verdict, so a clean set came back as "elbows bent". The verdict now covers the hold itself and reports the breakdown point separately.',
      'A joint that vanishes for a single frame and comes back is now filled in from the frames either side, instead of throwing the whole frame away.',
      'Uses the ultra-wide 0.5× lens where your phone has one, which is what lets a full planche fit hands-to-feet from across the room.',
      'Failed checks now say what they actually saw — "only your hips and feet stayed in frame" — rather than a generic "could not track your body".',
    ],
  },
  {
    date: '2026-07-26',
    title: 'Camera framing fixes',
    area: 'camera',
    notes: [
      'The preview showed a different frame from the one being recorded: a 16:9 request made the browser crop the sensor, narrowing the view. Removed, so you get the full field of view back.',
      'The preview box now takes the camera’s real shape, so the dashed framing guide sits on your actual shot instead of floating over black bars.',
      'Fixed a black preview when the camera was already open.',
    ],
  },
  {
    date: '2026-07-26',
    title: 'Grades what it can see instead of refusing',
    area: 'camera',
    notes: [
      'One criterion out of frame used to void the entire check — and with progression requiring camera evidence, that cost the unlock too. It now grades everything it can see and names what it could not.',
      'Locked elbows stay the exception: no unlock is granted from a clip where the elbows were never visible.',
    ],
  },
  {
    date: '2026-07-25',
    title: 'The coach reads every session, and only clean time counts',
    area: 'coach',
    notes: [
      'Every session feeds the coach now, including Train templates and quick work, weighted by how hard it actually was.',
      'Rest days are judged on training load rather than "did anything happen" — a light wrist day no longer hides a hard session.',
      'Progression credits only the camera-verified clean portion of a hold, so seconds earned with a broken shape do not unlock the next step.',
      'Every session ends with a Coach’s read: what slipped, what moved, and what changes next time.',
    ],
  },
  {
    date: '2026-07-25',
    title: 'Both sides trained properly, and clips that expire',
    area: 'training',
    notes: [
      'Unilateral work runs both sides, labelled, and the weaker side sets your progression.',
      'Form clips older than a month are deleted automatically; pinned ones are kept.',
      'Your progress, clips and settings survive every update.',
    ],
  },
  {
    date: '2026-07-24',
    title: 'Form video and automatic form checks',
    area: 'camera',
    notes: [
      'Main holds are filmed from your phone and checked automatically, on device — nothing is ever uploaded.',
      'Reaction delay between leaving the position and hitting stop is measured and subtracted, so the numbers mean what they say.',
    ],
  },
  {
    date: '2026-07-24',
    title: 'Never lose a session again',
    area: 'app',
    notes: [
      'A session interrupted by the phone sleeping is picked back up where it left off instead of vanishing.',
      'Works fully offline, with a self-restoring backup if storage is ever cleared.',
    ],
  },
  {
    date: '2026-07-24',
    title: 'The road to planche',
    area: 'training',
    notes: [
      'Eight steps from first plank to full planche, with a coach that adapts the plan to your own numbers.',
      'Guided sessions with timers, rest, voice cues and automatic logging.',
    ],
  },
]

export const AREA_LABEL: Record<ChangeEntry['area'], string> = {
  camera: 'Camera',
  coach: 'Coach',
  training: 'Training',
  app: 'App',
}
