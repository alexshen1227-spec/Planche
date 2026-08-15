import { CURRENT_STATE_VERSION, type AutoForm, type FormIssue, type FormRating } from '../types'
import type { JudgeInput, PoseFormResult } from './poseForm'
import { dayKey } from './time'

const DB_NAME = 'planchelab-problem-reports'
const REPORTS = 'reports'
const VIDEOS = 'videos'

export const PROBLEM_REPORT_VERSION = 1 as const

export interface ProblemReportRuntime {
  buildId: string
  stateVersion: number
  userAgent: string
  language: string
  platform: string
  timeZone: string
  viewport: { width: number; height: number; devicePixelRatio: number }
  screen: { width: number; height: number }
}

export interface ProblemReportRecord {
  version: typeof PROBLEM_REPORT_VERSION
  id: string
  createdAt: number
  note?: string
  movement: { id: string; name: string }
  creditedHoldSec: number
  /** The full verdict shown for this clip, including its per-frame working. */
  analysis: PoseFormResult
  /** Raw detector output makes the verdict reproducible without the video model. */
  poses?: JudgeInput
  /** The compact reading saved with the set, retained in case a later re-run differs. */
  savedCameraReading?: AutoForm
  athleteReview?: {
    rating: FormRating
    confirmed: boolean
    issues: FormIssue[]
  }
  runtime: ProblemReportRuntime
  video: {
    mimeType: string
    bytes: number
  }
}

export interface ProblemReportSummary {
  id: string
  createdAt: number
  movementName: string
  videoBytes: number
}

export interface SaveProblemReportInput {
  note?: string
  movementId: string
  movementName: string
  creditedHoldSec: number
  analysis: PoseFormResult
  poses?: JudgeInput
  savedCameraReading?: AutoForm
  athleteReview?: ProblemReportRecord['athleteReview']
  video: Blob
}

export interface ProblemReportExport {
  schema: 'planche-lab-problem-reports'
  version: typeof PROBLEM_REPORT_VERSION
  exportedAt: number
  reportCount: number
  privacy: string
  reports: Array<
    ProblemReportRecord & {
      videoFile: {
        name: string
        mimeType: string
        bytes: number
        /** Base64 keeps every report, including its video, in one sendable JSON file. */
        base64?: string
        missing?: boolean
      }
    }
  >
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(REPORTS)) db.createObjectStore(REPORTS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(VIDEOS)) db.createObjectStore(VIDEOS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('problem report store unavailable'))
  })
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('problem report request failed'))
  })
}

/** Resolve only after the whole transaction commits, including the video copy. */
async function withTx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      let result: T
      let settled = false
      tx.oncomplete = () => {
        settled = true
        resolve(result)
      }
      tx.onabort = () => {
        if (!settled) reject(tx.error ?? new Error('problem report transaction aborted'))
      }
      tx.onerror = () => {
        if (!settled) reject(tx.error ?? new Error('problem report transaction failed'))
      }
      Promise.resolve(fn(tx)).then(
        (value) => {
          result = value
        },
        (error) => {
          try {
            tx.abort()
          } catch {
            /* already aborting */
          }
          reject(error)
        },
      )
    })
  } finally {
    db.close()
  }
}

function runtimeInfo(): ProblemReportRuntime {
  const timeZone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
    } catch {
      return 'unknown'
    }
  })()
  return {
    buildId: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'development',
    stateVersion: CURRENT_STATE_VERSION,
    userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    language: typeof navigator === 'undefined' ? 'unknown' : navigator.language,
    platform: typeof navigator === 'undefined' ? 'unknown' : navigator.platform,
    timeZone,
    viewport: {
      width: typeof window === 'undefined' ? 0 : window.innerWidth,
      height: typeof window === 'undefined' ? 0 : window.innerHeight,
      devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    },
    screen: {
      width: typeof screen === 'undefined' ? 0 : screen.width,
      height: typeof screen === 'undefined' ? 0 : screen.height,
    },
  }
}

