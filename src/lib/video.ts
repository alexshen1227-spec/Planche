import type { Exercise } from '../types'

/**
 * Demo videos are deep links into a YouTube search rather than hardcoded
 * video ids: specific ids rot (deleted, renamed, made private) and there is
 * no way to keep them honest from inside a static app. A well-formed search
 * always resolves to current, real demonstrations — and users can pin their
 * own preferred video per exercise, which is stored locally and embedded.
 */
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
