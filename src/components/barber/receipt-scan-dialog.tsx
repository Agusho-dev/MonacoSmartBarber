'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Smartphone, SwitchCamera, ImagePlus, ScanLine, Check, AlertTriangle,
  RefreshCw, Loader2, QrCode,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { compressToWebP } from '@/lib/image-utils'
import { parseComprobanteAR } from '@/lib/receipts/parse-ar'
import { createReceiptUploadSession, pollReceiptUpload } from '@/lib/actions/receipts'
import type { ExtractedReceipt } from '@/lib/receipts/schema'
import type { ReceiptEngine, ReceiptStatus } from '@/lib/types/database'
import { vibrate, playSuccessBeep, playWarnBeep, primeAudioContext } from '@/lib/barber-feedback'
import { formatCurrency } from '@/lib/format'

export interface ReceiptScanResult {
  receiptId: string
  status: ReceiptStatus
  extracted: ExtractedReceipt | null
  amountMatches: boolean | null
  aliasMatches: boolean | null
}

interface ReceiptScanDialogProps {
  open: boolean
  /** Motor de lectura elegido por la org: 'ai' (Claude, paga) | 'ocr' (Tesseract, gratis). */
  engine: ReceiptEngine
  /** Monto que se está cobrando (para validar contra el comprobante). */
  expectedAmount: number
  branchId: string
  barberId: string | null
  paymentAccountId: string | null
  clientId: string | null
  onClose: () => void
  /** El barbero acepta el comprobante (verificado, o "cobrar igual" pese a un problema). */
  onAccept: (result: ReceiptScanResult) => void
}

type Phase = 'starting' | 'invite' | 'reading' | 'result'

// Detector de la pantalla del comprobante. Aísla la región brillante MÁS GRANDE
// (la pantalla del cel — ignora luces de techo sueltas), exige que entre COMPLETA
// dentro del recuadro (sin tocar bordes) y centrada. Sólo entonces habilita la
// auto-captura, que además requiere un "hold" de ~1.4s (da tiempo a acomodar).
const SMALL_W = 48
const SMALL_H = 64            // el mini-canvas respeta el 3:4 del viewport
const READY_TICKS = 6        // ~6 * 250ms ≈ 1.5s bien encuadrado antes de disparar
const SKIP_TOP = 0.14        // banda superior IGNORADA: ahí vive la luz del techo (tablet fija)

interface FrameResult { ready: boolean; hint: string; black: boolean }

