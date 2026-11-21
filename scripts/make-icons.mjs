// Draws the app icon as PNGs from the same geometry as public/icon.svg.
//
//   node scripts/make-icons.mjs
//
// iOS ignores an SVG manifest icon: without a PNG apple-touch-icon the home
// screen shows a thumbnail of the page. The shapes are few and simple, so they
// are rasterised here directly (4×4 supersampling) and encoded with zlib —
// no image library to install, and the output is reproducible byte for byte.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const BG = [0x0b, 0x0d, 0x10]
const FROM = [0xff, 0xb2, 0x24]
const TO = [0xff, 0x7a, 0x2e]
const FLOOR = [0x3a, 0x41, 0x4b]

/** The glyph in the SVG's own 512-unit space. */
const SHAPES = [
  { kind: 'circle', cx: 392, cy: 212, r: 52, fill: 'gradient' },
  { kind: 'rect', x: 84, y: 222, w: 256, h: 56, r: 28, fill: 'gradient' },
  { kind: 'rect', x: 196, y: 278, w: 54, h: 132, r: 27, fill: 'gradient' },
  { kind: 'rect', x: 140, y: 422, w: 180, h: 18, r: 9, fill: 'floor' },
]

function inRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
}

function bounds(shape) {
  return shape.kind === 'circle'
    ? { x: shape.cx - shape.r, y: shape.cy - shape.r, w: 2 * shape.r, h: 2 * shape.r }
    : { x: shape.x, y: shape.y, w: shape.w, h: shape.h }
}

/** The colour of the glyph at a point in 512-space, or null where there is none. */
function glyphAt(px, py) {
  for (let i = SHAPES.length - 1; i >= 0; i--) {
    const s = SHAPES[i]
    const hit = s.kind === 'circle' ? (px - s.cx) ** 2 + (py - s.cy) ** 2 <= s.r * s.r : inRoundedRect(px, py, s.x, s.y, s.w, s.h, s.r)
    if (!hit) continue
    if (s.fill === 'floor') return FLOOR
    // A linear gradient along the shape's own bounding-box diagonal, as in the SVG.
    const b = bounds(s)
    const t = Math.min(1, Math.max(0, ((px - b.x) / b.w + (py - b.y) / b.h) / 2))
    return FROM.map((c, k) => c + (TO[k] - c) * t)
  }
  return null
}

/**
 * @param size   output edge in pixels
 * @param corner background corner radius in 512-space (0 = full bleed)
 * @param scale  glyph scale about the centre (a maskable icon keeps it inside the safe zone)
 */
function render(size, corner, scale) {
  const SS = 4
  const data = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // Sample position in 512-space.
          const px = ((x + (sx + 0.5) / SS) / size) * 512
          const py = ((y + (sy + 0.5) / SS) / size) * 512
          if (corner > 0 && !inRoundedRect(px, py, 0, 0, 512, 512, corner)) continue
          const gx = (px - 256) / scale + 256
          const gy = (py - 256) / scale + 256
          const colour = glyphAt(gx, gy) ?? BG
          r += colour[0]
          g += colour[1]
          b += colour[2]
          a += 1
        }
      }
      const i = (y * size + x) * 4
      const n = SS * SS
      if (a > 0) {
        data[i] = Math.round(r / a)
        data[i + 1] = Math.round(g / a)
        data[i + 2] = Math.round(b / a)
      }
      data[i + 3] = Math.round((a / n) * 255)
    }
  }
  return data
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, body) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const tagged = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(tagged))
  return Buffer.concat([length, tagged, crc])
}
function png(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0 // no filter
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const ICONS = [
  // The SVG as it is: rounded corners, transparent outside them.
  { file: 'icon-192.png', size: 192, corner: 116, scale: 1 },
  { file: 'icon-512.png', size: 512, corner: 116, scale: 1 },
  // Full bleed, glyph inside the central 80%: Android cuts its own shape out of it.
  { file: 'icon-maskable-512.png', size: 512, corner: 0, scale: 0.82 },
  // Full bleed: iOS rounds the corners itself and shows transparency as black.
  { file: 'apple-touch-icon.png', size: 180, corner: 0, scale: 0.92 },
]

for (const icon of ICONS) {
  const bytes = png(icon.size, render(icon.size, icon.corner, icon.scale))
  writeFileSync(join(OUT, icon.file), bytes)
  console.log(`${icon.file}  ${icon.size}×${icon.size}  ${bytes.length} bytes`)
}
