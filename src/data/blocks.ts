import type { BlockTarget } from '../types'

/** A hold target, in seconds. */
export const hold = (sec: number): BlockTarget => ({ kind: 'hold', sec })

/** A rep target. */
export const reps = (n: number): BlockTarget => ({ kind: 'reps', reps: n })
