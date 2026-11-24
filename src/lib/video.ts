import type { Exercise } from '../types'
import { equivalentGymExercise } from '../data/gym/exercises'

export interface MovementVideo {
  id: string
  by: string
  /** Start at the chapter where the instructor demonstrates this variation. */
  start?: number
}

/** Publisher demonstrations. A locally pinned clip takes precedence. */
export const MOVEMENT_VIDEOS: Readonly<Record<string, MovementVideo | undefined>> = {
  'wall-handstand': { id: 'Y3FSeSecjKA', by: 'GMB Fitness', start: 250 },
  'wall-float': { id: 'RLHiSB99sXE', by: 'CrossFit Invictus' },
  'handstand-bail': { id: 'ZzEP7XvkDDk', by: 'GMB Fitness' },
  'freestanding-handstand': { id: 'Y3FSeSecjKA', by: 'GMB Fitness' },
  'pike-push-up': { id: 'DG-NcMnfZ_0', by: 'FitnessFAQs', start: 48 },
  'wall-hspu-negative': { id: 'uZWjFe4fufA', by: 'FitnessFAQs' },
  'wall-hspu': { id: 'hvoQiF0kBI8', by: 'CrossFit' },
  'freestanding-hspu': { id: '2fY3DHUZLOs', by: 'FitnessFAQs' },
  'ninety-pushup': { id: 'OvRvSQ8KQZE', by: 'FitnessFAQs', start: 305 },
  'planche-lean': { id: '8mnNpNZ88Oo', by: 'GMB Fitness' },
  'tuck-planche': { id: '8mnNpNZ88Oo', by: 'GMB Fitness' },
  'straddle-planche': { id: '6snDOgFBBFA', by: 'GMB Fitness' },
  'tuck-front-lever': { id: '_qNRNyI3qxM', by: 'GMB Fitness', start: 198 },
  'adv-tuck-front-lever': { id: '_qNRNyI3qxM', by: 'GMB Fitness', start: 243 },
  'straddle-front-lever': { id: '_qNRNyI3qxM', by: 'GMB Fitness', start: 281 },
  'front-lever': { id: '_qNRNyI3qxM', by: 'GMB Fitness', start: 322 },
  'tuck-flag': { id: '5PA4zMBwzZo', by: 'Barstarzz / Bodybuilding.com', start: 258 },
  'straddle-flag': { id: '5PA4zMBwzZo', by: 'Barstarzz / Bodybuilding.com', start: 399 },
  'human-flag': { id: 'Jjr2oEfHG7c', by: 'Gymless Fitness', start: 467 },
  'db-bench-press': { id: 'U14BvBQNi2M', by: 'CrossFit' },
  'goblet-squat': { id: 'qBZ9pJf7uHY', by: 'CrossFit Affiliate Programming' },
  'lat-pulldown': { id: 'JGeRYIZdojU', by: 'PureGym' },
  'db-rdl': { id: 'aa57T45iFSE', by: 'National Academy of Sports Medicine' },
  'db-lateral-raise': { id: 'z-kOn7flIZg', by: 'PureGym' },
  'cable-row': { id: 'lJoozxC0Rns', by: 'PureGym' },
  'assisted-pull-up': { id: 'wFj808u2HWU', by: 'PureGym' },
  'seated-leg-curl': { id: 'jq03iefZxjc', by: 'PartnerMD' },
  'frog-stand': { id: 'SrYBD4yCI84', by: 'GMB Fitness' },
  'hollow-hold': { id: 'LlDNef_Ztsc', by: 'GMB Fitness' },
  'kick-up': { id: 'nnPsnWvj-7g', by: 'GMB Fitness', start: 603 },
  'elbow-lever': { id: 'yJqW3Xh253E', by: 'Hybrid Calisthenics' },
  'ninety-hold': { id: 'sqQJj5_Vchg', by: 'Daniel Vadnal' },
  'fl-negative': { id: '_qNRNyI3qxM', by: 'GMB Fitness' },
  'pseudo-planche-push-up': { id: 'rxtf-Y0J15I', by: 'Vitaly Pavlenko' },
  'negative-pull-up': { id: 'wx3JCGLnMnk', by: 'TrainingPeaks' },
  'back-squat': { id: 'QmZAiBqPvZw', by: 'CrossFit' },
  'bench-press': { id: 'SCVCLChPQFY', by: 'CrossFit' },
  'bodyweight-squat': { id: 'rMvwVtlqjTE', by: 'CrossFit' },
  'box-jump': { id: 'NBY9-kTuHEk', by: 'CrossFit' },
  'box-squat': { id: 'QEgBbQSpE4E', by: 'CrossFit' },
  'deadlift': { id: '1ZXobu7JvvE', by: 'CrossFit' },
  'dip': { id: 'o2qX3Zb5mvg', by: 'CrossFit' },
  'farmer-carry': { id: 'p5MNNosenJc', by: 'CrossFit' },
  'front-squat': { id: 'uYumuL_G_V0', by: 'CrossFit' },
  'ghd-back-extension': { id: 'ivDB23Kcv-A', by: 'CrossFit' },
  'good-morning': { id: 'KxYxHr1lkx4', by: 'CrossFit' },
  'l-sit': { id: '_HbccxgnCg0', by: 'CrossFit' },
  'l-sit-pull-up': { id: 'qeGS55RHBUU', by: 'CrossFit' },
  'med-ball-slam': { id: 'k9W6g9LvXDI', by: 'CrossFit' },
  'overhead-press': { id: '5yWaNOvgFCM', by: 'CrossFit' },
  'pull-up': { id: 'HRV5YKKaeVw', by: 'CrossFit' },
  'push-press': { id: 'iaBVSJm78ko', by: 'CrossFit' },
  'push-up': { id: '0pkjOk0EiAk', by: 'CrossFit' },
  'ring-dip': { id: 'EznLCDBAPIU', by: 'CrossFit' },
  'ring-push-up': { id: 'FRiiZRhapeU', by: 'CrossFit' },
  'step-up': { id: '5qjqDHOUh-A', by: 'CrossFit' },
  'sumo-deadlift': { id: 'ENEg9UF7z7M', by: 'CrossFit' },
  'toes-to-bar': { id: 'xX9Hzi7Onnw', by: 'CrossFit' },
  'walking-lunge': { id: 'DlhojghkaQ0', by: 'CrossFit' },
  'zercher-squat': { id: 'nwx6Ip7hd3I', by: 'CrossFit' },
  'ab-wheel': { id: 'SBO5aFR09D4', by: 'PureGym' },
  'arnold-press': { id: 'jeJttN2EWCo', by: 'PureGym' },
  'barbell-curl': { id: 'N5x5M1x1Gd0', by: 'PureGym' },
  'barbell-row': { id: 'FsK19s8eGFs', by: 'PureGym' },
  'broad-jump': { id: 'uhz-ia-2UcM', by: 'PureGym' },
  'bulgarian-split-squat': { id: 'TEXl2b3__S4', by: 'PureGym' },
  'cable-curl': { id: 'GNlopToAZyg', by: 'PureGym' },
  'cable-fly': { id: 'QcTcWpkn_bw', by: 'PureGym' },
  'cable-kickback': { id: 'SqO-VUEak2M', by: 'PureGym' },
  'chest-supported-db-row': { id: 'Nx0TzjgsI-0', by: 'PureGym' },
  'close-grip-bench': { id: 'DzA2xZhDGeo', by: 'PureGym' },
  'concentration-curl': { id: 'llD6MImgqe8', by: 'PureGym' },
  'db-curl': { id: 'MtXdEcW3Eog', by: 'PureGym' },
  'db-fly': { id: 'Nhvz9EzdJ4U', by: 'PureGym' },
  'db-kickback': { id: 'JPmbMOu4IYw', by: 'PureGym' },
  'db-rear-delt-fly': { id: 'nlkF7_2O_Lw', by: 'PureGym' },
  'db-row': { id: 'ZRSGpBUVcNw', by: 'PureGym' },
  'db-shoulder-press': { id: 'aI2hGzsAMXs', by: 'PureGym' },
  'dead-bug': { id: '9RK9UUgKIQE', by: 'PureGym' },
  'decline-push-up': { id: 'QBlYp-EwHlo', by: 'PureGym' },
  'diamond-push-up': { id: 'K8bKxVcwjrk', by: 'PureGym' },
  'face-pull': { id: '0Po47vvj9g4', by: 'PureGym' },
  'glute-bridge': { id: 'tqp5XQPpTxY', by: 'PureGym' },
  'hack-squat': { id: 'scs5XcsZuc8', by: 'PureGym' },
  'hammer-curl': { id: 'B4RznoFvTl4', by: 'PureGym' },
  'hanging-knee-raise': { id: 'O7iDA3ory-w', by: 'PureGym' },
  'hanging-leg-raise': { id: 'Yrtvs-nEnk0', by: 'PureGym' },
  'high-low-cable-fly': { id: 'hhruLxo9yZU', by: 'PureGym' },
  'hip-thrust': { id: 'aweBS7K71l8', by: 'PureGym' },
  'incline-bench-press': { id: '2jFFCy8JBU8', by: 'PureGym' },
  'incline-db-curl': { id: 'XVQBeug_9LU', by: 'PureGym' },
  'incline-db-fly': { id: 'JSDpq14vCZ8', by: 'PureGym' },
  'incline-db-press': { id: 'oZVCBM9f8Eo', by: 'PureGym' },
  'incline-push-up': { id: 'yAbg3_pJKvw', by: 'PureGym' },
  'inverted-row': { id: '0AsxBmXeOIo', by: 'PureGym' },
  'jump-squat': { id: 'BRfxI2Es2lE', by: 'PureGym' },
  'kneeling-push-up': { id: 'X9sGmsGYYE0', by: 'PureGym' },
  'leg-curl': { id: 'SbSNUXPRkc8', by: 'PureGym' },
  'leg-extension': { id: '4ZDm5EbiFI8', by: 'PureGym' },
  'leg-press': { id: 'q4W4_VJbKW0', by: 'PureGym' },
  'low-high-cable-fly': { id: 'wnFEC_34Bls', by: 'PureGym' },
  'machine-chest-press': { id: 'CIykDiF4sfg', by: 'PureGym' },
  'machine-shoulder-press': { id: 'GcY6TZxfS0k', by: 'PureGym' },
  'nordic-curl': { id: 'Wo746janD2E', by: 'PureGym' },
  'pallof-press': { id: 'HXrLaqNIkTs', by: 'PureGym' },
  'pec-deck': { id: 'eGjt4lk6g34', by: 'PureGym' },
  'pendlay-row': { id: 'Wv7f0uIKh8o', by: 'PureGym' },
  'preacher-curl': { id: 'Zbs3ko8ycyg', by: 'PureGym' },
  'rack-pull': { id: '9vYBWV5OeKg', by: 'PureGym' },
  'renegade-row': { id: 'Q28cLuweLv4', by: 'PureGym' },
  'reverse-crunch': { id: 'XY8KzdDcMFg', by: 'PureGym' },
  'romanian-deadlift': { id: 'zU-f6DMCdAI', by: 'PureGym' },
  'side-plank': { id: 'Oe9Tp9SvTCE', by: 'PureGym' },
  'single-leg-hip-thrust': { id: '1u-b25VJVFU', by: 'PureGym' },
  'single-leg-press': { id: 'sxF9BcDt-yY', by: 'PureGym' },
  'spider-curl': { id: '9Dd8iiEUs_Q', by: 'PureGym' },
  'split-squat': { id: 'rlvpaDkc76g', by: 'PureGym' },
  'straight-arm-pulldown': { id: 'ey9Fv3FGrRg', by: 'PureGym' },
  'y-raise': { id: 'gDHQX1iend4', by: 'PureGym' },
}

