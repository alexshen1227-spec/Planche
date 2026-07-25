/**
 * Local storage for form-check video clips.
 *
 * Clips never leave the device. They are also the largest thing this app
 * writes, so the store is deliberately capped: a handful per exercise, oldest
 * evicted first, and recording is done at a low resolution and bitrate. The
 * point is comparing your position over time, not producing footage.
 */

const DB_NAME = 'planchelab-clips'
const STORE = 'clips'
/** Clips kept per exercise before the oldest is dropped. */
export const CLIPS_PER_EXERCISE = 3

export interface ClipMeta {
  key: string
  exerciseId: string
  at: number
  seconds: number
  bytes: number
  /** Pinned clips are never auto-evicted — the reference to compare against. */
  pinned?: boolean
}

interface ClipRecord extends ClipMeta {
  blob: Blob
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'key' })
        os.createIndex('exerciseId', 'exerciseId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('clip store unavailable'))
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('clip operation failed'))
        t.oncomplete = () => db.close()
      }),
  )
}

export async function listClips(exerciseId?: string): Promise<ClipMeta[]> {
  try {
    const all = await tx<ClipRecord[]>('readonly', (s) => s.getAll() as IDBRequest<ClipRecord[]>)
    return all
      .filter((c) => !exerciseId || c.exerciseId === exerciseId)
      .map(({ blob: _blob, ...meta }) => meta)
      .sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

export async function getClipUrl(key: string): Promise<string | null> {
  try {
    const rec = await tx<ClipRecord | undefined>('readonly', (s) => s.get(key) as IDBRequest<ClipRecord | undefined>)
    return rec?.blob ? URL.createObjectURL(rec.blob) : null
  } catch {
    return null
  }
}

export async function deleteClip(key: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(key) as unknown as IDBRequest<undefined>)
  } catch {
    /* best effort */
  }
}

export async function setPinned(key: string, pinned: boolean): Promise<void> {
  try {
    const rec = await tx<ClipRecord | undefined>('readonly', (s) => s.get(key) as IDBRequest<ClipRecord | undefined>)
    if (!rec) return
    await tx('readwrite', (s) => s.put({ ...rec, pinned }) as unknown as IDBRequest<IDBValidKey>)
  } catch {
    /* best effort */
  }
}

/** Save a clip and evict the oldest unpinned ones for that exercise. */
export async function saveClip(exerciseId: string, blob: Blob, seconds: number): Promise<string | null> {
  try {
    const key = `${exerciseId}:${Date.now()}`
    const rec: ClipRecord = { key, exerciseId, at: Date.now(), seconds, bytes: blob.size, blob }
    await tx('readwrite', (s) => s.put(rec) as unknown as IDBRequest<IDBValidKey>)

    const mine = (await listClips(exerciseId)).filter((c) => !c.pinned)
    for (const stale of mine.slice(CLIPS_PER_EXERCISE)) await deleteClip(stale.key)
    return key
  } catch {
    return null
  }
}

export async function clipsTotalBytes(): Promise<number> {
  return (await listClips()).reduce((t, c) => t + c.bytes, 0)
}

export async function clearAllClips(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.clear() as unknown as IDBRequest<undefined>)
  } catch {
    /* best effort */
  }
}
