import { expect, it } from 'vitest'
import { makeMediaArchive, readMediaArchive } from './mediaArchive'
import { initialState } from './store'

const sample = new TextEncoder().encode('separately-verifiable-test-recording')
const clip = {
  meta: { key: 'my-hold', exerciseId: 'tuck-planche', at: 123, seconds: 9.5, pinned: true, bytes: sample.length },
  blob: new Blob([sample], { type: 'video/webm;codecs=vp8' }),
}

it('round-trips the athlete, video bytes, format and pin in a portable backup', async () => {
  const state = { ...initialState(), name: 'Mira' }
  const archive = await makeMediaArchive(state, [clip])
  const result = await readMediaArchive(archive)
  expect(result.raw).toEqual(JSON.parse(JSON.stringify(state)))
  expect(result.clips).toHaveLength(1)
  expect(result.clips[0].meta).toMatchObject(clip.meta)
  expect(result.clips[0].blob.type).toBe(clip.blob.type)
  expect(new Uint8Array(await result.clips[0].blob.arrayBuffer())).toEqual(sample)
})

it('refuses a backup with changed video bytes even when the history and clip size are intact', async () => {
  const archive = await makeMediaArchive(initialState(), [clip])
  const bytes = new Uint8Array(await archive.arrayBuffer())
  const offset = bytes.findIndex((_, i) => sample.every((value, j) => bytes[i + j] === value))
  expect(offset).toBeGreaterThan(0)
  bytes[offset] ^= 1
  await expect(readMediaArchive(new Blob([bytes]))).rejects.toThrow('incomplete or unreadable')
})