export async function saveProblemReport(input: SaveProblemReportInput): Promise<string | null> {
  const id = crypto.randomUUID()
  const note = input.note?.trim()
  const record: ProblemReportRecord = {
    version: PROBLEM_REPORT_VERSION,
    id,
    createdAt: Date.now(),
    ...(note ? { note } : {}),
    movement: { id: input.movementId, name: input.movementName },
    creditedHoldSec: input.creditedHoldSec,
    analysis: input.analysis,
    ...(input.poses ? { poses: input.poses } : {}),
    ...(input.savedCameraReading ? { savedCameraReading: input.savedCameraReading } : {}),
    ...(input.athleteReview ? { athleteReview: input.athleteReview } : {}),
    runtime: runtimeInfo(),
    video: {
      mimeType: input.video.type || 'application/octet-stream',
      bytes: input.video.size,
    },
  }

  try {
    await withTx([REPORTS, VIDEOS], 'readwrite', (tx) => {
      tx.objectStore(REPORTS).put(record)
      tx.objectStore(VIDEOS).put(input.video, id)
    })
    return id
  } catch {
    return null
  }
}

async function readAllProblemReports(): Promise<ProblemReportRecord[]> {
  return withTx([REPORTS], 'readonly', (tx) =>
    reqAsPromise(tx.objectStore(REPORTS).getAll() as IDBRequest<ProblemReportRecord[]>),
  )
}

async function getProblemReportVideo(id: string): Promise<Blob | null> {
  return (
    (await withTx([VIDEOS], 'readonly', (tx) =>
      reqAsPromise(tx.objectStore(VIDEOS).get(id) as IDBRequest<Blob | undefined>),
    )) ?? null
  )
}

export async function listProblemReports(): Promise<ProblemReportSummary[]> {
  try {
    const records = await readAllProblemReports()
    return records
      .map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        movementName: record.movement.name,
        videoBytes: record.video.bytes,
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export async function clearAllProblemReports(): Promise<boolean> {
  try {
    await withTx([REPORTS, VIDEOS], 'readwrite', (tx) => {
      tx.objectStore(REPORTS).clear()
      tx.objectStore(VIDEOS).clear()
    })
    return true
  } catch {
    return false
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('A report video could not be read.'))
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

function extensionFor(mimeType: string): string {
  if (/mp4/i.test(mimeType)) return 'mp4'
  if (/quicktime/i.test(mimeType)) return 'mov'
  return 'webm'
}

/** Pure bundle builder is exported so the sendable file format stays testable. */
export async function buildProblemReportExport(
  records: ProblemReportRecord[],
  loadVideo: (id: string) => Promise<Blob | null>,
  exportedAt = Date.now(),
): Promise<ProblemReportExport> {
  const reports: ProblemReportExport['reports'] = []
  for (const record of records.sort((a, b) => a.createdAt - b.createdAt)) {
    const video = await loadVideo(record.id)
    reports.push({
      ...record,
      videoFile: video
        ? {
            name: `${record.id}.${extensionFor(video.type || record.video.mimeType)}`,
            mimeType: video.type || record.video.mimeType,
            bytes: video.size,
            base64: await blobToBase64(video),
          }
        : {
            name: `${record.id}.${extensionFor(record.video.mimeType)}`,
            mimeType: record.video.mimeType,
            bytes: record.video.bytes,
            missing: true,
          },
    })
  }
  return {
    schema: 'planche-lab-problem-reports',
    version: PROBLEM_REPORT_VERSION,
    exportedAt,
    reportCount: reports.length,
    privacy:
      'Contains only user-selected camera problem reports: their copied videos, movement context, camera analysis, optional notes, and app/device diagnostics. It excludes the athlete profile and unrelated training history.',
    reports,
  }
}

export async function exportProblemReports(): Promise<number> {
  const records = await readAllProblemReports()
  if (!records.length) return 0
  const bundle = await buildProblemReportExport(records, getProblemReportVideo)
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `planche-lab-problem-reports-${dayKey(Date.now())}.json`
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return records.length
}
