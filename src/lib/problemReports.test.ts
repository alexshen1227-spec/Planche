// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  PROBLEM_REPORT_VERSION,
  buildProblemReportExport,
  type ProblemReportRecord,
} from './problemReports'

function report(id: string, createdAt: number): ProblemReportRecord {
  return {
    version: PROBLEM_REPORT_VERSION,
    id,
    createdAt,
    note: 'The elbow flag is wrong.',
    movement: { id: 'tuck-planche', name: 'Tuck Planche' },
    creditedHoldSec: 6.2,
    analysis: {
      ok: true,
      confidence: 0.91,
      framesUsed: 3,
      framesSampled: 3,
      score: 72,
      issues: ['arms'],
      notes: ['Elbows bent.'],
      good: ['Hip height'],
      details: ['Representative elbow angle: 164°.'],
      unseen: [],
      explain: {
        judged: { elbow: true, knee: false, hipAngle: false, line: true, lean: true, shrug: true },
        frames: [{ t: 0, elbowDeg: 164 }],
        envelope: [{ t: 0, bad: true, issues: ['arms'] }],
        aggregateFaults: ['arms'],
        sustainedFaults: ['arms'],
      },
    },
    poses: {
      tracked: [{ t: 0, kps: [{ name: 'left_elbow', x: 10, y: 20, score: 0.9 }] }],
      times: [0],
      width: 640,
      height: 480,
      duration: 7,
      creditedHoldSec: 6.2,
      from: 0,
      to: 6.2,
      holdWindow: 6.2,
      backendId: 'mediapipe',
      rotation: 0,
    },
    runtime: {
      buildId: 'test-build',
      stateVersion: 6,
      userAgent: 'test browser',
      language: 'en',
      platform: 'test',
      timeZone: 'UTC',
      viewport: { width: 390, height: 844, devicePixelRatio: 3 },
      screen: { width: 390, height: 844 },
    },
    video: { mimeType: 'video/webm', bytes: 5 },
  }
}

describe('problem report export', () => {
  it('puts every report, diagnostic and video into one chronological bundle', async () => {
    const older = report('older', 100)
    const newer = report('newer', 200)
    const videos = new Map([
      ['older', new Blob(['older'], { type: 'video/webm' })],
      ['newer', new Blob(['newer'], { type: 'video/mp4' })],
    ])

    const bundle = await buildProblemReportExport(
      [newer, older],
      async (id) => videos.get(id) ?? null,
      300,
    )

    expect(bundle.schema).toBe('planche-lab-problem-reports')
    expect(bundle.exportedAt).toBe(300)
    expect(bundle.reportCount).toBe(2)
    expect(bundle.reports.map((item) => item.id)).toEqual(['older', 'newer'])
    expect(bundle.reports[0].analysis.explain?.sustainedFaults).toEqual(['arms'])
    expect(bundle.reports[0].poses?.backendId).toBe('mediapipe')
    expect(bundle.reports[0].videoFile.base64).toBe('b2xkZXI=')
    expect(bundle.reports[1].videoFile.name).toBe('newer.mp4')
  })

  it('keeps the diagnostic and marks a missing copied video honestly', async () => {
    const bundle = await buildProblemReportExport([report('missing', 100)], async () => null, 200)

    expect(bundle.reportCount).toBe(1)
    expect(bundle.reports[0].videoFile.missing).toBe(true)
    expect(bundle.reports[0].videoFile.base64).toBeUndefined()
    expect(bundle.reports[0].note).toBe('The elbow flag is wrong.')
  })
})
