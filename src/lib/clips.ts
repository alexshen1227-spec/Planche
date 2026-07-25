/**
 * Local storage for form-check video clips.
 *
 * Clips never leave the device. They are also by far the largest thing this
 * app writes, so metadata lives in its own object store: listing clips (which
 * happens after every filmed set, to evict old ones) must not deserialise
 * megabytes of video just to read a few numbers.
 */

const DB_NAME = 'planchelab-clips'
const BLOBS = 'clips'
const META = 'meta'
/**
 * Retention: the last month of footage, so you can compare against how you
 * looked a few weeks ago, with a per-exercise cap so a heavy week cannot fill
 * the device. Pinned clips are exempt from both — that is what pinning means.
 */
export const CLIP_RETENTION_DAYS = 30
export const CLIPS_PER_EXERCISE = 8

export interface ClipMeta {
  key: string
  exerciseId: string
  at: number
  seconds: number
  bytes: number
  /** Pinned clips are never auto-evicted — the reference to compare against. */
  pinned?: boolean
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = (event) => {
      const db = req.result
      // v1 kept blob and metadata in one store with an in-line key. Writing a
      // bare blob into that store throws, so the old store is replaced rather
      // than reused. Clips are re-recordable, so dropping them is acceptable.
      if (event.oldVersion < 2 && db.objectStoreNames.contains(BLOBS)) db.deleteObjectStore(BLOBS)
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS)
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('clip store unavailable'))
  })
}

/**
 * Runs a transaction and resolves only once it commits — a request can
 * succeed while the transaction later aborts (quota, most likely), and
 * treating that as success would leave dangling references to missing clips.
 * The connection is closed on every outcome so failures cannot leak it.
 */
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
        if (!settled) reject(tx.error ?? new Error('clip transaction aborted'))
      }
      tx.onerror = () => {
        if (!settled) reject(tx.error ?? new Error('clip transaction failed'))
      }
      Promise.resolve(fn(tx)).then(
        (r) => {
          result = r
        },
        (e) => {
          try {
            tx.abort()
          } catch {
            /* already aborting */
          }
          reject(e)
        },
      )
    })
  } finally {
    db.close()
  }
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('request failed'))
  })
}

export async function listClips(exerciseId?: string): Promise<ClipMeta[]> {
  try {
    const all = await withTx([META], 'readonly', (tx) =>
      reqAsPromise(tx.objectStore(META).getAll() as IDBRequest<ClipMeta[]>),
    )
    return all.filter((c) => !exerciseId || c.exerciseId === exerciseId).sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

export async function getClipUrl(key: string): Promise<string | null> {
  try {
    const blob = await withTx([BLOBS], 'readonly', (tx) =>
      reqAsPromise(tx.objectStore(BLOBS).get(key) as IDBRequest<Blob | undefined>),
    )
    return blob ? URL.createObjectURL(blob) : null
  } catch {
    return null
  }
}

export async function deleteClip(key: string): Promise<boolean> {
  try {
    await withTx([BLOBS, META], 'readwrite', (tx) => {
      tx.objectStore(BLOBS).delete(key)
      tx.objectStore(META).delete(key)
    })
    return true
  } catch {
    return false
  }
}

export async function setPinned(key: string, pinned: boolean): Promise<boolean> {
  try {
    await withTx([META], 'readwrite', async (tx) => {
      const store = tx.objectStore(META)
      const rec = await reqAsPromise(store.get(key) as IDBRequest<ClipMeta | undefined>)
      if (rec) store.put({ ...rec, pinned })
    })
    return true
  } catch {
    return false
  }
}

/** Save a clip and evict the oldest unpinned ones for that exercise. */
export async function saveClip(exerciseId: string, blob: Blob, seconds: number): Promise<string | null> {
  const key = `${exerciseId}:${Date.now()}`
  try {
    await withTx([BLOBS, META], 'readwrite', (tx) => {
      tx.objectStore(BLOBS).put(blob, key)
      tx.objectStore(META).put({ key, exerciseId, at: Date.now(), seconds, bytes: blob.size } satisfies ClipMeta)
    })
  } catch {
    return null // quota or storage failure: no dangling reference is handed back
  }
  void pruneClips(exerciseId)
  return key
}

/**
 * Drop anything past the retention window, plus anything beyond the per-
 * exercise cap. Runs after each save and on app start so storage cannot creep
 * up over months of training.
 */
export async function pruneClips(exerciseId?: string): Promise<number> {
  try {
    const cutoff = Date.now() - CLIP_RETENTION_DAYS * 86_400_000
    const all = await listClips(exerciseId)
    const doomed = new Set<string>()

    for (const c of all) if (!c.pinned && c.at < cutoff) doomed.add(c.key)

    const byExercise = new Map<string, ClipMeta[]>()
    for (const c of all) {
      if (c.pinned || doomed.has(c.key)) continue
      const list = byExercise.get(c.exerciseId) ?? []
      list.push(c)
      byExercise.set(c.exerciseId, list)
    }
    // listClips is newest-first, so anything past the cap is the older tail.
    for (const list of byExercise.values()) {
      for (const stale of list.slice(CLIPS_PER_EXERCISE)) doomed.add(stale.key)
    }

    for (const key of doomed) await deleteClip(key)
    return doomed.size
  } catch {
    return 0
  }
}

export async function clipsTotalBytes(): Promise<number> {
  return (await listClips()).reduce((t, c) => t + c.bytes, 0)
}

export async function clearAllClips(): Promise<boolean> {
  try {
    await withTx([BLOBS, META], 'readwrite', (tx) => {
      tx.objectStore(BLOBS).clear()
      tx.objectStore(META).clear()
    })
    return true
  } catch {
    return false
  }
}