/** Exact gym and skill aliases share a demonstration, including their equipment and load. */
export function movementVideo(exerciseId: string): MovementVideo | undefined {
  const equivalent = exerciseId === 'pppu' ? 'pseudo-planche-push-up' : equivalentGymExercise(exerciseId)?.id
  return MOVEMENT_VIDEOS[exerciseId] ?? (equivalent ? MOVEMENT_VIDEOS[equivalent] : undefined)
}

/** Hand-tuned search phrases where the exercise name alone searches poorly. */
const QUERY_OVERRIDES: Record<string, string> = {
  'wrist-circles': 'wrist warm up routine calisthenics before training',
  'wrist-rocks': 'wrist rocks mobility warm up calisthenics prehab',
  'palm-lifts': 'palm lifts finger lifts wrist strengthening prehab',
  'wrist-stretch': 'wrist flexor extensor stretch after training',
  plank: 'protracted plank scapula push away position tutorial',
  'ppp-hold': 'pseudo planche plank hold tutorial form',
  pushup: 'perfect push up form tutorial',
  dip: 'parallel bar dip proper form tutorial',
  'l-sit': 'l sit tutorial progression parallettes',
  'leg-lifts': 'seated pike compression leg lifts tutorial',
  'arch-hold': 'arch hold superman hold gymnastics tutorial',
  'wall-handstand': 'chest to wall handstand hold tutorial',
  'one-leg-planche': 'one leg extended planche progression tutorial',
  'band-straddle-planche': 'band assisted straddle planche tutorial',
  'pancake-stretch': 'pancake stretch straddle flexibility tutorial',
  'shoulder-extension-stretch': 'shoulder extension stretch calisthenics cooldown',
}

export function demoSearchUrl(ex: Exercise): string {
  const q = QUERY_OVERRIDES[ex.id] ?? `${ex.name} tutorial proper form calisthenics`
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
}

/** Extract a YouTube video id from the common URL shapes, or null. */
export function youtubeId(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  const patterns = [
    /(?:youtube\.com\/watch\?[^#]*\bv=)([A-Za-z0-9_-]{11})/,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
  ]
  for (const p of patterns) {
    const m = trimmed.match(p)
    if (m) return m[1]
  }
  return /^[A-Za-z0-9_-]{11}$/.test(trimmed) ? trimmed : null
}

export function embedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}`
}
