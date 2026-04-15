/**
 * Malla punteada densa estilo Face ID sobre el rostro.
 * Solo puntos (sin líneas). Pre-calcula la grilla de puntos una vez
 * y en cada frame solo dibuja los puntos con animación ligera.
 */

import type { FaceLandmarkPoint } from './face-recognition'

interface DrawFaceMeshOptions {
  color?: string
  glowColor?: string
  time?: number
  gridSpacing?: number
  dotRadius?: number
}

// ── Cache de puntos pre-calculados ──

interface CachedGrid {
  /** Puntos de la grilla con metadata pre-calculada */
  points: { x: number; y: number; normDist: number; edgeFade: number; isKey: boolean }[]
  cx: number
  cy: number
  maxR: number
  /** Fingerprint de los landmarks para invalidar cache */
  key: string
}

let _cache: CachedGrid | null = null

/** Genera una key simple basada en posiciones de unos pocos landmarks */
function landmarkKey(lm: FaceLandmarkPoint[]): string {
  // Usar 5 puntos representativos: mentón, nariz, ojos
  const pts = [lm[8], lm[30], lm[36], lm[45], lm[27]]
  return pts.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join('|')
}

/** Contorno facial: jawline (0-16) + frente estimada */
function buildFaceContour(lm: FaceLandmarkPoint[]): FaceLandmarkPoint[] {
  const jaw = lm.slice(0, 17)
  const browTop = [...lm.slice(22, 27)].reverse().concat([...lm.slice(17, 22)].reverse())
  const jawBottom = lm[8].y
  const browAvgY = browTop.reduce((s, p) => s + p.y, 0) / browTop.length
  const rise = (jawBottom - browAvgY) * 0.45

  return [...jaw, ...browTop.map(p => ({ x: p.x, y: p.y - rise }))]
}

/** Point-in-polygon (ray casting) */
function isInside(px: number, py: number, c: FaceLandmarkPoint[]): boolean {
  let inside = false
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const yi = c[i].y, yj = c[j].y
    if ((yi > py) !== (yj > py) && px < ((c[j].x - c[i].x) * (py - yi)) / (yj - yi) + c[i].x) {
      inside = !inside
    }
  }
  return inside
}

/** Pre-calcular grilla de puntos dentro del contorno */
function buildGrid(landmarks: FaceLandmarkPoint[], spacing: number): CachedGrid {
  const contour = buildFaceContour(landmarks)

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of contour) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  minX -= spacing; minY -= spacing; maxX += spacing; maxY += spacing

  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const maxR = Math.hypot(maxX - minX, maxY - minY) / 2

  const points: CachedGrid['points'] = []

  // Grilla densa
  for (let y = minY; y <= maxY; y += spacing) {
    for (let x = minX; x <= maxX; x += spacing) {
      if (!isInside(x, y, contour)) continue

      const distCenter = Math.hypot(x - cx, y - cy)
      const normDist = distCenter / maxR

      // Edge fade: distancia mínima al contorno (sampling rápido, solo ~10 puntos del contorno)
      let minD = Infinity
      const step = Math.max(1, Math.floor(contour.length / 12))
      for (let i = 0; i < contour.length; i += step) {
        const d = Math.hypot(x - contour[i].x, y - contour[i].y)
        if (d < minD) minD = d
      }

      points.push({
        x, y,
        normDist,
        edgeFade: Math.min(minD / 15, 1),
        isKey: false,
      })
    }
  }

  // Landmarks reales como puntos clave
  for (const p of landmarks) {
    const distCenter = Math.hypot(p.x - cx, p.y - cy)
    points.push({
      x: p.x, y: p.y,
      normDist: distCenter / maxR,
      edgeFade: 1,
      isKey: true,
    })
  }

  return { points, cx, cy, maxR, key: landmarkKey(landmarks) }
}

// ── Dibujo por frame (rápido) ──

export function drawFaceMesh(
  ctx: CanvasRenderingContext2D,
  landmarks: FaceLandmarkPoint[],
  _cw: number,
  _ch: number,
  options: DrawFaceMeshOptions = {}
) {
  const {
    color = '#22d3ee',
    glowColor = 'rgba(34, 211, 238, 0.35)',
    time = Date.now(),
    gridSpacing = 7,
    dotRadius = 1.5,
  } = options

  if (landmarks.length < 68) return

  // Re-calcular grilla solo si los landmarks cambiaron significativamente
  const key = landmarkKey(landmarks)
  if (!_cache || _cache.key !== key) {
    _cache = buildGrid(landmarks, gridSpacing)
  }
  const { points, maxR } = _cache

  // Animación ligera por frame
  const pulse = 0.85 + 0.15 * Math.sin(time * 0.004)
  const scanRadius = ((time * 0.1) % (maxR * 1.6))
  const scanWidth = maxR * 0.28

  ctx.save()
  ctx.fillStyle = color
  ctx.shadowColor = glowColor
  ctx.shadowBlur = 4

  for (let i = 0; i < points.length; i++) {
    const p = points[i]

    // Scan wave boost
    const distCenter = p.normDist * maxR
    const distToScan = Math.abs(distCenter - scanRadius)
    const scanBoost = distToScan < scanWidth ? 1 + (1 - distToScan / scanWidth) * 2 : 1

    if (p.isKey) {
      // Landmarks: más grandes y brillantes
      ctx.globalAlpha = Math.min(0.9 * pulse * scanBoost, 1)
      ctx.shadowBlur = 8
      const r = dotRadius * 2 * Math.min(scanBoost, 1.4)
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fill()
    } else {
      const depthScale = 1 - p.normDist * 0.4
      const alpha = 0.55 * pulse * p.edgeFade * depthScale * scanBoost
      if (alpha < 0.05) continue

      ctx.globalAlpha = Math.min(alpha, 0.95)
      ctx.shadowBlur = scanBoost > 1.5 ? 6 : 3
      const r = dotRadius * depthScale * Math.min(scanBoost, 1.6)
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.restore()
}

/** Versión todo-en-uno */
export function drawFaceOverlayWithMesh(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  landmarks: FaceLandmarkPoint[] | null,
  box: { x: number; y: number; width: number; height: number } | null,
  isValid: boolean,
  options?: DrawFaceMeshOptions
) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)
  if (!box || !landmarks || landmarks.length < 68) return

  drawFaceMesh(ctx, landmarks, canvasWidth, canvasHeight, {
    color: isValid ? '#22c55e' : '#22d3ee',
    glowColor: isValid ? 'rgba(34, 197, 94, 0.4)' : 'rgba(34, 211, 238, 0.35)',
    ...options,
  })
}
