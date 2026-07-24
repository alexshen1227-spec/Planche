export interface Tip {
  title: string
  body: string
}

export const TIPS: Tip[] = [
  { title: 'Straight arms are the whole game', body: 'A bent-arm planche is a different exercise. If the elbows bend, shorten the hold or regress the step — never trade lockout for seconds.' },
  { title: 'Film from the side', body: 'Your proprioception lies, especially about flat backs and hip height. A 10-second side video tells the truth every time.' },
  { title: 'Stop two seconds early', body: 'Isometrics respond best around RPE 8. End each hold ~2s before collapse; the ugly shaking seconds mostly train bad positions.' },
  { title: 'Warm wrists, long career', body: 'Two minutes of circles, rocks and palm lifts before every session. Wrist pain is the #1 reason people quit planche training.' },
  { title: 'Rest like you mean it', body: 'Between hard sets, take 2–3 minutes. Straight-arm strength is neural — fatigue stacking just teaches worse positions.' },
  { title: 'Tendons are slower than muscles', body: 'Your delts adapt in weeks; your biceps tendons take months. If a joint aches, cut lean/planche volume before it becomes a real issue.' },
  { title: 'Protraction is the engine', body: 'Push the floor away until your upper back rounds. If the chest sags between the shoulder blades, the serratus is off duty and the hold gets heavier.' },
  { title: 'The lean never retires', body: 'Even straddle-level athletes keep planche leans as a main lift. It is the safest way to overload the exact position.' },
  { title: 'Parallettes are a cheat code', body: 'A neutral grip takes the wrists out of end-range extension, usually buying instant extra seconds and happier joints.' },
  { title: 'Frequency beats heroics', body: 'Three or four focused sessions a week outgrow one weekly massacre. Planche is a skill — visit it often, fresh.' },
  { title: 'Deload every 4–6 weeks', body: 'Half the volume, easy targets, same movements. Strength lands during the easy week, not the hard ones.' },
  { title: 'Bands are for positions', body: 'Band assistance lets you rehearse the true straddle shape long before you can hold it free. Same form rules apply — the band carries load, not sins.' },
  { title: 'Pancake now, straddle later', body: 'Every degree of straddle width shortens the lever. Two pancake sessions a week quietly makes the straddle planche cheaper.' },
  { title: 'Squeeze everything', body: 'Glutes, quads, toes points, fists of the feet. Total-body tension transmits force; a loose body leaks the strength you do have.' },
  { title: 'Seconds are streaky', body: 'A 12s day after a 16s day means nothing. Judge progress on two-week trends, not single sessions.' },
  { title: 'Sleep is a training day', body: 'Straight-arm strength is nervous-system strength. A short night can erase 20% of your holds — plan tests for rested days.' },
  { title: 'Own it before you leave it', body: 'The unlock targets are minimums. Banking extra seconds on the current step makes the next one arrive faster, not slower.' },
  { title: 'Elbow pain protocol', body: 'Inner-elbow ache = biceps tendon complaining about straight-arm load. Drop lean intensity 30%, add light curls for blood flow, and give it two weeks.' },
]

export function tipOfTheDay(now = Date.now()): Tip {
  const day = Math.floor(now / 86_400_000)
  return TIPS[day % TIPS.length]
}