// Optimizado para tablets flojas: reusa los buffers (cero allocations por frame →
// sin presión de GC) y detecta "cámara sin señal" (frame casi negro).
function analyzeFrame(
  data: Uint8ClampedArray, W: number, H: number,
  bright: Uint8Array, label: Uint8Array, stack: number[],
): FrameResult {
  const skipTop = Math.round(H * SKIP_TOP)
  const N = W * H
  bright.fill(0)
  label.fill(0)
  let lumSum = 0
  // Sólo miramos por debajo de la banda del techo → la luz fija no contamina.
  for (let y = skipTop; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const j = y * W + x
      const i = j * 4
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      lumSum += lum
      bright[j] = lum > 150 ? 1 : 0
    }
  }
  // Componente brillante conexo más grande = la pantalla del cel.
  let bestSize = 0, bMinX = 0, bMaxX = 0, bMinY = 0, bMaxY = 0, bSumX = 0, bSumY = 0
  for (let s = 0; s < N; s++) {
    if (!bright[s] || label[s]) continue
    let size = 0, minX = W, maxX = -1, minY = H, maxY = -1, sumX = 0, sumY = 0
    stack.length = 0; stack.push(s); label[s] = 1
    while (stack.length) {
      const p = stack.pop()!
      const x = p % W, y = (p / W) | 0
      size++; sumX += x; sumY += y
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (x > 0 && bright[p - 1] && !label[p - 1]) { label[p - 1] = 1; stack.push(p - 1) }
      if (x < W - 1 && bright[p + 1] && !label[p + 1]) { label[p + 1] = 1; stack.push(p + 1) }
      if (y > 0 && bright[p - W] && !label[p - W]) { label[p - W] = 1; stack.push(p - W) }
      if (y < H - 1 && bright[p + W] && !label[p + W]) { label[p + W] = 1; stack.push(p + W) }
    }
    if (size > bestSize) { bestSize = size; bMinX = minX; bMaxX = maxX; bMinY = minY; bMaxY = maxY; bSumX = sumX; bSumY = sumY }
  }

  const area = W * (H - skipTop)
  const black = lumSum / area < 12
  const coverage = bestSize / area
  if (coverage < 0.16) return { ready: false, hint: 'Mostrá la pantalla del comprobante', black }

  // ¿La pantalla toca los bordes del recuadro? → está cortada, falta pantalla.
  const mx = 2, my = 2
  const touchTop = bMinY <= skipTop + my
  const touchBottom = bMaxY >= H - 1 - my
  const touchLeft = bMinX <= mx
  const touchRight = bMaxX >= W - 1 - mx
  if (coverage > 0.86 || (touchTop && touchBottom) || (touchLeft && touchRight))
    return { ready: false, hint: 'Alejá el celular — que entre toda la pantalla', black }
  if (touchBottom) return { ready: false, hint: 'Subí el celular', black }
  if (touchTop) return { ready: false, hint: 'Bajá el celular', black }
  if (touchLeft) return { ready: false, hint: 'Movelo hacia la izquierda', black }   // preview espejado
  if (touchRight) return { ready: false, hint: 'Movelo hacia la derecha', black }
  if (coverage < 0.26) return { ready: false, hint: 'Acercá el celular', black }

  // Centrado (dentro del recuadro, por debajo de la banda del techo)
  const cx = (bSumX / bestSize) / W
  const cy = (bSumY / bestSize - skipTop) / (H - skipTop)
  const previewCx = 1 - cx
  if (previewCx < 0.40) return { ready: false, hint: 'Movelo hacia la derecha', black }
  if (previewCx > 0.60) return { ready: false, hint: 'Movelo hacia la izquierda', black }
  if (cy < 0.38) return { ready: false, hint: 'Bajá el celular', black }
  if (cy > 0.62) return { ready: false, hint: 'Subí el celular', black }
  return { ready: true, hint: 'Perfecto, mantené firme', black }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => {
      const s = String(r.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

function frameToWebp(video: HTMLVideoElement, maxW: number, quality: number): Promise<Blob> {
  const vw = video.videoWidth || 1280
  const vh = video.videoHeight || 960
  const ratio = Math.min(maxW / vw, 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vw * ratio)
  canvas.height = Math.round(vh * ratio)
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('capture failed'))), 'image/webp', quality),
  )
}

