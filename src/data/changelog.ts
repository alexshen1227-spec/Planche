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
