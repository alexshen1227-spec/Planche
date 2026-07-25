interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  rot: number
  vr: number
  color: string
  life: number
}

let canvas: HTMLCanvasElement | null = null
let raf = 0
let particles: Particle[] = []

const COLORS = ['#ffb224', '#ff7a2e', '#ffd166', '#5b9be6', '#4ade80', '#f5f5f5']

function ensureCanvas(): CanvasRenderingContext2D | null {
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999'
    document.body.appendChild(canvas)
  }
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  return canvas.getContext('2d')
}

function loop() {
  const ctx = canvas?.getContext('2d')
  if (!ctx || !canvas) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  particles = particles.filter((p) => p.life > 0 && p.y < canvas!.height + 40)
  for (const p of particles) {
    p.vy += 0.16
    p.vx *= 0.992
    p.x += p.vx
    p.y += p.vy
    p.rot += p.vr
    p.life -= 1
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.rot)
    ctx.globalAlpha = Math.min(1, p.life / 40)
    ctx.fillStyle = p.color
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
    ctx.restore()
  }
  if (particles.length > 0) {
    raf = requestAnimationFrame(loop)
  } else {
    canvas.remove()
    canvas = null
  }
}

/** Fire a celebratory burst. intensity 1 = PR, 2 = unlock-grade. */
export function confetti(intensity = 1) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const ctx = ensureCanvas()
  if (!ctx || !canvas) return
  const count = 90 * intensity
  const cx = canvas.width / 2
  for (let i = 0; i < count; i++) {
    const angle = Math.PI * (1.15 + Math.random() * 0.7) // upward-ish fan
    const speed = 6 + Math.random() * 9 * intensity
    particles.push({
      x: cx + (Math.random() - 0.5) * canvas.width * 0.35,
      y: canvas.height * 0.75,
      vx: Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1),
      vy: Math.sin(angle) * speed,
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 90 + Math.random() * 60,
    })
  }
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(loop)
}
