export interface GuideSection {
  heading: string
  body: string
  bullets?: string[]
}

export interface Guide {
  id: string
  icon: string
  title: string
  summary: string
  sections: GuideSection[]
}

export const GUIDES: Guide[] = [
  {
    id: 'start-here',
    icon: '🚦',
    title: 'Start here',
    summary: 'Never trained for a planche before? Read this once and you will know exactly what you are doing.',
    sections: [
      {
        heading: 'What a planche actually is',
        body: 'Holding your whole body horizontal in the air, parallel to the floor, supported only by your hands — with your arms completely straight. The straight arms are what make it brutally hard: your shoulders and biceps tendons carry a load that no push-up ever asks for.',
      },
      {
        heading: 'How long it takes (honestly)',
        body: 'A tuck planche usually takes 3–9 months from an untrained start. A straddle planche is often 1.5–3 years. A full planche can take 3+ years, and plenty of dedicated people never get one. That is not discouragement — it is the reason this app measures progress in seconds gained per week rather than in weeks to the finish line. If you want a target that arrives soon, aim at the next unlock, not at the summit.',
      },
      {
        heading: 'Your first four weeks',
        body: 'Do not chase the hardest position you can wobble into. Spend the first weeks earning the basics, and everything after them arrives faster.',
        bullets: [
          'Train 3 days a week with at least one rest day between sessions.',
          'Every session starts with the wrist warm-up. Non-negotiable — wrist pain is the #1 reason people quit.',
          'Finish each hold about 2 seconds before you would collapse. Grinding to failure teaches bad positions.',
          'Film yourself from the side once a week. Video can reveal what you cannot feel, but automated estimates can be wrong — confirm the position yourself.',
        ],
      },
      {
        heading: 'What you need',
        body: 'For the first two steps: nothing but floor space. Once you reach tuck planche work, a pair of parallettes is the single best purchase you can make — the neutral grip takes your wrists out of extreme extension and usually buys you extra seconds immediately. A resistance band becomes useful around straddle work.',
      },
      {
        heading: 'How to use this app',
        body: 'Open Train and hit the recommended session — it is built for your current step, adapts to how rested you are, and fits your time budget. The app times every hold, logs it, and moves you up the road automatically when you clear an unlock bar. You never have to plan anything.',
      },
    ],
  },
  {
    id: 'safety',
    icon: '🛡️',
    title: 'Staying injury-free',
    summary: 'Straight-arm training loads tendons harder than muscles. Here is how not to get hurt.',
    sections: [
      {
        heading: 'Tendons adapt slower than muscles',
        body: 'Your shoulders will feel strong enough to push harder weeks before your biceps tendons and wrists are ready for it. That gap is where injuries happen. When in doubt, add sessions rather than intensity, and keep progressions boring.',
      },
      {
        heading: 'Warm up every single time',
        body: 'Two to three minutes: wrist circles, wrist rocks, scapula push-ups, one easy lean. The generated sessions do this for you automatically. Cold wrists under a planche lean is how people end up taking three months off.',
      },
      {
        heading: 'Pain rules',
        body: 'Muscle burn and shaking are fine. Joint pain is not.',
        bullets: [
          'Sharp wrist pain: stop, switch to parallettes, reduce lean depth.',
          'New or worsening joint pain: stop the movement that reproduces it rather than trying to diagnose the tissue from location alone.',
          'Shoulder pinching or elbow/wrist pain: unload it, note what provokes it, and avoid coaching yourself through a painful range.',
          'Severe, worsening or persistent pain deserves assessment by a qualified clinician rather than a fixed app protocol.',
        ],
      },
      {
        heading: 'Deload on purpose',
        body: 'Every 4–6 weeks, take a week at roughly half volume with easy targets (there is a Deload Flow session ready for you). Strength is built during recovery, not during the hard sessions. Skipping deloads is slower, not faster.',
      },
    ],
  },
  {
    id: 'how-progress-works',
    icon: '📈',
    title: 'How progress actually happens',
    summary: 'Why seconds bounce around, what to measure, and when to move up.',
    sections: [
      {
        heading: 'Seconds are noisy — trends are not',
        body: 'A 12-second day after a 16-second day means almost nothing. Sleep, caffeine, stress, and how recently you trained all swing a max hold by 20% or more. Judge yourself on two-week trends, which is exactly what the Progress charts and the coach look at.',
      },
      {
        heading: 'Why you hold below your maximum',
        body: 'Working sets sit at roughly 60% of your best hold. That looks too easy, and that is the point: it lets you accumulate quality seconds in a good position without wrecking your recovery. Maxing out every session produces fast progress for three weeks and a plateau for three months.',
      },
      {
        heading: 'When to move up a step',
        body: 'When you clear the unlock bar on the step key exercise with two signals: you explicitly rate the hold Clean, and its filmed form check passes with no more than one isolated flag. Frog Stand uses an explicit replay-and-checklist review because its balance shape is not honest for the pose model to grade. The bars are minimums, not targets — banking a few extra clean seconds before moving on makes the next step arrive faster, not slower.',
      },
      {
        heading: 'Consistency beats heroics',
        body: 'Three focused 30-minute sessions a week will outrun one exhausting weekly marathon every time. Planche is a skill as much as a strength feat, and skills want frequent, fresh practice.',
      },
    ],
  },
  {
    id: 'rpe',
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
        body: 'The app reads your RPE. Log a 9 or 10 and the next day becomes a lighter Technique Day so the hard work turns into strength instead of accumulated fatigue. The coach also penalises strategies that leave you at RPE 9 without producing any gain — that is the signature of grinding, and it is the fastest way to stall.',
      },
      {
        heading: 'Be honest, not tough',
        body: 'Reporting an 8 when it was really a 10 does not make you stronger; it just feeds the app bad data and slows you down.',
      },
    ],
  },
  {
    id: 'equipment',
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
        body: 'A low pair of parallettes puts your wrists in a neutral grip instead of deep extension. Most people gain seconds immediately and stop having wrist pain. Cheap wooden ones are fine; low ones (15–30cm) are more useful than tall ones for planche work.',
      },
      {
        heading: 'Straddle work: a resistance band',
        body: 'Hung from a pull-up bar and looped under your hips, a band lets you rehearse the true straddle shape long before you can hold it unassisted. Put the band at the hips, never the knees — at the knees it tips you forward.',
      },
      {
        heading: 'Nice to have',
        body: 'A phone tripod (for the side-view videos that keep you honest) and chalk if your hands sweat. That is genuinely the whole list. You do not need rings, weights, or a gym membership for any of this.',
      },
    ],
  },
]

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
      'Actively pushing the floor away so your upper back rounds slightly and your shoulder blades spread. This is the single most important planche cue — without it, the hold gets dramatically heavier and your shoulders take a worse angle.',
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
      'The flat triangular bone that slides across your ribcage. Planche strength is largely about controlling it, which is why scapula push-ups appear in every warm-up.',
  },
  {
    term: 'Hollow body',
    short: 'Ribs down, lower back flat, body slightly banana-shaped',
    detail:
      'The gymnastics core position: press your lower back toward the floor, tuck your ribs, squeeze your glutes. It stops your hips sagging in every hold on the road.',
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
      'A push-up with your hands down by your waist and your shoulders leaning forward past them. The closest thing to a planche you can train with bent arms, and the best dynamic strength builder on the road.',
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
      'Roughly half your normal volume at easy targets, taken every 4–6 weeks. Adaptation lands during easy weeks — deloads make you faster, not slower.',
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
      'The mobility drill that widens your straddle. Two sessions a week quietly makes your straddle planche cheaper to hold.',
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
      'Adding a little time, a little lean, or a longer lever over weeks. The app handles this for you by nudging your working targets up whenever you hit most of your sets.',
  },
]
