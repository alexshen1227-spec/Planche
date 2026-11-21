import type { SkillId } from '../types'
import { EXERCISE_BY_ID } from './exercises'
import { SKILL_LIST, type SkillDef } from './skills'

export interface GuideSection {
  heading: string
  body: string
  bullets?: string[]
  /** An optional call-to-action rendered after the section. */
  link?: { href: string; label: string }
}

export interface Guide {
  id: string
  /** Where it is shelved: getting started, one skill's road, or how the app works. */
  group: 'start' | 'skill' | 'method'
  /** The skill a road guide is about. */
  skill?: SkillId
  icon: string
  title: string
  summary: string
  sections: GuideSection[]
}

export const GUIDE_GROUPS: { id: Guide['group']; title: string; blurb: string }[] = [
  { id: 'start', title: 'Getting started', blurb: 'What to read first.' },
  { id: 'skill', title: 'The skills', blurb: 'One guide per road: what it is, what it asks first, how it is filmed.' },
  { id: 'method', title: 'How the app works', blurb: 'What it measures, what it decides, and how sure any of it is.' },
]

const SKILL_ICON: Record<SkillId, string> = {
  planche: '🤸',
  frontlever: '🪝',
  handstand: '🙃',
  ninety: '📐',
  flag: '🚩',
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)
/** Whether two sentences name the same piece of kit. */
const KIT_WORDS = /\b(pole|wall|bar|rings|parallettes|band|box)\b/gi
const sharesKitWord = (a: string, b: string) => {
  const inB = new Set((b.match(KIT_WORDS) ?? []).map((word) => word.toLowerCase()))
  return (a.match(KIT_WORDS) ?? []).some((word) => inB.has(word.toLowerCase()))
}
const fullReps = (n: number) => `${n} full rep${n === 1 ? '' : 's'}`

/**
 * A skill's guide, written from its definition.
 *
 * The definition is where a road's claims were sourced and worded — what
 * coaches ask for first, what the camera can see, how thin the evidence is —
 * and its screens already print those sentences. Building the guide from the
 * same fields means the Learn tab cannot drift into saying something the road
 * itself does not.
 */
export function skillGuide(def: SkillDef): Guide {
  const lastStep = def.steps.length - 1
  const ladder = def.ladder
  const twoDays = def.steps.filter((step) => (step.repeatDays ?? 1) > 1)
  return {
    id: `skill-${def.id}`,
    group: 'skill',
    skill: def.id,
    icon: SKILL_ICON[def.id],
    title: def.name,
    summary: `${def.tagline}. The road, what it asks of you first, how it is filmed — and how sure any of it is.`,
    sections: [
      { heading: 'What it is', body: def.blurb },
      {
        heading: 'The road',
        body: `${def.steps.length} steps. A step opens the next when its hold clears the bar shown, rated Clean by you and backed by film: a passing camera check, or your own review of the replay where the camera cannot grade the shape. The bars are convention, not measured thresholds.${
          twoDays.length
            ? ` ${twoDays.map((step) => step.name).join(' and ')} ask${twoDays.length === 1 ? 's' : ''} for the bar on two separate days — one long balance can be luck.`
            : ''
        }`,
        bullets: def.steps.map(
          (step, index) =>
            `${step.name} — ${lowerFirst(step.tagline).replace(/\.$/, '')}.${
              index < lastStep ? ` Bar: ${step.unlockSec}s.` : /summit/i.test(step.tagline) ? '' : ' The summit.'
            }`,
        ),
      },
      ...(ladder
        ? [
            {
              heading: `The ${lowerFirst(ladder.name)} line`,
              body: `Beside the holds runs a line of push-ups that works up to ${ladder.summit}. It moves on its own standards, not behind the holds: one filmed set of the reps shown, rated Clean and checked by you on the replay, opens the next rung. The camera does not count reps — at a few samples a second it cannot vouch for the bottom of one. ${ladder.sourcing}`,
              bullets: ladder.rungs.map((rung, index) => {
                const name = EXERCISE_BY_ID[rung.exerciseId]?.name ?? rung.exerciseId
                return index < ladder.rungs.length - 1
                  ? `${name} — ${fullReps(rung.standardReps)} in one set opens the next rung.`
                  : `${name} — ${fullReps(rung.standardReps)}: the top of the line.`
              }),
            },
          ]
        : []),
      {
        heading: 'Before you start',
        body: 'What coaches commonly ask for first. It is advice, not a gate — the app never locks a road.',
        // The kit sentence, unless a prerequisite already says it.
        bullets: [
          ...def.prerequisites,
          ...(def.requiresNote && !def.prerequisites.some((line) => sharesKitWord(line, def.requiresNote!)) ? [def.requiresNote] : []),
        ],
      },
      { heading: 'How often', body: def.frequency },
      { heading: 'Filming it', body: `${def.camera.placement} ${def.camera.honesty}` },
      {
        heading: 'Looking after yourself',
        body: 'Nothing here makes injury impossible. What is worth knowing before you load it:',
        bullets: def.safety,
      },
      { heading: 'How sure is any of this?', body: def.sourcing },
    ],
  }
}

