import { describe, expect, it } from 'vitest'
import { PATTERN_LABEL, type Muscle, type Pattern } from '../../data/gym/catalog'
import { GYM_EXERCISES, GYM_EXERCISE_BY_ID, volumeShare } from '../../data/gym/exercises'
import { alternativesFor } from './availability'
import { buildGymSession } from './builder'
import { fitsGymFocus } from './focus'
import type { GymLocation } from './types'

// A movement pattern is a job, and every screen and rule reads it: the slot a lift fills, the swaps offered for it,
// the label the picker shows. A wrist curl filed under the curl pattern was offered as biceps work, though it barely
// uses the biceps (the athlete's question). Each pattern names the muscles its job is for; every exercise filed under
// it must have one of them among its main muscles.
const JOB: Record<Pattern, readonly Muscle[]> = {
  'horizontal-press': ['chest', 'front-delts', 'triceps'],
  'incline-press': ['chest-upper', 'front-delts'],
  'vertical-press': ['front-delts'],
  dip: ['chest', 'triceps'],
  'chest-fly': ['chest', 'chest-upper'],
  'lateral-raise': ['side-delts'],
  'front-raise': ['front-delts'],
  'rear-delt': ['rear-delts', 'upper-back'],
  shrug: ['traps'],
  triceps: ['triceps', 'triceps-long'],
  // Elbow flexion: the biceps, or the forearm flexors for a palms-down curl.
  biceps: ['biceps', 'forearms'],
  wrist: ['forearms'],
  'vertical-pull': ['lats'],
  'horizontal-pull': ['lats', 'upper-back'],
  'straight-arm-pull': ['lats'],
  squat: ['quads'],
  lunge: ['quads', 'glutes', 'adductors'],
  hinge: ['glutes', 'hamstrings', 'lower-back'],
  'knee-extension': ['quads'],
  'knee-flexion': ['hamstrings'],
  calf: ['calves'],
  dorsiflexion: ['tibialis-anterior'],
  'core-flexion': ['abs'],
  'core-anti-rotation': ['obliques', 'abs', 'lower-back'],
  carry: ['forearms', 'traps', 'obliques', 'abs', 'front-delts', 'upper-back', 'quads'],
  jump: ['quads', 'glutes', 'calves'],
  throw: ['chest', 'obliques', 'lats', 'glutes'],
  sprint: ['quads', 'glutes', 'hamstrings'],
  drill: ['hip-flexors', 'hamstrings', 'glutes'],
  adduction: ['adductors'],
  abduction: ['glutes'],
}

const GYM: GymLocation = {
  id: 'g', name: 'Gym', unit: 'kg', updatedAt: 0,
  equipment: ['floor', 'pullup-bar', 'dumbbells', 'bench', 'incline-bench', 'barbell', 'ez-bar', 'cable', 'machine', 'squat-rack'] as GymLocation['equipment'],
}

