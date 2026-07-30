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