const HAND_WRITTEN_GUIDES: Guide[] = [
  {
    id: 'start-here',
    group: 'start',
    icon: '🚦',
    title: 'Start here',
    summary: 'New to straight-arm skills? Read this once and you will know exactly what you are doing.',
    sections: [
      {
        heading: 'What this app trains',
        body: 'Five bodyweight skills, each as its own road of positions from easy to hard: the planche, the front lever, the handstand and handstand push-up, the 90° hold and the human flag. You pick the ones you want and put them in order; the first one leads every session. Each has its own guide under The skills. The rest of this page uses the planche as the example, and the same rules run every road.',
      },
      {
        heading: 'What a planche actually is',
        body: 'Holding your whole body horizontal in the air, parallel to the floor, supported only by your hands — with your arms completely straight. The straight arms are what make it so hard: the whole body is levered out in front of the shoulders, and the elbows stay locked the entire time.',
      },
      {
        heading: 'How long it takes (honestly)',
        body: 'Coaches commonly report that a tuck planche takes 3–9 months from an untrained start, a straddle planche 1.5–3 years, and a full planche 3+ years — and plenty of dedicated people never get one. Those are coaching estimates; no study has measured them. That is not discouragement — it is the reason this app measures progress in seconds gained per week rather than in weeks to the finish line, and only puts a range on your own timeline once your log can support one. If you want a target that arrives soon, aim at the next unlock, not at the summit.',
      },
      {
        heading: 'Your first four weeks',
        body: 'Do not chase the hardest position you can wobble into. Spend the first weeks learning the basics well — every later position is the same shape with a longer lever.',
        bullets: [
          'Train 3 days a week with at least one rest day between sessions.',
          'Sessions start with a short wrist preparation — a moment to notice how your wrists feel before loading them. It is preparation, not protection. Wrist pain is common among gymnasts, the closest group anyone has studied.',
          'Come down at the target call — or sooner, the moment the shape goes. Working targets sit well inside your max on purpose, and coaches generally prefer practising seconds in a good position to grinding to failure. Your max is measured on its own, about every three weeks, with one max clean hold.',
          'Film yourself from the side once a week. Video can reveal what you cannot feel, but automated estimates can be wrong — confirm the position yourself.',
        ],
      },
      {
        heading: 'What you need',
        body: 'For the first two steps: nothing but floor space. Once you reach tuck planche work, a pair of parallettes is the purchase most worth making — the neutral grip takes your wrists out of extreme extension, and many people find it easier and stronger. A resistance band becomes useful around straddle work.',
      },
      {
        heading: 'How to use this app',
        body: 'Open Train and hit the recommended session — it is built for your current step, adapts to how rested you are, and fits your time budget. The app times every hold, logs it, and moves you up the road when a hold clears the unlock bar with your Clean rating and a passing filmed check. You never have to plan anything.',
      },
    ],
  },
  {
    id: 'mixing-skills',
    group: 'start',
    icon: '🧩',
    title: 'Training more than one skill',
    summary: 'How a session is shared between your skills, why the order you put them in matters, and what is convention rather than evidence.',
    sections: [
      {
        heading: 'Your order is the plan',
        body: 'The first skill in your list leads every session: it comes first while you are fresh and gets the fullest dose. Change the order in Settings whenever your priority changes — nothing is lost, each road keeps its own step, records and history.',
      },
      {
        heading: 'How many skills fit in a session',
        body: 'It depends on the time you gave the app. Under 25 minutes there is room for one strength skill; up to 50, two; longer than that, three. Those cut-offs are this app’s design: coaches’ own figures for how many skills to train at once differ — one or two, two to four, up to five — and none of them was measured.',
        bullets: [
          'The second place goes to the skill that has waited longest for a full part, weighted by your order — your second priority gets it about twice as often as your third — with a preference for a skill that loads different joints, such as a pull beside a push.',
          'A third skill gets a maintenance dose: its key hold, a couple of sets, nothing else. Coaches report that about once a week holds a movement while it progresses slowly; that has been measured for ordinary strength training, not for these holds. It does not count as having trained the skill.',
          'Handstand balance practice rides along at the start of a session. It is light on the joints and is practised best fresh.',
          'When a session only fits one skill, your skills take turns, and your first priority still comes round about twice as often as the others.',
        ],
      },
      {
        heading: 'One maximal effort a session',
        body: 'An unlock attempt or a max re-test is an all-out hold, and a session holds one. It is your lead skill’s by default; when the lead had it last time and another skill has one waiting, that skill takes today’s. Every skill is measured in turn, so no road’s targets are left to go stale.',
      },
      {
        heading: 'A sore joint changes every skill that loads it',
        body: 'Each skill names the joints it loads hardest. Report an elbow and the planche, the front lever, the 90° hold and the flag are all lightened or left out for the day — a different skill is not a way around a joint that hurts.',
      },
      {
        heading: 'How sure is any of this?',
        body: 'Which skills share a session, in what order and at what share of the time follows common coaching practice and this app’s own design. No trial has compared ways of combining these skills, so read the line-up as a sensible default rather than a finding.',
      },
    ],
  },
  {
    id: 'safety',
    group: 'method',
    icon: '🛡️',
    title: 'Looking after your joints',
    summary: 'No routine makes injury impossible. What the app does to keep the risk down, and what to do when something hurts.',
    sections: [
      {
        heading: 'Fast gains are mostly skill',
        body: 'Early strength gains are largely your nervous system learning the position: in one small study, strength rose by about a third in two months while muscle size and tendon stiffness had not changed. So when your holds jump, the app holds volume steady rather than raising it to match, and keeps progressions boring. (The popular line that tendons lag muscle by a set number of months is not what that research found.)',
      },
      {
        heading: 'Prepare, then check in',
        body: 'Sessions start with two or three minutes of wrist circles, wrist rocks, scapula push-ups and one easy lean. That is preparation, not protection — no trial has shown a warm-up prevents injury in strength training — but it is a good moment to notice how your joints feel before loading them.',
      },
      {
        heading: 'Pain rules',
        body: 'Muscle burn and shaking are fine. Joint pain is not.',
        bullets: [
          'Sharp wrist pain: stop the hold. Do not keep loading a painful wrist to finish the session — parallettes change the wrist angle, but they do not explain or clear the pain.',
          'New or worsening joint pain: stop the movement that reproduces it rather than trying to diagnose the tissue from location alone.',
          'Shoulder pinching or elbow/wrist pain: unload it, note what provokes it, and avoid coaching yourself through a painful range.',
          'Severe, worsening or persistent pain deserves assessment by a qualified clinician rather than a fixed app protocol.',
        ],
      },
      {
        heading: 'Easy weeks are a convention',
        body: 'Many coaches schedule a week at roughly half volume every 4–6 weeks, and there is a Deload Flow session ready for one. The two controlled trials of planned deloads did not detect a strength benefit, so treat it as a pressure valve for fatigue, soreness or a busy week rather than the week strength appears.',
      },
    ],
  },
  {
    id: 'how-progress-works',
    group: 'method',
    icon: '📈',
    title: 'How progress actually happens',
    summary: 'Why seconds bounce around, what to measure, and when to move up.',
    sections: [
      {
        heading: 'Seconds are noisy — trends are not',
        body: 'A 12-second day after a 16-second day usually means very little. Sleep, caffeine, stress and how recently you trained all move a max hold, often by more than people expect — the app measures your own day-to-day swing rather than assuming one. Judge yourself on trends over a couple of weeks, which is what the Progress charts and the coach look at.',
      },
      {
        heading: 'Why you hold below your maximum',
        body: 'Working sets sit at roughly 60% of your recent best. That looks too easy, and it is meant to: it lets you collect seconds in a good position and leaves room to recover. The 60% is this app’s design choice, in line with common coaching practice rather than a measured optimum — and your ceiling is re-measured about every three weeks: a session that is due opens with one max clean hold, or you can run a full max test yourself.',
      },
      {
        heading: 'When to move up a step',
        body: 'When you clear the unlock bar on the step key exercise with two signals: you explicitly rate the hold Clean, and its filmed form check passes with no more than one isolated flag. Frog Stand uses an explicit replay-and-checklist review because its balance shape is not honest for the pose model to grade. The bars themselves are convention, not measured thresholds — credible coaches’ standards differ several-fold — so many would rather you own a step with clean seconds to spare than scrape past it.',
      },
      {
        heading: 'The next step can open early',
        body: 'Once your current hold is past half its bar, sessions start with a few short attempts at the next shape. Hold that next shape’s opening dose clean — your Clean rating, a passing camera check and, for flight skills, both feet off confirmed — and the next step opens without waiting for the full bar. The bar is a convention; holding the next shape is the readiness it was standing in for.',
      },
      {
        heading: 'Little and often',
        body: 'Coaches generally prefer three focused sessions a week to one exhausting weekly marathon: planche is a skill as much as a strength feat, and skills are practised best fresh. That is coaching consensus — no trial has compared the two for planche. With total work equal, how it is split has made little measured difference in strength research; the real gain from a second session is the extra practice it adds.',
      },
    ],
  },
  {
    id: 'fastest-path',
    group: 'method',
    icon: '🚀',
    title: 'The fastest honest path',
    summary:
      'How every session is built, why the next shape is practised early, and what the app does at each transition. Written around the planche — lean to frog, frog to tuck, tuck to advanced tuck and on to full — and the same ideas shape every road.',
    sections: [
      {
        heading: 'Every session, every level',
        body: 'Each recommended session has the same shape so nothing important depends on the clock: warm-up, your key holds, the push-up version of your step, pseudo planche push-ups, planche leans, then core and a cooldown. When time is short the app trims generic core and mobility first and keeps at least two sets of each strength block; it tells you what it left out.',
        bullets: [
          'The push-up version of each step — tuck planche push-ups at the tuck, and so on — trains the bent-arm half of the position a hold never visits. Until your hold is halfway to its bar, you press one step behind.',
          'Accessories progress on their own: every set at target means a little more next time; most sets short means the next session matches what you did.',
          'Inside a session, the next set follows the last: a hold that blew past its target raises the next one a little, two short holds bring it down, and a big drop-off suggests moving on.',
          'The “Target” call comes when you have actually held the target — come down at it. The time it takes to get back to your phone comes off the logged hold, never off the call.',
        ],
      },
      {
        heading: 'Practise the next shape early',
        body: 'Strength from holding a position is largely specific to that position, so the fastest way to a new shape is to practise that shape. Once your current hold is halfway to its bar, sessions open with a few short attempts at the next step while you are fresh — one to three clean seconds is a real attempt — followed by the drill that teaches the change. The frog stand starts from day one at the lean: it is balance more than strength.',
        bullets: [
          'Tuck → advanced tuck adds the open-and-close drill and arch holds for the flat back, and the Home screen shows the hip angle the camera measures on your filmed tucks moving toward the advanced tuck’s.',
          'Advanced tuck → one-leg swaps in one-leg leans; one-leg → straddle adds band-assisted straddle work and compression; straddle → full narrows the legs a little at a time.',
          'Next-shape attempts only happen on days that allow a maximal effort, never beside an unlock attempt and never on an easy day.',
        ],
      },
      {
        heading: 'A busy day still counts',
        body: 'When a full session will not happen, the minimum dose on Home keeps the position trained: a short wrist warm-up, then five short, maximal holds at the hardest shape you can keep clean — the next shape once your bridge is open. Brief maximal holds raised strength in small trials on simpler movements; none tested the planche, so treat it as a way to keep the thread on a busy day, not a replacement for your sessions.',
        bullets: [
          'It is offered only on days a maximal effort would be: not after a hard session yesterday, not in an easy week, not while your form is being repaired, and once a day at most.',
          'It never changes your targets or counts toward your weekly sessions — it is extra.',
        ],
      },
      {
        heading: 'What it will not do to go faster',
        body: 'It will not add volume because you got stronger quickly — fast gains are mostly your nervous system, and the tissue carrying the load has not caught up. It will not let a sore elbow or a wrist complaint that keeps coming back ride along with next-shape attempts. And it will not count a hold the camera saw bent, or did not see, as clean.',
      },
      {
        heading: 'How sure is any of this?',
        body: 'Practising the next position early, the push-up versions, the drills and the trimming order are coaching consensus and this app’s design — sensible, widely used, and never compared in a trial. The lever percentages are the app’s mechanical model. No timeline is promised, because none is known.',
      },
    ],
  },
  {
    id: 'rpe',
    group: 'method',
    icon: '🎚️',
    title: 'Understanding RPE',
    summary: 'The 6–10 score you give after each session, and why it changes your next one.',
    sections: [
      {
        heading: 'What the numbers mean',
        body: 'RPE is Rate of Perceived Exertion — simply how hard the session felt overall.',
        bullets: [
          '6 — Easy. Could have done a lot more.',
          '7 — Comfortable. A few solid sets left in the tank.',
          '8 — Hard but clean. This is the target for most sessions.',
          '9 — Very hard. Form was starting to fray by the end.',
          '10 — Everything you had. Nothing left.',
        ],
      },
      {
        heading: 'Why it matters here',
        body: 'The app reads your RPE. Log a 9 or 10 and, if you train again the next day, that day becomes a lighter Technique Day so fatigue does not stack on fatigue. The coach also marks down approaches that leave you at RPE 9 without any gain — in a log, that is what grinding looks like.',
      },
      {
        heading: 'Be honest, not tough',
        body: 'Reporting an 8 when it was really a 10 does not make you stronger; it just feeds the app bad data, and the plan is only as good as the log it reads.',
      },
    ],
  },
  {
    id: 'camera-judge',
    group: 'method',
    icon: '🎥',
    title: 'How the camera judge works',
    summary:
      'What the form check actually measures, what it deliberately refuses to guess at, and how you can test it yourself.',
    sections: [
      {
        heading: 'What happens when you film a set',
        body: 'Everything runs on your device. The clip is sampled a few times per second, a pose model estimates where your joints are in each sampled frame, and plain geometry turns those points into angles: how straight the elbows were, where the hips sat relative to the shoulders, how far the shoulders travelled past the hands. No footage, landmarks or results ever leave your phone — there is no server to send them to.',
      },
      {
        heading: 'Each position is judged by its own rules',
        body: 'A tuck planche is supposed to have bent knees and closed hips, so those are never faults there. Each step on the road has a profile saying which checks apply and how strict they are — the standards tighten as the lever gets longer, exactly like a judge scoring harder skills.',
      },
      {
        heading: 'Measuring strictly, accusing carefully',
        body: 'The 0–100 score starts deducting for small deviations, the way a gymnastics judge deducts inside deduction bands. But a red fault flag is a stronger claim, so it has a higher bar: the measurement must be clearly beyond what camera error can explain, and it must persist for around a second. One noisy frame can never convict you.',
        bullets: [
          'Every tolerance was set by measurement, not taste: synthetic holds of known angle were swept through the checker to find where real faults are always caught and clean holds are never accused.',
          'Verified clean time ends when the position breaks down and stays broken — or when the camera simply loses the evidence. A quick drop cannot bank extra seconds.',
          'When the camera and your own rating disagree, your word stands. The camera files its reading alongside, and the coach only learns from clips where you both broadly agree.',
          'A late softening counts: if the elbows hold their lock and then stay softer for the rest of the hold, verified time ends where the softening started and the seconds before it still count.',
          '"Verified clean" has three answers, not two — the verified seconds, none (a bend held inside the hold), or unknown (the elbows were not judged, or the camera saw too little of the hold).',
        ],
      },
      {
        heading: 'What it refuses to guess at',
        body: 'One camera sees a flat picture, and this app would rather admit that than bluff. Anything it cannot measure honestly is said out loud rather than silently skipped.',
        bullets: [
          'Front-on or strongly angled clips are refused outright — elbow, hip and lean angles are foreshortened and would be misleading.',
          'A joint the model places outside the picture is not treated as seen, however confident the model is about it.',
          'Steadiness is measured against your planted hands, so a phone that moves mostly cancels out — and it describes how much you moved, never why.',
          'The live elbow cue (beta, in Settings) speaks during a filmed hold only after every reading for about a second has shown a clear bend, and never in the first second while you settle in.',
          'A body part without enough clear frames is reported as “unseen”, not guessed. An unseen elbow blocks progression credit; an unseen knee only costs the knee verdict.',
          'Scapular protraction, true depth, and elbows flared toward the camera are physically invisible from the side — which is why a Clean rating and true-flight confirmation stay yours to give.',
        ],
      },
      {
        heading: 'Other skills, other views',
        body: 'The planche and the 90° hold are judged side-on in a support position. The other skills are different shapes seen from different places, and each is held to what the camera can actually see from there.',
        bullets: [
          'Front lever: side-on to the bar. Which way is down is worked out from where your weight hangs below your hands, so a plain hang is read as a hang with the hips low — not as a level lever filmed on its side — whichever way the phone was held.',
          'Handstand: side-on, with the picture the right way up. The camera reads how open the shoulders are and whether hips and legs continue that line. A picture on its side or upside down is refused: from the joints alone, a handstand turned over is someone standing with their arms up. It cannot tell a foot resting on the wall from a free balance — you confirm that.',
          'Human flag: front-on, facing your chest — the one skill a side view is useless for. The pole is taken from the line between your hands, and an oblique shot is refused.',
          'In all three, elbows are read coarsely: a straight arm that is hanging, upside down or seen from the front already reads well short of straight through the model, so only a large bend is called. The result shows no score for the arms there, and a hold counts toward the next step only once you have watched the replay and confirmed the lockout yourself.',
          'A plain hang, the frog stand and the first flag positions have no shape the camera can grade honestly. They are filmed all the same, and your own check of the replay against a short list is the evidence.',
          'Push-up sets on the handstand push-up and 90° push-up lines are filmed for you, not for the camera: it does not count reps. You watch the replay and pass the set against that rung’s list.',
        ],
      },
      {
        heading: 'If you cannot film',
        body: 'Unlocks ask for a filmed check because "verified" has to mean something, and a 2D side view is the only evidence the app can actually inspect. But training somewhere you will not set up a phone is a normal situation, not a failure — so it is not a dead end.',
        bullets: [
          'Your holds still count as real PRs, and the coach still learns which session shapes work on you from them. Only the unlock bar wants footage.',
          'When you are genuinely training a step, open it from the Path and place yourself there after the three-part safety check. That is the intended route, not a cheat — it simply records the step as chosen rather than camera-verified.',
          'If you can film but the judge keeps refusing your clips, that is a framing problem worth solving once: side-on, whole body hands-to-feet in frame, light in front of you rather than behind.',
        ],
      },
      {
        heading: 'Check it yourself',
        body: 'The judge is tested against skeletons built from known angles and against real photographs the thresholds were calibrated on — including photos it must refuse. The same bench ships inside this app: build a pose with angles you choose, watch what the judge says, run the full self-test on your own phone, or feed it your own clip.',
        link: { href: '#devlab', label: 'Open the judge’s bench' },
      },
    ],
  },
  {
    id: 'equipment',
    group: 'start',
    icon: '🧰',
    title: 'Equipment guide',
    summary: 'What is worth buying, when, and what you can safely ignore.',
    sections: [
      {
        heading: 'Steps 1–2: nothing',
        body: 'Foundations and planche leans need floor space and nothing else. If your wrists complain on the floor, you can do leans on your fists or on push-up handles.',
      },
      {
        heading: 'Steps 3+: parallettes (highly recommended)',
        body: 'A low pair of parallettes puts your wrists in a neutral grip instead of deep extension. Many people find them easier on the wrists and gain seconds straight away — but a grip change does not explain or clear wrist pain; if a hold hurts, stop it. Cheap wooden ones are fine; low ones (15–30cm) are more useful than tall ones for planche work.',
      },
      {
        heading: 'Straddle work: a resistance band',
        body: 'Hung from a pull-up bar and looped under your hips, a band lets you rehearse the true straddle shape long before you can hold it unassisted. Put the band at the hips, never the knees — at the knees it tips you forward.',
      },
      {
        heading: 'For the other skills',
        body: 'Each road says what it cannot be trained without, and the app holds a skill back rather than programme work you have no kit for.',
        bullets: [
          'Front lever: something to hang from — a pull-up bar or rings. A long resistance band helps rehearse the longer shapes.',
          'Handstand and handstand push-up: a clear wall. A stable box or step opens the feet-elevated pike push-up; parallettes open the deficit rung.',
          '90° hold: floor space is enough. Parallettes make the tuck versions easier on the wrists.',
          'Human flag: a vertical pole or a ladder-style frame that is anchored and will not turn in your hands. Check it before every session.',
        ],
      },
      {
        heading: 'Nice to have',
        body: 'A phone tripod (for the videos that keep you honest) and chalk if your hands sweat. That is genuinely the whole list. You do not need weights or a gym membership for any of this.',
      },
    ],
  },
  {
    id: 'free-references',
    group: 'method',
    icon: '🎬',
    title: 'Free references worth watching',
    summary: 'Six screened free videos for specific questions — what each is good for, and what not to take from it.',
    sections: [
      {
        heading: 'How these were chosen',
        body: 'Each answers one specific question. Titles and creators were checked, and each creator’s own description or written companion was read — the footage itself was not reviewed frame by frame, so none of these is an app lesson or a programme to follow in order. Links open a search, because availability differs by region. Nothing here changes your plan or your unlock bars.',
      },
      {
        heading: 'Keep your lean comparable — FitnessFAQs, “The Worst Planche Problem (FIXED!)” (5:30)',
        body: 'A wall reference for keeping forward lean the same from set to set, so a longer hold is not quietly bought by leaning less. Use it as a comparison aid, not a rule: no wall distance or maximum lean follows from it, and never support bodyweight through your head against the wall.',
        link: { href: 'https://www.youtube.com/results?search_query=FitnessFAQs+The+Worst+Planche+Problem+%28FIXED%21%29', label: 'Find it on YouTube' },
      },
      {
        heading: 'A repeatable setup toward the tuck — GMB Fitness, “Planche Progression: Step by Step” (5:00)',
        body: 'Setup and progression overview with a written companion. Useful for describing one repeatable starting position. Its knee-on-arm crane is a different, supported skill from an unsupported straight-arm tuck, and its own hold targets and extra training days are not part of this app’s plan.',
        link: { href: 'https://www.youtube.com/results?search_query=GMB+Fitness+Planche+Progression+Step+by+Step+Wrists+and+Shoulders+Included', label: 'Find it on YouTube' },
      },
      {
        heading: 'Options after a controlled tuck — GMB Fitness, “Straddle Planche Tutorial” (1:13)',
        body: 'A short demonstration of open-tuck, partial-straddle and leg-extension options. Vocabulary for later stages, once a tuck is genuinely under control — not a programme, and not a reason to try an unfamiliar unsupported shape.',
        link: { href: 'https://www.youtube.com/results?search_query=GMB+Fitness+Straddle+Planche+Tutorial', label: 'Find it on YouTube' },
      },
      {
        heading: 'Planche push-ups are not one exercise — FitnessFAQs, “How To Planche Push-Up (BEST PROGRESSIONS)” (7:16)',
        body: 'Covers feet-supported pseudo planche push-ups through band-assisted and advanced variations. The beginner-to-advanced range is what the video spans, not permission to do every variation; the band options need equipment and a safe anchor.',
        link: { href: 'https://www.youtube.com/results?search_query=FitnessFAQs+How+To+Planche+Push-Up+BEST+PROGRESSIONS', label: 'Find it on YouTube' },
      },
      {
        heading: 'Advanced examples, on a separate shelf — GMB Fitness, “Planche and Tuck Variations” (2:09)',
        body: 'Advanced transitions such as handstand lowering and L-sit to planche. Later-stage context for someone already working with appropriate instruction — not a warm-up and not a challenge to attempt.',
        link: { href: 'https://www.youtube.com/results?search_query=GMB+Fitness+Planche+and+Tuck+Variations', label: 'Find it on YouTube' },
      },
      {
        heading: 'Before adding more drills — Steven Low, Overcoming Gravity Online Part 28 (bonus): programming isometric holds after a plateau',
        body: 'A free, readable programming discussion that separates specific isometric work, related dynamic strength and supplementary work. Aimed at advanced learners. Its sample volumes and some older mechanistic explanations are not universal defaults or current scientific consensus, and a plateau discussion is not a diagnosis of yours.',
        link: { href: 'https://www.youtube.com/results?search_query=Steven+Low+Overcoming+Gravity+Online+Part+28+Bonus+Programming+for+Advanced+Isometric+Holds+after+a+Plateau', label: 'Find it on YouTube' },
      },
      {
        heading: 'What these do not cover',
        body: 'Scapular regressions, hollow-body options, a supported L-sit and wrist preparation are better learned from the exercise cards here. These six are all about the planche: no video for the other four skills has been screened to the same standard yet, so none is listed. Watching a video never establishes readiness — your own controlled, filmed holds do.',
      },
    ],
  },
]

