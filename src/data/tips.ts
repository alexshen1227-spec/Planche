/**
 * What a tip rests on. Shown beside it, because a tip of the day reads like a
 * fact whatever its source — and almost nothing about planche training itself
 * has been studied (see docs/research-ledger.md). The wording of a tip must not
 * sound more certain than its basis.
 */
export type TipBasis = 'research' | 'consensus' | 'mechanics' | 'safety' | 'app'

export const BASIS_LABEL: Record<TipBasis, string> = {
  research: 'From general strength-training research, not planche studies',
  consensus: 'Coaching consensus — no trial behind it',
  mechanics: 'Reasoning from mechanics, not a measurement',
  safety: 'Safety guidance, not a diagnosis',
  app: 'How this app reads your training',
}

export interface Tip {
  title: string
  body: string
  basis: TipBasis
}

export const TIPS: Tip[] = [
  {
    title: 'Straight arms are the whole game',
    body: 'A bent-arm planche is a different exercise. If the elbows bend, shorten the hold or regress the step — do not trade lockout for seconds.',
    basis: 'consensus',
  },
  {
    title: 'Film from the side',
    body: 'Side-on video can show a sagging back or low hips you cannot feel. The camera check is an estimate — confirm what it says against the clip yourself.',
    basis: 'app',
  },
  {
    title: 'Stop before the shaking',
    body: 'Many coaches end skill holds a couple of seconds short of collapse, so the seconds you practise are seconds in the position. The shaking, sagging end of a hold mostly practises something else.',
    basis: 'consensus',
  },
  {
    title: 'Prepare the wrists',
    body: 'A couple of minutes of circles, rocks and palm lifts before loading is a chance to check how your wrists feel today. It is preparation, not protection: no trial has shown a warm-up prevents injury, and it does not make a sore wrist safe to load.',
    basis: 'consensus',
  },
  {
    title: 'Rest between hard holds',
    body: 'Two to three minutes between hard sets is common practice for skill holds, so each one is practised fresh rather than tired.',
    basis: 'consensus',
  },
  {
    title: 'Fast gains are mostly skill',
    body: 'Early strength gains are largely your nervous system learning the position: in one small study, strength rose by about a third in two months while muscle size and tendon stiffness had not changed. When your holds jump, the app keeps volume steady rather than raising it to match.',
    basis: 'research',
  },
  {
    title: 'Push the floor away',
    body: 'Keep the shoulders pushed forward and the upper back gently rounded. If the chest sinks between the shoulder blades, the position has changed — reset rather than hang on for the seconds.',
    basis: 'consensus',
  },
  {
    title: 'The lean is a main lift',
    body: 'Many coaches keep planche leans in training long after the tuck: the lean loads a planche-like position at a weight you set by how far you lean.',
    basis: 'consensus',
  },
  {
    title: 'Parallettes change the wrist angle',
    body: 'A neutral grip takes the wrists out of end-range extension, which many people find more comfortable. It is not a fix for pain: if a wrist hurts, stop and get it looked at.',
    basis: 'consensus',
  },
  {
    title: 'Visit the skill often',
    body: 'Coaches generally prefer three or four focused sessions a week to one exhausting one — a skill is practised best fresh. Nobody has run that comparison for planche.',
    basis: 'consensus',
  },
  {
    title: 'Easy weeks are a convention',
    body: 'Half the volume, easy targets, same movements. Coaches schedule one every 4–6 weeks; the trials have not shown it adds strength, so treat it as a pressure valve for fatigue and busy weeks.',
    basis: 'consensus',
  },
  {
    title: 'Bands are for positions',
    body: 'Band assistance lets you rehearse the straddle shape before you can hold it free. The same form rules apply, and banded holds count as training — never toward an unlock.',
    basis: 'consensus',
  },
  {
    title: 'Width shortens the lever',
    body: 'Spreading the legs brings their weight closer to your shoulders, so a wider straddle is a lighter planche. That is why straddle flexibility — pancake work — shows up on the plan.',
    basis: 'mechanics',
  },
  {
    title: 'Squeeze everything',
    body: 'Glutes, quads, pointed toes. Coaches cue full-body tension so the body moves as one piece; a loose body tends to drift out of line without you noticing.',
    basis: 'consensus',
  },
  {
    title: 'Seconds are streaky',
    body: 'A 12s day after a 16s day is usually just a day. Judge progress on trends over a couple of weeks — the forecast here does the same, and one lucky hold cannot swing it.',
    basis: 'app',
  },
  {
    title: 'Test on a rested day',
    body: 'Plan max tests for days you have slept and recovered. Poor sleep tends to cost performance, and a test on a bad day measures the day, not you.',
    basis: 'consensus',
  },
  {
    title: 'Own the step before you leave it',
    body: 'The unlock bars are convention, not measured thresholds — credible coaches’ standards differ several-fold. Many would rather you hold the current step cleanly with seconds to spare than scrape past the bar.',
    basis: 'consensus',
  },
  {
    title: 'Do not diagnose pain by location',
    body: 'If elbow, wrist or shoulder pain is new or worsening, stop the provoking movement and seek qualified help when it is severe or persistent.',
    basis: 'safety',
  },
]

export function tipOfTheDay(now = Date.now()): Tip {
  const day = Math.floor(now / 86_400_000)
  return TIPS[day % TIPS.length]
}