export function ReceiptScanDialog({
  open, engine, expectedAmount, branchId, barberId, paymentAccountId, clientId, onClose, onAccept,
}: ReceiptScanDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stableRef = useRef(0)
  const smallCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const priorReceiptId = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Buffers reusados por el detector (sin allocations por frame) + últimos valores
  // para cortar re-renders (sólo actualizamos estado cuando algo cambia).
  const brightBufRef = useRef<Uint8Array | null>(null)
  const labelBufRef = useRef<Uint8Array | null>(null)
  const stackBufRef = useRef<number[]>([])
  const lastHintRef = useRef('')
  const lastReadyRef = useRef(false)
  const lastHoldRef = useRef(0)
  const blackRef = useRef(0)

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [phase, setPhase] = useState<Phase>('starting')
  const [frozenUrl, setFrozenUrl] = useState<string | null>(null)
  const [camError, setCamError] = useState<string | null>(null)
  const [ocrProgress, setOcrProgress] = useState<number | null>(null)
  const [result, setResult] = useState<ReceiptScanResult | null>(null)
  const [displayAmount, setDisplayAmount] = useState(0)
  const [qrToken, setQrToken] = useState<string | null>(null)
  const [hint, setHint] = useState('Mostrá el comprobante en el recuadro')
  const [ready, setReady] = useState(false)
  const [hold, setHold] = useState(0)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])
  const stopLoop = useCallback(() => {
    if (loopRef.current) clearInterval(loopRef.current)
    loopRef.current = null
  }, [])
  const stopPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }, [])

  // ── Procesa un frame capturado: OCR (si corresponde) + endpoint ──
  const processCapture = useCallback(
    async (blob: Blob, method: 'front_camera' | 'gallery' | 'qr_upload') => {
      setPhase('reading')
      setFrozenUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
      stopStream()
      stopLoop()

      try {
        const base64 = await blobToBase64(blob)

        // Motor GRATIS: Tesseract corre en la tablet, sin costo de servidor.
        let parsed: ExtractedReceipt | null = null
        if (engine === 'ocr') {
          setOcrProgress(0)
          try {
            const Tesseract = (await import('tesseract.js')).default
            const { data } = await Tesseract.recognize(blob, 'spa', {
              logger: (m: { status: string; progress: number }) => {
                if (m.status === 'recognizing text') setOcrProgress(m.progress)
              },
            })
            parsed = parseComprobanteAR(data.text)
          } catch {
            parsed = null // → needs_review
          }
          setOcrProgress(null)
        }

        const res = await fetch('/api/comprobantes/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engine,
            imageBase64: base64,
            mediaType: 'image/webp',
            branchId,
            barberId,
            expectedAmount,
            paymentAccountId,
            clientId,
            captureMethod: method,
            parsed,
            priorReceiptId: priorReceiptId.current,
          }),
        })

        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
          setCamError(j.error || 'No se pudo procesar el comprobante.')
          setPhase('invite')
          return
        }

        const json = (await res.json()) as ReceiptScanResult
        priorReceiptId.current = json.receiptId
        setResult(json)
        setPhase('result')

        if (json.status === 'verified') {
          vibrate([40, 30, 80]); playSuccessBeep()
        } else {
          vibrate([60, 40, 60]); playWarnBeep()
        }
      } catch {
        setCamError('Falló el procesamiento. Reintentá.')
        setPhase('invite')
      }
    },
    [engine, expectedAmount, branchId, barberId, paymentAccountId, clientId, stopStream, stopLoop],
  )

  const capture = useCallback(async () => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return
    stopLoop()
    try {
      const blob = await frameToWebp(video, 1280, 0.85)
      await processCapture(blob, 'front_camera')
    } catch {
      setCamError('No se pudo capturar. Reintentá.')
    }
  }, [processCapture, stopLoop])

  // ── Detección de la pantalla en el recuadro → auto-captura + indicaciones ──
  const startStabilityLoop = useCallback(() => {
    stopLoop()
    stableRef.current = 0
    blackRef.current = 0
    lastHintRef.current = ''; lastReadyRef.current = false; lastHoldRef.current = 0
    setHold(0); setReady(false)
    const N = SMALL_W * SMALL_H
    if (!smallCanvasRef.current) {
      const c = document.createElement('canvas'); c.width = SMALL_W; c.height = SMALL_H
      smallCanvasRef.current = c
    }
    if (!brightBufRef.current) brightBufRef.current = new Uint8Array(N)
    if (!labelBufRef.current) labelBufRef.current = new Uint8Array(N)

    loopRef.current = setInterval(() => {
      const video = videoRef.current
      const canvas = smallCanvasRef.current
      if (!video || !canvas || video.readyState < 2) return
      const vw = video.videoWidth, vh = video.videoHeight
      if (!vw || !vh) return
      // Recorte central al 3:4 del viewport (lo que el usuario realmente ve).
      const targetAR = SMALL_W / SMALL_H
      let sw = vw, sh = vh, sx = 0, sy = 0
      if (vw / vh > targetAR) { sw = vh * targetAR; sx = (vw - sw) / 2 }
      else { sh = vw / targetAR; sy = (vh - sh) / 2 }
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, SMALL_W, SMALL_H)
      const { data } = ctx.getImageData(0, 0, SMALL_W, SMALL_H)

      const res = analyzeFrame(data, SMALL_W, SMALL_H, brightBufRef.current!, labelBufRef.current!, stackBufRef.current)

      // Cámara sin señal (frame negro) sostenida → empujar al fallback Foto/QR.
      let hint = res.hint
      let ready = res.ready
      if (res.black) {
        blackRef.current += 1
        if (blackRef.current >= 10) { hint = 'La cámara casi no da imagen — usá “Foto” o “QR”'; ready = false }
      } else {
        blackRef.current = 0
      }

      // Sólo re-render cuando algo CAMBIA (evita 5 renders/seg en tablets flojas).
      if (hint !== lastHintRef.current) { lastHintRef.current = hint; setHint(hint) }
      if (ready !== lastReadyRef.current) { lastReadyRef.current = ready; setReady(ready) }

      let newHold = 0
      if (ready) {
        stableRef.current += 1
        newHold = Math.min(1, stableRef.current / READY_TICKS)
        if (stableRef.current >= READY_TICKS) { stopLoop(); void capture() }
      } else {
        stableRef.current = 0
      }
      if (newHold !== lastHoldRef.current) { lastHoldRef.current = newHold; setHold(newHold) }
    }, 250)
  }, [stopLoop, capture])

  // ── Abrir/cerrar cámara ──
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPhase('starting'); setResult(null); setCamError(null); priorReceiptId.current = null; setQrToken(null); setReady(false); setHold(0)
    primeAudioContext()
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setPhase('invite')
        startStabilityLoop()
      } catch {
        setCamError('No pudimos abrir la cámara. Podés subir la foto del comprobante.')
        setPhase('invite')
      }
    })()
    return () => { cancelled = true; stopLoop(); stopStream(); stopPoll() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facingMode])

  // Limpieza de la object URL congelada
  useEffect(() => () => { if (frozenUrl) URL.revokeObjectURL(frozenUrl) }, [frozenUrl])

  // Count-up del monto leído en el estado de éxito
  useEffect(() => {
    if (phase !== 'result' || !result?.extracted?.amount) { setDisplayAmount(0); return }
    const target = result.extracted.amount
    const start = performance.now()
    const dur = 650
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur)
      setDisplayAmount(Math.round(target * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase, result])

  // Auto-finalizar: si el comprobante quedó VERIFICADO, avanzamos solos (sin tap).
  // Se muestra el éxito ~1.5s y luego se acepta → el cobro se cierra automáticamente.
  useEffect(() => {
    if (open && phase === 'result' && result?.status === 'verified') {
      const id = setTimeout(() => onAccept(result), 1500)
      return () => clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase, result])

  // ── Fallback QR: el cliente sube desde su propio celular ──
  async function startQr() {
    stopLoop(); stopStream(); setCamError(null)
    const res = await createReceiptUploadSession()
    if ('error' in res) { setCamError(res.error); return }
    const tk = res.token
    setQrToken(tk)
    stopPoll()
    pollRef.current = setInterval(async () => {
      const r = await pollReceiptUpload(tk)
      if ('url' in r) {
        stopPoll()
        try {
          const resp = await fetch(r.url)
          const blob = await resp.blob()
          setQrToken(null)
          await processCapture(blob, 'qr_upload')
        } catch {
          setCamError('No se pudo traer la imagen del celular.')
        }
      }
    }, 2500)
  }

  function cancelQr() {
    stopPoll(); setQrToken(null); retry()
  }

  function retry() {
    stopPoll(); setQrToken(null); setReady(false); setHold(0)
    setResult(null); setCamError(null); setPhase('starting')
    // re-open camera via facingMode toggle trick is heavy; just restart stream
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false,
        })
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}) }
        setPhase('invite'); startStabilityLoop()
      } catch {
        setCamError('No pudimos abrir la cámara. Subí la foto.'); setPhase('invite')
      }
    })()
  }

  function handleClose() {
    stopLoop(); stopStream(); stopPoll()
    onClose()
  }

  async function handleGallery(files: FileList | null) {
    if (!files?.length) return
    stopLoop(); stopStream()
    try {
      const blob = await compressToWebP(files[0], 1200, 0.82)
      await processCapture(blob, 'gallery')
    } catch {
      setCamError('No se pudo leer la imagen.')
    }
  }

  const extracted = result?.extracted
  const isVerified = result?.status === 'verified'
  const engineLabel = engine === 'ai' ? 'IA' : 'motor'

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md overflow-hidden p-0 gap-0" showCloseButton={false}>
        <DialogHeader className="p-5 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="size-5 text-emerald-500" />
            Escanear comprobante
          </DialogTitle>
          <DialogDescription>
            {phase === 'result'
              ? 'Resultado de la lectura'
              : 'El cliente acerca su comprobante a la pantalla'}
          </DialogDescription>
        </DialogHeader>

        {/* Viewport de cámara / frame congelado */}
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-black">
          {/* Video en vivo (invite) */}
          <video
            ref={videoRef}
            playsInline muted autoPlay
            onCanPlay={() => videoRef.current?.play().catch(() => {})}
            className={`absolute inset-0 size-full object-cover ${phase === 'invite' && !qrToken ? 'opacity-100' : 'opacity-0'}`}
            style={{ transform: 'scaleX(-1)' }}
          />
          {/* Frame congelado (reading/result) */}
          {frozenUrl && phase !== 'invite' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={frozenUrl} alt="Comprobante" className="absolute inset-0 size-full object-cover" />
          )}

          {/* Starting */}
          {phase === 'starting' && (
            <div className="absolute inset-0 grid place-items-center text-white/80">
              <Loader2 className="size-8 animate-spin" />
            </div>
          )}

          {/* Fallback QR: el cliente sube desde su celular */}
          {qrToken && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-neutral-950 px-6 text-center text-white">
              <p className="text-lg font-semibold">Escaneá con el celular del cliente</p>
              <div className="rounded-2xl bg-white p-4">
                <QRCodeSVG
                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}/upload-comprobante/${qrToken}`}
                  size={196}
                  level="M"
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-white/70">
                <Loader2 className="size-4 animate-spin" /> Esperando el comprobante…
              </div>
            </div>
          )}

          {/* Reticle + guía con indicaciones (invite) */}
          {phase === 'invite' && !qrToken && (
            <div className="pointer-events-none absolute inset-0">
              {/* Indicación arriba */}
              <div className="absolute inset-x-0 top-4 flex flex-col items-center gap-2 px-5">
                <div className={`flex items-center gap-2 rounded-full px-4 py-2 text-white shadow-lg backdrop-blur-sm transition-colors ${ready ? 'bg-emerald-600/90' : 'bg-black/65'}`}>
                  {ready ? <ScanLine className="size-4" /> : <Smartphone className="size-4 text-emerald-300" />}
                  <span className="text-sm font-semibold">{hint}</span>
                </div>
                {hold > 0 && (
                  <div className="h-1.5 w-44 overflow-hidden rounded-full bg-white/25">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.round(hold * 100)}%`, transition: 'width 0.18s linear' }} />
                  </div>
                )}
              </div>
              {/* Recuadro alineado a la zona que se analiza (debajo de la banda del techo) */}
              <div className="absolute" style={{ top: '14%', bottom: '4%', left: '9%', right: '9%' }}>
                {[
                  'top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-xl',
                  'top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-xl',
                  'bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-xl',
                  'bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-xl',
                ].map((pos, i) => (
                  <span
                    key={i}
                    className={`absolute ${pos} size-10 transition-colors ${ready ? 'border-emerald-400' : 'border-white/60'}`}
                    style={ready ? { boxShadow: '0 0 22px oklch(0.85 0.15 165 / 0.55)' } : undefined}
                  />
                ))}
              </div>
              {/* Nota abajo */}
              <p className="absolute inset-x-0 bottom-4 mx-auto w-fit rounded-full bg-black/45 px-3 py-1 text-xs text-white/85 backdrop-blur-sm">
                {ready ? 'Escaneando…' : 'O tocá “Capturar”'}
              </p>
            </div>
          )}

          {/* Reading: láser + dots */}
          {phase === 'reading' && (
            <div className="absolute inset-0 bg-black/25">
              <div className="scan-laser" />
              <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-3 text-white">
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="scan-dot size-2 rounded-full bg-emerald-400" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
                <p className="text-sm font-medium">
                  Leyendo comprobante… <span className="text-white/60">({engineLabel})</span>
                </p>
                {ocrProgress !== null && (
                  <div className="h-1 w-40 overflow-hidden rounded-full bg-white/20">
                    <div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.round(ocrProgress * 100)}%` }} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Result overlay */}
          {phase === 'result' && result && (
            <div className={`absolute inset-0 grid place-items-center backdrop-blur-sm ${isVerified ? 'bg-emerald-950/55' : 'bg-amber-950/55'}`}>
              <div className="flex flex-col items-center px-6 text-center">
                <div className={`animate-pro-celebrate grid size-24 place-items-center rounded-full border-2 pro-sweep ${isVerified ? 'border-emerald-400 bg-emerald-500/20' : 'border-amber-400 bg-amber-500/20'}`}>
                  {isVerified
                    ? <Check className="size-12 text-emerald-300" />
                    : <AlertTriangle className="size-11 text-amber-300" />}
                </div>
                {isVerified ? (
                  <>
                    <p className="mt-4 text-xl font-bold text-white">Comprobante verificado</p>
                    <p className="animate-scan-amount mt-1 text-4xl font-black tabular-nums text-emerald-300">
                      {formatCurrency(displayAmount)}
                    </p>
                    {extracted?.datetime && (
                      <p className="mt-1 text-sm text-white/70">{new Date(extracted.datetime).toLocaleString('es-AR')}</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="mt-4 text-lg font-bold text-white">
                      {result.status === 'duplicate' && 'Comprobante ya usado'}
                      {result.status === 'amount_mismatch' && 'El monto no coincide'}
                      {result.status === 'date_mismatch' && 'Comprobante viejo'}
                      {result.status === 'needs_review' && 'No pudimos leerlo'}
                    </p>
                    <p className="mt-1 max-w-[16rem] text-sm text-white/80">
                      {result.status === 'duplicate' && 'Este número de operación ya se registró en otro cobro.'}
                      {result.status === 'amount_mismatch' && extracted?.amount != null &&
                        `Leído ${formatCurrency(extracted.amount)} · esperado ${formatCurrency(expectedAmount)}.`}
                      {result.status === 'date_mismatch' && 'La fecha no corresponde a este cobro (es viejo o de otro día).'}
                      {result.status === 'needs_review' && 'La imagen quedó guardada para que un admin la revise.'}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Controles */}
        <div className="space-y-3 p-5">
          {camError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-center text-sm text-red-600 dark:text-red-400">
              {camError}
            </p>
          )}

          {phase === 'invite' && !qrToken && (
            <>
              <Button onClick={capture} size="lg" className="h-14 w-full text-base font-bold">
                <ScanLine className="mr-2 size-5" /> Capturar comprobante
              </Button>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="lg" className="h-12"
                  onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}>
                  <SwitchCamera className="mr-1.5 size-4" /> Cámara
                </Button>
                <Button variant="outline" size="lg" className="h-12" onClick={() => fileInputRef.current?.click()}>
                  <ImagePlus className="mr-1.5 size-4" /> Foto
                </Button>
                <Button variant="outline" size="lg" className="h-12" onClick={startQr}>
                  <QrCode className="mr-1.5 size-4" /> QR
                </Button>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => handleGallery(e.target.files)} />
            </>
          )}

          {qrToken && (
            <Button variant="outline" size="lg" className="h-12 w-full" onClick={cancelQr}>
              Cancelar y volver a la cámara
            </Button>
          )}

          {phase === 'reading' && (
            <Button disabled size="lg" className="h-14 w-full">
              <Loader2 className="mr-2 size-5 animate-spin" /> Procesando…
            </Button>
          )}

          {phase === 'result' && result && (
            isVerified ? (
              <div className="flex items-center justify-center gap-2 py-3 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                <Loader2 className="size-4 animate-spin" /> Finalizando el cobro…
              </div>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" size="lg" className="h-14 flex-1" onClick={retry}>
                  <RefreshCw className="mr-2 size-4" /> Reintentar
                </Button>
                <Button size="lg" className="h-14 flex-1 font-bold" onClick={() => onAccept(result)}>
                  {result.status === 'needs_review' ? 'Continuar' : 'Cobrar igual'}
                </Button>
              </div>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
