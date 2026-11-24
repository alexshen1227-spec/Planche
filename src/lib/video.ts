import type { Exercise } from '../types'

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
  'pike-pushup': { id: 'DG-NcMnfZ_0', by: 'FitnessFAQs', start: 48 },
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
