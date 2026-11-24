import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter, type FileEntry } from '@zip.js/zip.js/index-native.js'
import type { AppState } from '../types'
import type { BackupClip, ClipMeta } from './clips'

const format = 'fitness-lab-form-clips'
const zipOptions = { useWebWorkers: false, level: 0 }
const integrity = { checkSignature: true }

export async function makeMediaArchive(state: AppState, clips: BackupClip[]): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), zipOptions)
  await writer.add('training.json', new TextReader(JSON.stringify(state)))
  const entries = []
  for (const [i, { meta, blob }] of clips.entries()) {
    const mime = blob.type || 'video/webm'
    const file = `clips/${i + 1}.${mime.toLowerCase().startsWith('video/mp4') ? 'mp4' : 'webm'}`
    entries.push({ ...meta, mime, file })
    await writer.add(file, new BlobReader(blob))
  }
  await writer.add('manifest.json', new TextReader(JSON.stringify({ format, version: 1, clips: entries })))
  return writer.close()
}

type ClipEntry = ClipMeta & { file: string; mime: string }

function isClipEntry(value: unknown): value is ClipEntry {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<ClipEntry>
  return typeof c.key === 'string' && c.key.length > 0 &&
    typeof c.exerciseId === 'string' && c.exerciseId.length > 0 &&
    typeof c.file === 'string' && /^clips\/[0-9]+\.(mp4|webm)$/.test(c.file) &&
    typeof c.mime === 'string' && /^video\/[a-z0-9.+-]+(?:;[^\r\n]*)?$/i.test(c.mime) &&
    Number.isSafeInteger(c.at) && c.at! >= 0 && Number.isFinite(c.seconds) && c.seconds! >= 0 &&
    Number.isSafeInteger(c.bytes) && c.bytes! > 0 &&
    (c.reps === undefined || (Number.isSafeInteger(c.reps) && c.reps >= 0)) &&
    (c.pinned === undefined || typeof c.pinned === 'boolean')
}

export async function readMediaArchive(file: Blob): Promise<{ raw: unknown; clips: BackupClip[] }> {
  const reader = new ZipReader(new BlobReader(file), zipOptions)
  try {
    const files = new Map<string, FileEntry>()
    let totalBytes = 0
    for await (const entry of reader.getEntriesGenerator()) {
      totalBytes += entry.uncompressedSize
      if (entry.directory || entry.encrypted || entry.compressionMethod !== 0 || files.has(entry.filename) ||
        entry.uncompressedSize !== entry.compressedSize || totalBytes > file.size) throw new Error('Invalid entries')
      files.set(entry.filename, entry)
    }
    const manifestFile = files.get('manifest.json')
    const trainingFile = files.get('training.json')
    if (!manifestFile || !trainingFile) throw new Error('Missing backup index')
    const manifest = JSON.parse(await manifestFile.getData(new TextWriter(), integrity))
    if (manifest?.format !== format || manifest.version !== 1 || !Array.isArray(manifest.clips) ||
      manifest.clips.length !== files.size - 2) throw new Error('Invalid backup index')
    const raw: unknown = JSON.parse(await trainingFile.getData(new TextWriter(), integrity))
    const keys = new Set<string>()
    const clips: BackupClip[] = []
    for (const entry of manifest.clips) {
      if (!isClipEntry(entry) || keys.has(entry.key)) throw new Error('Invalid video metadata')
      keys.add(entry.key)
      const recording = files.get(entry.file)
      if (!recording || recording.uncompressedSize !== entry.bytes) throw new Error('Missing video')
      files.delete(entry.file)
      const blob = await recording.getData(new BlobWriter(entry.mime), integrity)
      const { key, exerciseId, at, seconds, bytes, pinned, reps } = entry
      clips.push({ meta: { key, exerciseId, at, seconds, bytes, pinned, reps }, blob })
    }
    return { raw, clips }
  } catch {
    throw new Error('This video backup is incomplete or unreadable. Choose the original Fitness Lab ZIP.')
  } finally {
    await reader.close()
  }
}
