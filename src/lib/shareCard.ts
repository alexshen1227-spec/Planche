import type { AppState, StepId } from '../types'
import { STEPS, STEP_BY_ID } from '../data/progressions'
import { qualifyingProgress } from './progression'
import { readJourney } from './journey'
import { totalHoldSec } from './stats'
import { fmtDuration, fmtHold } from './time'
import { figureParts } from './figure'

const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A progress card the athlete can keep or share — made on the device, never
 * uploaded. Every number on it is one the app already shows, and each can be
 * absent: no verified hold yet says so rather than printing a zero.
 */
export interface ShareCardData {
  stepId: StepId
  stepName: string
  /** 1-based position on the road. */
  stepNumber: number
  totalSteps: number
  /** Best hold on this step with the full evidence chain (Clean + camera pass). */
  verifiedBest?: number
  bar: number
  nextName?: string
  weeksTraining?: number
  sessions: number
  heldSec: number
  /** Steps on the road, as the card draws them. */
  ladder: { stepId: StepId; state: 'cleared' | 'current' | 'ahead' }[]
  date: string
  /**
   * A card for the moment a step opens: the new step's figure, carrying the
   * verified hold on the step before that opened it.
   */
  milestone?: { fromName: string; fromBest?: number; early: boolean }
}

export function shareCardData(
  state: AppState,
  now = Date.now(),
  opened?: { stepId: StepId; via?: 'bar' | 'next-shape' },
): ShareCardData {
  const step = STEP_BY_ID[opened?.stepId ?? state.stepId]
  const from = opened ? STEPS.find((s) => s.order === step.order - 1) : undefined
  const fromBest = from ? qualifyingProgress(state, from.id).value : 0
  const best = qualifyingProgress(state, step.id).value
  const next = STEPS.find((s) => s.order === step.order + 1)
  const journey = readJourney(state, now)
  const d = new Date(now)
  return {
    stepId: step.id,
    stepName: step.name,
    stepNumber: step.order + 1,
    totalSteps: STEPS.length,
    ...(best > 0 ? { verifiedBest: best } : {}),
    bar: step.unlockSec,
    ...(next ? { nextName: next.name } : {}),
    ...(journey.firstSessionAt !== undefined
      ? { weeksTraining: Math.max(1, Math.ceil((now - journey.firstSessionAt + 1) / (7 * DAY))) }
      : {}),
    sessions: journey.totalSessions,
    heldSec: totalHoldSec(state),
    ladder: STEPS.map((s) => ({
      stepId: s.id,
      state: s.id === step.id ? 'current' : s.order < step.order ? 'cleared' : 'ahead',
    })),
    date: `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,
    ...(from
      ? { milestone: { fromName: from.name, ...(fromBest > 0 ? { fromBest } : {}), early: opened?.via === 'next-shape' } }
      : {}),
  }
}

/** The card's lines of text, decided apart from the drawing so they can be tested. */
export function shareCardLines(data: ShareCardData): { label: string; headline: string; caption: string; footer: string } {
  const label = `${data.milestone ? 'NEW STEP · ' : 'STEP '}${data.stepNumber} OF ${data.totalSteps}`
  const m = data.milestone
  const headline = m ? (m.fromBest !== undefined ? fmtHold(m.fromBest) : '—') : data.verifiedBest !== undefined ? fmtHold(data.verifiedBest) : '—'
  const caption = m
    ? m.fromBest !== undefined
      ? `verified ${m.fromName.toLowerCase()} · ${data.stepName} ${m.early ? 'opened early' : 'opened'}`
      : `${data.stepName} opened`
    : data.verifiedBest === undefined
      ? 'No verified hold on this step yet'
      : data.nextName
        ? `best verified hold · ${data.bar}s opens ${data.nextName}`
        : `best verified hold · ${data.bar}s is the bar`
  const footer = [
    data.weeksTraining !== undefined ? `${data.weeksTraining} week${data.weeksTraining === 1 ? '' : 's'} training` : null,
    `${data.sessions} session${data.sessions === 1 ? '' : 's'}`,
    data.heldSec > 0 ? `${fmtDuration(data.heldSec)} held` : null,
  ]
    .filter(Boolean)
    .join('  ·  ')
  return { label, headline, caption, footer }
}

export const CARD_W = 1080
export const CARD_H = 1350

const ACCENT = '#ffb224'
const ACCENT_STRONG = '#ef6c1a'
const DISPLAY = '"Space Grotesk Variable", "Inter Variable", system-ui, sans-serif'
const SANS = '"Inter Variable", system-ui, sans-serif'

/** Draw one figure from its 96×90 geometry at `scale`, top-left at (x, y). */
function drawFigure(
  ctx: CanvasRenderingContext2D,
  stepId: StepId,
  x: number,
  y: number,
  scale: number,
  ink: string | CanvasGradient,
  opts: { ground?: boolean; faint?: number } = {},
) {
  const parts = figureParts(stepId)
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const base = opts.faint ?? 1
  if (opts.ground !== false) {
    ctx.globalAlpha = 0.16 * base
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(parts.ground.x1, parts.ground.y)
    ctx.lineTo(parts.ground.x2, parts.ground.y)
    ctx.stroke()
  }
  if (parts.bars) {
    ctx.globalAlpha = 0.34 * base
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2.2
    ctx.stroke(new Path2D(parts.bars))
  }
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  for (const stroke of parts.strokes) {
    ctx.globalAlpha = (stroke.far ? 0.32 : 1) * base
    ctx.lineWidth = stroke.width
    ctx.stroke(new Path2D(stroke.d))
  }
  ctx.globalAlpha = base
  ctx.beginPath()
  ctx.arc(parts.head.cx, parts.head.cy, parts.head.r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** A rounded bar; `roundRect` is missing before iOS 16, so it is drawn by hand there. */
function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = Math.min(h / 2, w / 2)
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r)
  } else {
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
  ctx.fill()
}

/** Text that shrinks until it fits `maxWidth`. */
function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, family: string, maxWidth: number) {
  let s = size
  ctx.font = `${weight} ${s}px ${family}`
  while (ctx.measureText(text).width > maxWidth && s > 24) {
    s -= 4
    ctx.font = `${weight} ${s}px ${family}`
  }
}

/** Draw the card onto a canvas of CARD_W × CARD_H. */
export async function drawShareCard(canvas: HTMLCanvasElement, data: ShareCardData): Promise<void> {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This device cannot draw the card.')
  try {
    await Promise.all([document.fonts.load(`700 100px ${DISPLAY}`), document.fonts.load(`500 30px ${SANS}`)])
  } catch {
    // A font that will not load falls back to the system face.
  }
  const lines = shareCardLines(data)

  // Background and glow.
  const bg = ctx.createLinearGradient(0, 0, 0, CARD_H)
  bg.addColorStop(0, '#17120c')
  bg.addColorStop(1, '#0b0c0f')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  const glow = ctx.createRadialGradient(540, 520, 40, 540, 520, 560)
  glow.addColorStop(0, 'rgba(255, 150, 40, 0.26)')
  glow.addColorStop(1, 'rgba(255, 150, 40, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // Header.
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(255,255,255,0.62)'
  ctx.font = `700 30px ${DISPLAY}`
  ctx.textAlign = 'left'
  ctx.fillText('PLANCHE  LAB', 80, 110)
  ctx.textAlign = 'right'
  ctx.font = `500 30px ${SANS}`
  ctx.fillText(data.date, CARD_W - 80, 110)

  // The position itself.
  const ink = ctx.createLinearGradient(200, 260, 900, 760)
  ink.addColorStop(0, ACCENT)
  ink.addColorStop(1, ACCENT_STRONG)
  // Scaled ×9 the figure's floor sits at y ≈ 670, its body well above.
  drawFigure(ctx, data.stepId, 108, -60, 9, ink)

  // The road: every step, this one lit.
  const gap = 118
  const startX = (CARD_W - gap * (data.ladder.length - 1)) / 2
  data.ladder.forEach((stop, i) => {
    const cx = startX + i * gap
    const fig = stop.state === 'current' ? ink : '#ffffff'
    const faint = stop.state === 'current' ? 1 : stop.state === 'cleared' ? 0.7 : 0.22
    drawFigure(ctx, stop.stepId, cx - 48, 730, 1, fig, { ground: false, faint })
  })

  // Step and name.
  ctx.textAlign = 'left'
  ctx.fillStyle = ACCENT
  ctx.font = `700 32px ${DISPLAY}`
  ctx.fillText(lines.label, 80, 930)
  ctx.fillStyle = '#ffffff'
  fitText(ctx, data.stepName, 700, 100, DISPLAY, CARD_W - 160)
  ctx.fillText(data.stepName, 80, 1028)

  // The number, and what it is.
  const shown = data.milestone ? data.milestone.fromBest : data.verifiedBest
  ctx.fillStyle = shown !== undefined ? ACCENT : 'rgba(255,255,255,0.5)'
  ctx.font = `700 76px ${DISPLAY}`
  ctx.fillText(lines.headline, 80, 1140)
  const headW = ctx.measureText(lines.headline).width
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  fitText(ctx, lines.caption, 500, 30, SANS, CARD_W - 160 - headW - 28)
  ctx.fillText(lines.caption, 80 + headW + 28, 1130)

  // Progress to the bar — not on a milestone card, where the bar is behind you.
  if (data.verifiedBest !== undefined && !data.milestone) {
    const pct = Math.min(1, data.verifiedBest / data.bar)
    const barX = 80
    const barW = CARD_W - 160
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    bar(ctx, barX, 1172, barW, 12)
    ctx.fillStyle = ink
    bar(ctx, barX, 1172, Math.max(12, barW * pct), 12)
  }

  // Footer.
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.font = `500 28px ${SANS}`
  ctx.fillText(lines.footer, 80, 1290)
}

/** The card as a PNG file. */
export async function shareCardFile(data: ShareCardData): Promise<File> {
  const canvas = document.createElement('canvas')
  await drawShareCard(canvas, data)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The card could not be made on this device.')
  const slug = data.stepName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return new File([blob], `planche-lab-${slug}.png`, { type: 'image/png' })
}