describe('every exercise is filed under the job it trains', () => {
  it('has one of its pattern’s muscles among its main muscles', () => {
    const wrong = GYM_EXERCISES.filter((e) => !e.primary.some((m) => JOB[e.pattern].includes(m))).map((e) => `${e.id} (${e.pattern}: ${e.primary.join(', ')})`)
    expect(wrong).toEqual([])
  })

  it('labels every pattern, and only curls say biceps', () => {
    for (const p of Object.keys(JOB) as Pattern[]) expect(PATTERN_LABEL[p], p).toBeTruthy()
    expect(PATTERN_LABEL.wrist).not.toMatch(/biceps/i)
  })

  it('files every wrist curl as wrist work, with no biceps credit', () => {
    const wristCurls = GYM_EXERCISES.filter((e) => /wrist curl/i.test(e.name))
    expect(wristCurls.map((e) => e.id).sort()).toEqual(['barbell-wrist-curl', 'ez-wrist-curl', 'wrist-curl'])
    for (const e of wristCurls) {
      expect(e.pattern, e.id).toBe('wrist')
      expect(e.primary, e.id).toEqual(['forearms'])
      expect(volumeShare(e, 'biceps'), e.id).toBe(0)
      expect(volumeShare(e, 'forearms'), e.id).toBe(1)
    }
  })

  it('credits the biceps on every curl, fully on a curl and by half on a palms-down one', () => {
    for (const e of GYM_EXERCISES.filter((x) => x.pattern === 'biceps')) {
      expect(volumeShare(e, 'biceps'), e.id).toBeGreaterThan(0)
    }
    for (const id of ['reverse-curl', 'barbell-reverse-curl', 'db-reverse-curl']) {
      expect(GYM_EXERCISE_BY_ID[id].primary, id).toEqual(['forearms'])
      expect(volumeShare(GYM_EXERCISE_BY_ID[id], 'biceps'), id).toBe(0.5)
    }
    expect(volumeShare(GYM_EXERCISE_BY_ID['db-curl'], 'biceps')).toBe(1)
    // A pull-up is half a biceps set; a squat holding the bar in the elbows is none.
    expect(volumeShare(GYM_EXERCISE_BY_ID['pull-up'], 'biceps')).toBe(0.5)
    expect(volumeShare(GYM_EXERCISE_BY_ID['zercher-squat'], 'biceps')).toBe(0)
  })

  it('keeps a front raise out of the lateral raises and a kickback out of the abductors', () => {
    expect(GYM_EXERCISE_BY_ID['db-front-raise'].pattern).toBe('front-raise')
    for (const e of GYM_EXERCISES.filter((x) => x.pattern === 'lateral-raise')) expect(e.primary, e.id).toContain('side-delts')
    expect(GYM_EXERCISE_BY_ID['cable-kickback'].pattern).toBe('hinge')
    expect(GYM_EXERCISES.filter((e) => e.pattern === 'abduction').map((e) => e.id).sort())
      .toEqual(['banded-clamshell', 'banded-lateral-walk', 'cable-hip-abduction', 'seated-banded-abduction', 'side-lying-abduction'])
    // The incline Y raise is lower- and mid-trap work, not a shrug.
    expect(GYM_EXERCISE_BY_ID['y-raise'].primary).not.toContain('traps')
  })

  it('keeps wrist curls on Pull days, never as a stand-in for a curl', () => {
    for (const id of ['wrist-curl', 'barbell-wrist-curl']) expect(fitsGymFocus('pull', GYM_EXERCISE_BY_ID[id]), id).toBe(true)
    expect(fitsGymFocus('push', GYM_EXERCISE_BY_ID['db-front-raise'])).toBe(true)
    const curlSwaps = alternativesFor('db-curl', GYM, {}).map((e) => e.id)
    expect(curlSwaps.slice(0, 5).every((id) => GYM_EXERCISE_BY_ID[id].pattern === 'biceps')).toBe(true)
    expect(curlSwaps.filter((id) => GYM_EXERCISE_BY_ID[id].pattern === 'wrist')).toEqual([])
    // A hammer curl shares the forearms with a wrist curl, but its job is the curl.
    expect(alternativesFor('hammer-curl', GYM, {}).filter((e) => e.pattern === 'wrist')).toEqual([])
    expect(alternativesFor('hammer-curl', GYM, {}).every((e) => e.primary.includes('biceps') || e.secondary.includes('biceps'))).toBe(true)
    // A forearm priority on a Pull day may add forearm work; the day's curl is still a curl.
    for (const minutes of [30, 45, 60]) {
      const plan = buildGymSession({ location: GYM, minutes, focus: 'pull', sessions: [], ratings: {}, priority: ['forearms'], now: Date.UTC(2026, 10, 24, 12) })
      const curls = plan.items.filter((it) => GYM_EXERCISE_BY_ID[it.exerciseId].pattern === 'biceps')
      expect(curls.every((it) => GYM_EXERCISE_BY_ID[it.exerciseId].primary.includes('biceps') || GYM_EXERCISE_BY_ID[it.exerciseId].secondary.includes('biceps')), `${minutes}`).toBe(true)
    }
  })
})
