'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Smartphone, SwitchCamera, ImagePlus, ScanLine, Check, AlertTriangle,
  RefreshCw, Loader2,
} from 'lucide-react'
import { compressToWebP } from '@/lib/image-utils'
import { parseComprobanteAR } from '@/lib/receipts/parse-ar'
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
  paymentAccountId: string | null
  clientId: string | null
  onClose: () => void
  /** El barbero acepta el comprobante (verificado, o "cobrar igual" pese a un problema). */
  onAccept: (result: ReceiptScanResult) => void
}

type Phase = 'starting' | 'invite' | 'reading' | 'result'

// Umbrales del detector de estabilidad (auto-captura).
const SMALL_W = 64
const SMALL_H = 48
const DIFF_THRESHOLD = 6      // dif. media de gris entre frames → "quieto"
const CONTRAST_THRESHOLD = 34 // desvío de gris → "hay algo con texto" (no pared vacía)
const STABLE_TICKS = 5        // ~5 * 140ms ≈ 700ms quieto

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
  open, engine, expectedAmount, paymentAccountId, clientId, onClose, onAccept,
}: ReceiptScanDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevGrayRef = useRef<Float32Array | null>(null)
  const stableRef = useRef(0)
  const smallCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const priorReceiptId = useRef<string | null>(null)

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [phase, setPhase] = useState<Phase>('starting')
  const [frozenUrl, setFrozenUrl] = useState<string | null>(null)
  const [camError, setCamError] = useState<string | null>(null)
  const [ocrProgress, setOcrProgress] = useState<number | null>(null)
  const [result, setResult] = useState<ReceiptScanResult | null>(null)
  const [displayAmount, setDisplayAmount] = useState(0)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])
  const stopLoop = useCallback(() => {
    if (loopRef.current) clearInterval(loopRef.current)
    loopRef.current = null
  }, [])

  // ── Procesa un frame capturado: OCR (si corresponde) + endpoint ──
  const processCapture = useCallback(
    async (blob: Blob, fromGallery: boolean) => {
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
            expectedAmount,
            paymentAccountId,
            clientId,
            captureMethod: fromGallery ? 'gallery' : 'front_camera',
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
    [engine, expectedAmount, paymentAccountId, clientId, stopStream, stopLoop],
  )

  const capture = useCallback(async () => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return
    stopLoop()
    try {
      const blob = await frameToWebp(video, 1400, 0.85)
      await processCapture(blob, false)
    } catch {
      setCamError('No se pudo capturar. Reintentá.')
    }
  }, [processCapture, stopLoop])

  // ── Loop de estabilidad (auto-captura cuando el comprobante está quieto) ──
  const startStabilityLoop = useCallback(() => {
    stopLoop()
    prevGrayRef.current = null
    stableRef.current = 0
    if (!smallCanvasRef.current) {
      smallCanvasRef.current = document.createElement('canvas')
      smallCanvasRef.current.width = SMALL_W
      smallCanvasRef.current.height = SMALL_H
    }
    loopRef.current = setInterval(() => {
      const video = videoRef.current
      const canvas = smallCanvasRef.current
      if (!video || !canvas || video.readyState < 2) return
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(video, 0, 0, SMALL_W, SMALL_H)
      const { data } = ctx.getImageData(0, 0, SMALL_W, SMALL_H)
      const gray = new Float32Array(SMALL_W * SMALL_H)
      let sum = 0
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        gray[j] = g; sum += g
      }
      const mean = sum / gray.length
      let varSum = 0
      for (let j = 0; j < gray.length; j++) varSum += (gray[j] - mean) ** 2
      const contrast = Math.sqrt(varSum / gray.length)

      const prev = prevGrayRef.current
      if (prev) {
        let diff = 0
        for (let j = 0; j < gray.length; j++) diff += Math.abs(gray[j] - prev[j])
        diff /= gray.length
        if (diff < DIFF_THRESHOLD && contrast > CONTRAST_THRESHOLD) {
          stableRef.current += 1
          if (stableRef.current >= STABLE_TICKS) { void capture() }
        } else {
          stableRef.current = 0
        }
      }
      prevGrayRef.current = gray
    }, 140)
  }, [stopLoop, capture])

  // ── Abrir/cerrar cámara ──
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPhase('starting'); setResult(null); setCamError(null); priorReceiptId.current = null
    primeAudioContext()
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
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
    return () => { cancelled = true; stopLoop(); stopStream() }
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

  function retry() {
    setResult(null); setCamError(null); setPhase('starting')
    // re-open camera via facingMode toggle trick is heavy; just restart stream
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
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
    stopLoop(); stopStream()
    onClose()
  }

  async function handleGallery(files: FileList | null) {
    if (!files?.length) return
    stopLoop(); stopStream()
    try {
      const blob = await compressToWebP(files[0], 1400, 0.85)
      await processCapture(blob, true)
    } catch {
      setCamError('No se pudo leer la imagen.')
    }
  }

  const extracted = result?.extracted
  const isVerified = result?.status === 'verified'
  const engineLabel = engine === 'ai' ? 'IA' : 'motor'

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md overflow-hidden p-0 gap-0">
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
            playsInline muted
            className={`absolute inset-0 size-full object-cover ${phase === 'invite' ? 'opacity-100' : 'opacity-0'}`}
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

          {/* Reticle + guía (invite) */}
          {phase === 'invite' && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between p-5">
              <div className="reticle-breathe flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-white backdrop-blur-sm">
                <Smartphone className="size-4 text-emerald-300" />
                <span className="text-sm font-semibold">Acercá el comprobante</span>
              </div>
              <div className="relative reticle-breathe" style={{ width: '78%', aspectRatio: '3 / 4' }}>
                {[
                  'top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-xl',
                  'top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-xl',
                  'bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-xl',
                  'bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-xl',
                ].map((pos, i) => (
                  <span key={i} className={`absolute ${pos} size-9 border-emerald-400`} style={{ boxShadow: '0 0 18px oklch(0.85 0.15 165 / 0.35)' }} />
                ))}
              </div>
              <p className="rounded-full bg-black/45 px-3 py-1 text-xs text-white/85 backdrop-blur-sm">
                Se escanea solo cuando esté quieto
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
                      {result.status === 'needs_review' && 'No pudimos leerlo'}
                    </p>
                    <p className="mt-1 max-w-[16rem] text-sm text-white/80">
                      {result.status === 'duplicate' && 'Este número de operación ya se registró en otro cobro.'}
                      {result.status === 'amount_mismatch' && extracted?.amount != null &&
                        `Leído ${formatCurrency(extracted.amount)} · esperado ${formatCurrency(expectedAmount)}.`}
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

          {phase === 'invite' && (
            <>
              <Button onClick={capture} size="lg" className="h-14 w-full text-base font-bold">
                <ScanLine className="mr-2 size-5" /> Capturar comprobante
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="lg" className="h-12 flex-1"
                  onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}>
                  <SwitchCamera className="mr-2 size-4" /> Cámara
                </Button>
                <Button variant="outline" size="lg" className="h-12 flex-1" onClick={() => fileInputRef.current?.click()}>
                  <ImagePlus className="mr-2 size-4" /> Subir foto
                </Button>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => handleGallery(e.target.files)} />
            </>
          )}

          {phase === 'reading' && (
            <Button disabled size="lg" className="h-14 w-full">
              <Loader2 className="mr-2 size-5 animate-spin" /> Procesando…
            </Button>
          )}

          {phase === 'result' && result && (
            isVerified ? (
              <Button onClick={() => onAccept(result)} size="lg" className="h-14 w-full text-base font-bold">
                <Check className="mr-2 size-5" /> Continuar
              </Button>
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