/** Every guide: the hand-written ones, and one per skill built from its definition. */
export const GUIDES: Guide[] = [...HAND_WRITTEN_GUIDES, ...SKILL_LIST.map(skillGuide)]

export interface GlossaryTerm {
  term: string
  short: string
  detail: string
}

export const GLOSSARY: GlossaryTerm[] = [
  {
    term: 'Protraction',
    short: 'Pushing your shoulder blades apart',
    detail:
      'Actively pushing the floor away so your upper back rounds gently and your shoulder blades spread. Coaches treat it as a core planche cue. A side-on camera cannot see it, which is why it is part of your own Clean rating.',
  },
  {
    term: 'Retraction',
    short: 'Squeezing your shoulder blades together',
    detail:
      'The opposite of protraction. Useful in rows and pull-ups, but the enemy in a planche — if your chest sags between your shoulder blades, you have lost protraction.',
  },
  {
    term: 'Scapula',
    short: 'Your shoulder blade',
    detail:
      'The flat triangular bone that slides across your ribcage. Controlling it is a big part of straight-arm work, which is why scapula push-ups appear in the warm-ups.',
  },
  {
    term: 'Hollow body',
    short: 'Ribs down, lower back flat, body slightly banana-shaped',
    detail:
      'The gymnastics core position: press your lower back toward the floor, tuck your ribs, squeeze your glutes. Coaches use it to teach the trunk position that keeps the hips from sagging in a hold.',
  },
  {
    term: 'Lean',
    short: 'How far your shoulders travel past your hands',
    detail:
      'The further forward your shoulders go, the more of your bodyweight your shoulders carry — and the closer the exercise gets to a real planche. Lean is the main intensity dial in early training.',
  },
  {
    term: 'Lever / lever length',
    short: 'How far your mass sits from your hands',
    detail:
      'A tuck planche has a short lever (knees at your chest); a full planche has the longest possible one. Every step on the road is the same skill with a longer lever, which is why straddling wide makes a planche easier.',
  },
  {
    term: 'Isometric',
    short: 'A hold, not a rep',
    detail:
      'A contraction with no movement. Almost all planche training is isometric, which is why this app measures seconds instead of reps.',
  },
  {
    term: 'Time under tension (TUT)',
    short: 'Total seconds spent holding',
    detail:
      'The main volume measure for isometric training. Your dashboard tracks it across all sessions — it is a better measure of work done than session count.',
  },
  {
    term: 'PPPU',
    short: 'Pseudo planche push-up',
    detail:
      'A push-up with your hands low, toward the waist, and your shoulders leaning forward past them. Bent-arm pressing support that many planche programmes include — kept separate from straight-arm skill time, and not a planche in disguise.',
  },
  {
    term: 'RPE',
    short: 'Rate of perceived exertion (6–10)',
    detail:
      'How hard a session felt. You log it after each session and the app adapts the next one accordingly. See the RPE guide for the full scale.',
  },
  {
    term: 'Deload',
    short: 'A deliberately easy week',
    detail:
      'Roughly half your normal volume at easy targets, taken every 4–6 weeks by coaching convention. The two controlled trials of deloads found no strength benefit, so treat it as a pressure valve for fatigue and busy weeks — not as the week strength appears.',
  },
  {
    term: 'Straddle',
    short: 'Legs straight and spread wide apart',
    detail:
      'Spreading the legs pulls your mass closer to your hands, shortening the lever. A wider straddle is a genuinely easier planche, which is why pancake mobility work is on the plan.',
  },
  {
    term: 'Pancake',
    short: 'A wide-legged seated forward fold',
    detail:
      'The mobility drill for a wider straddle. A wider straddle shortens the lever, which is why pancake work appears once a straddle is in view.',
  },
  {
    term: 'Tuck',
    short: 'Knees pulled in to your chest',
    detail:
      'The shortest-lever planche position and the first one most people can actually hold. Everything above it is the same shape with the legs progressively extended.',
  },
  {
    term: 'Back-off set',
    short: 'Easier work after your hard work',
    detail:
      'Extra volume on a position you already own, done after the main sets. It keeps old positions sharp without adding much fatigue.',
  },
  {
    term: 'Progressive overload',
    short: 'Gradually asking for slightly more',
    detail:
      'Adding a little time, a little lean, or a longer lever over weeks. The app handles this for you: working targets follow your recent bests, and a max clean hold about every three weeks — inside a session — re-measures the ceiling.',
  },
  {
    term: 'Front lever',
    short: 'Level under a bar, face up, arms straight',
    detail:
      'The planche’s pulling counterpart: hanging with the body held level. The road goes tuck, advanced tuck, one leg, straddle, full — the same lever-lengthening idea as the planche.',
  },
  {
    term: 'Depression (shoulders)',
    short: 'Pulling the shoulders down, away from the ears',
    detail:
      'What an active hang and every lever start with. A side-on camera cannot see the shoulder blades, so it is part of your own Clean rating.',
  },
  {
    term: 'Stacked',
    short: 'Hands, shoulders, hips and feet in one vertical line',
    detail:
      'The handstand’s standard. From the side the camera reads how open the shoulders are and whether the hips and legs continue the line; a banana-shaped back shows up as closed shoulders or hips out of line.',
  },
  {
    term: 'Bail',
    short: 'A planned way out of a handstand',
    detail:
      'Stepping down from the wall, or a quarter-turn out of a free handstand. Coaches teach it before the balance itself.',
  },
  {
    term: 'Kip',
    short: 'A kick or swing that helps a rep',
    detail:
      'Using the legs or momentum to get through the hard part of a push-up or pull. A kipped rep is a different, easier rep — the push-up lines count strict reps only.',
  },
  {
    term: 'Negative',
    short: 'Only the lowering half of a rep',
    detail:
      'Lowering slowly through a movement you cannot yet press back out of. The handstand push-up and 90° push-up lines both use them as a rung.',
  },
  {
    term: 'Rung',
    short: 'One movement on a push-up line',
    detail:
      'The handstand push-up and 90° push-up lines are ladders of movements. A rung opens the next one on a standard: one filmed set of that many full reps, rated Clean and checked by you on the replay.',
  },
  {
    term: 'Line-up',
    short: 'Which skills share today’s session',
    detail:
      'With more than one skill, each session has a lead (your first priority), often a partner with a full part of its own, and sometimes a maintenance dose for a third. The session screen says who is doing what, and why.',
  },
  {
    term: 'Maintenance dose',
    short: 'A couple of sets to keep a position',
    detail:
      'A skill’s key hold at its current step, two sets, nothing else — meant to keep the position practised on days the skill is not being trained in full. What dose actually maintains one of these holds has not been measured. It does not count as a training day for that skill.',
  },
  {
    term: 'Replay review',
    short: 'Your own check of the clip',
    detail:
      'Where the camera cannot grade a shape honestly — a plain hang, the frog stand, the first flag holds, and every push-up set — the set is still filmed, and you pass it against a short list while watching the replay. That review is the evidence.',
  },
]
