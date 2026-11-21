import type { SkillId } from '../types'

/**
 * What a tip rests on. Shown beside it, because a tip of the day reads like a
 * fact whatever its source — and almost nothing about training these skills
 * has been studied (see docs/research-ledger.md). The wording of a tip must not
 * sound more certain than its basis.
 */
export type TipBasis = 'research' | 'consensus' | 'mechanics' | 'safety' | 'app'

export const BASIS_LABEL: Record<TipBasis, string> = {
  research: 'From general strength-training research, not studies of these skills',
  consensus: 'Coaching consensus — no trial behind it',
  mechanics: 'Reasoning from mechanics, not a measurement',
  safety: 'Safety guidance, not a diagnosis',
  app: 'How this app reads your training',
}

export interface Tip {
  title: string
  body: string
  basis: TipBasis
  /** The skill a tip is about. It is only shown to an athlete who trains that skill. */
  skill?: SkillId
}

export const TIPS: Tip[] = [
  {
    title: 'Straight arms are the whole game',
    skill: 'planche',
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
    skill: 'planche',
    body: 'Keep the shoulders pushed forward and the upper back gently rounded. If the chest sinks between the shoulder blades, the position has changed — reset rather than hang on for the seconds.',
    basis: 'consensus',
  },
  {
    title: 'The lean is a main lift',
    skill: 'planche',
    body: 'Many coaches keep planche leans in training long after the tuck: the lean loads a planche-like position at a weight you set by how far you lean.',
    basis: 'consensus',
  },
  {
    title: 'Parallettes change the wrist angle',
    skill: 'planche',
    body: 'A neutral grip takes the wrists out of end-range extension, which many people find more comfortable. It is not a fix for pain: if a wrist hurts, stop and get it looked at.',
    basis: 'consensus',
  },
  {
    title: 'Visit the skill often',
    body: 'Coaches generally prefer three or four focused sessions a week to one exhausting one — a skill is practised best fresh. Nobody has run that comparison for these skills.',
    basis: 'consensus',
  },
  {
    title: 'Easy weeks are a convention',
    body: 'Half the volume, easy targets, same movements. Coaches schedule one every 4–6 weeks; the trials have not shown it adds strength, so treat it as a pressure valve for fatigue and busy weeks.',
    basis: 'consensus',
  },
  {
    title: 'Bands are for positions',
    skill: 'planche',
    body: 'Band assistance lets you rehearse the straddle shape before you can hold it free. The same form rules apply, and banded holds count as training — never toward an unlock.',
    basis: 'consensus',
  },
  {
    title: 'Width shortens the lever',
    skill: 'planche',
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

  // ——— Front lever ———
  {
    title: 'Pull the bar toward your hips',
    skill: 'frontlever',
    body: 'In a front lever the arms stay straight and the lats pull the bar down toward the hips. Coaches treat bent elbows as a different exercise — a row — so shorten the lever before you let them bend.',
    basis: 'consensus',
  },
  {
    title: 'Level first, long second',
    skill: 'frontlever',
    body: 'From the side the camera reads whether your hips and shoulders are level. A lever held with the hips low is a different, easier position — tuck tighter and keep it level rather than reach for the longer shape.',
    basis: 'app',
  },
  {
    title: 'Lower out of a lever',
    skill: 'frontlever',
    body: 'Come down by lowering the hips under control rather than letting go of the position. If a shoulder or elbow hurts, stop the set and step back a shape.',
    basis: 'safety',
  },

  // ——— Handstand and handstand push-up ———
  {
    title: 'Learn the way out first',
    skill: 'handstand',
    body: 'Coaches teach the exit before the balance: stepping down from the wall, then a quarter-turn out. Clear the floor around you before you kick up.',
    basis: 'consensus',
  },
  {
    title: 'Balance is practised fresh',
    skill: 'handstand',
    body: 'Handstand balance is a skill more than a strength hold. Coaches prescribe short, frequent practice while you are fresh, which is why it sits at the start of your session.',
    basis: 'consensus',
  },
  {
    title: 'The hands steer',
    skill: 'handstand',
    body: 'Tipping toward your back, press the fingertips into the floor; tipping toward your front, shift weight to the heels of the hands. That is how coaches teach the correction — small pushes at the hands rather than bending the body.',
    basis: 'consensus',
  },
  {
    title: 'Strict reps only upside down',
    skill: 'handstand',
    body: 'In a handstand push-up the head touches the floor lightly and never takes a landing. Use a folded mat, and end the set while you can still lower under control.',
    basis: 'safety',
  },
  {
    title: 'The replay counts the reps',
    skill: 'handstand',
    body: 'The camera does not count push-up reps — at a few samples a second it cannot vouch for the bottom of one. Film the set, watch it back, and pass it against the list for that rung.',
    basis: 'app',
  },

  // ——— 90° hold ———
  {
    title: 'Nothing rests on the elbows',
    skill: 'ninety',
    body: 'The 90° hold is carried by the arms at a right angle. Once the body rests on the elbows it is an elbow lever — a supported skill, and a different one.',
    basis: 'consensus',
  },
  {
    title: 'Lean to stay level',
    skill: 'ninety',
    body: 'Bent arms bring the shoulders down toward the hands, so the shoulders have to travel forward for the body to balance level. When the lean goes, the feet drop.',
    basis: 'mechanics',
  },
  {
    title: 'Lower slowly into the hold',
    skill: 'ninety',
    body: 'On the push-up line, lower over several seconds and stop in the hold. Do not take a set to failure upside down, and stop on wrist or shoulder pain rather than finishing the set.',
    basis: 'safety',
  },

  // ——— Human flag ———
  {
    title: 'Check the pole every time',
    skill: 'flag',
    body: 'A flag pulls sideways on the pole with your whole weight, which is not what most poles are fixed for. Check that it is anchored and does not turn in your hands before every session.',
    basis: 'safety',
  },
  {
    title: 'The bottom arm pushes',
    skill: 'flag',
    body: 'Coaches cue the bottom arm pushing the pole away on a locked elbow while the top arm pulls. If the bottom elbow bends, come down and try a shorter shape.',
    basis: 'consensus',
  },
  {
    title: 'Film a flag from the front',
    skill: 'flag',
    body: 'A flag is judged with the phone facing your chest: from there the camera reads how level you are, your line, and a large bend in either arm. From the side it cannot be judged at all.',
    basis: 'app',
  },
  {
    title: 'Train both sides',
    skill: 'flag',
    body: 'A flag has a top hand. Coaches train both, weaker side first. Nothing shows that doing so prevents injury — it is simply the only way to own the skill on both sides.',
    basis: 'consensus',
  },
]

/**
 * The tip for a day: one of the general tips, or one about a skill the athlete
 * trains. The same day gives the same tip, and nobody is given advice for a
 * road they are not on.
 */
export function tipOfTheDay(now = Date.now(), skills: readonly SkillId[] = ['planche']): Tip {
  // The athlete's own calendar day. Counting days from the epoch changes the
  // tip at midnight in Greenwich — four in the afternoon in California — so
  // an evening session could open on a different tip than the morning showed.
  const local = new Date(now)
  const day = Math.floor(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()) / 86_400_000)
  const pool = TIPS.filter((tip) => !tip.skill || skills.includes(tip.skill))
  return pool[day % pool.length]
}
