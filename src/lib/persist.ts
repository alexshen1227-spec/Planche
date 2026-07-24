/**
 * On-device data safety.
 *
 * localStorage is the primary store, but browsers may evict it under disk
 * pressure and a bad write could corrupt it. Two defenses:
 *  1. navigator.storage.persist() — asks the browser to exempt this origin
 *     from automatic storage cleanup.
 *  2. An IndexedDB mirror of the full state — a second, independent copy
 *     that the app silently restores from when the primary copy vanishes.
 */

const DB_NAME = 'planchelab'
const STORE = 'state'
const KEY = 'v1'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'))
  })
}

/** Write the serialized state to the IndexedDB mirror. Never throws. */
export async function writeMirror(json: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(json, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('mirror write failed'))
    })
    db.close()
  } catch {
    /* mirror is best-effort */
  }
}

/** Read the serialized state from the IndexedDB mirror, or null. */
export async function readMirror(): Promise<string | null> {
  try {
    const db = await openDb()
    const value = await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null)
      req.onerror = () => reject(req.error ?? new Error('mirror read failed'))
    })
    db.close()
    return value
  } catch {
    return null
  }
}

/** Ask the browser to protect this origin's storage from eviction. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export interface StorageInfo {
  persisted: boolean | null
  usageBytes: number | null
}

export async function storageInfo(): Promise<StorageInfo> {
  const info: StorageInfo = { persisted: null, usageBytes: null }
  try {
    if (navigator.storage?.persisted) info.persisted = await navigator.storage.persisted()
  } catch {
    /* unknown */
  }
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate()
      info.usageBytes = est.usage ?? null
    }
  } catch {
    /* unknown */
  }
  return info
}
