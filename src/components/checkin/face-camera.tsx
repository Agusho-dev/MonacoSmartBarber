'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  initFaceModels,
  detectFace,
  matchFaceInDB,
  captureFrameAsBlob,
  areModelsLoaded,
  type FaceDetectionResult,
  type FaceMatchResult,
  type FaceLandmarkPoint,
} from '@/lib/face-recognition'
import { drawFaceOverlayWithMesh } from '@/lib/face-mesh'
import { Loader2, Camera, KeyboardIcon, UserCheck, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface FaceCameraProps {
  onMatch: (match: FaceMatchResult, descriptor: Float32Array, photoBlob: Blob | null) => void
  onNoMatch: (descriptor: Float32Array, photoBlob: Blob | null) => void
  onManualEntry: () => void
  branchName?: string
  targetRole?: 'client' | 'staff'
  orgId?: string | null
  /** Estilo kiosk neón (terminal de check-in). */
  variant?: 'default' | 'terminal'
  /** Fondo claro activo — adapta textos y bordes al tema claro. */
  isLightBg?: boolean
}

type CameraState =
  | 'loading_models'
  | 'requesting_camera'
  | 'scanning'
  | 'detected'
  | 'matching'
  | 'matched'
  | 'no_match'
  | 'error'

const SCAN_INTERVAL_MS = 200
const MATCH_HOLD_MS = 1000
const CONSECUTIVE_MATCHES_REQUIRED = 2 // confirmaciones consecutivas antes de aceptar un match
const MIN_FACE_WIDTH_RATIO = 0.08 // cara debe ocupar al menos 8% del ancho del video
const MAX_NO_MATCH_ATTEMPTS = 3 // tras N no-matches consecutivos pedimos teléfono y actualizamos descriptores

export function FaceCamera({
  onMatch,
  onNoMatch,
  onManualEntry,
  branchName,
  targetRole = 'client',
  orgId,
  variant = 'default',
  isLightBg = false,
}: FaceCameraProps) {
  const isTerminal = variant === 'terminal'
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const [state, setState] = useState<CameraState>('loading_models')
  const [matchResult, setMatchResult] = useState<FaceMatchResult | null>(null)
  const [lastDescriptor, setLastDescriptor] = useState<Float32Array | null>(null)
  const lastPhotoBlobRef = useRef<Blob | null>(null)
  const [faceBox, setFaceBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const consecutiveMatchRef = useRef<{ clientId: string; count: number } | null>(null)
  const noMatchCountRef = useRef(0)
  const landmarksRef = useRef<FaceLandmarkPoint[] | null>(null)
  const faceBoxRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const faceValidRef = useRef(false)
  const meshAnimRef = useRef<number | null>(null)
  const showMeshRef = useRef(false)

  const stopCamera = useCallback(() => {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current)
      scanTimerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const startCamera = useCallback(async () => {
    setState('requesting_camera')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } },
        audio: false,
      })
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setState('scanning')
      }
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false

    const boot = async () => {
      await initFaceModels()
      if (cancelled) return
      await startCamera()
    }

    boot()

    return () => {
      cancelled = true
      mountedRef.current = false
      stopCamera()
    }
  }, [startCamera, stopCamera])

  const drawFaceOverlay = useCallback(
    (detection: FaceDetectionResult | null, isValid: boolean = false) => {
      if (detection) {
        const { x, y, width, height } = detection.box
        faceBoxRef.current = { x, y, width, height }
        landmarksRef.current = detection.landmarks
        faceValidRef.current = isValid
        setFaceBox({ x, y, w: width, h: height })
      } else {
        faceBoxRef.current = null
        landmarksRef.current = null
        faceValidRef.current = false
        setFaceBox(null)
      }
    },
    []
  )

  // Loop de animación — solo dibuja la malla cuando la cara está quieta y validada
  useEffect(() => {
    const animate = () => {
      const canvas = canvasRef.current
      const video = videoRef.current
      if (canvas && video && video.videoWidth > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')!

        if (showMeshRef.current && landmarksRef.current) {
          drawFaceOverlayWithMesh(
            ctx,
            canvas.width,
            canvas.height,
            landmarksRef.current,
            faceBoxRef.current,
            faceValidRef.current,
            { time: Date.now() }
          )
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
        }
      }
      meshAnimRef.current = requestAnimationFrame(animate)
    }
    meshAnimRef.current = requestAnimationFrame(animate)
    return () => {
      if (meshAnimRef.current) cancelAnimationFrame(meshAnimRef.current)
    }
  }, [])

  const runScanLoop = useCallback(async () => {
    if (!mountedRef.current || !videoRef.current || !areModelsLoaded()) return
    if (state !== 'scanning') return

    const detection = await detectFace(videoRef.current)
    if (!mountedRef.current || state !== 'scanning') return

    let isFaceValid = false
    if (detection) {
      const { x, y, width, height } = detection.box
      const videoW = videoRef.current.videoWidth
      const videoH = videoRef.current.videoHeight

      const faceCenterX = x + width / 2
      const faceCenterY = y + height / 2

      // Cara centrada, tamaño mínimo
      isFaceValid = (
        faceCenterX > videoW * 0.20 &&
        faceCenterX < videoW * 0.80 &&
        faceCenterY > videoH * 0.15 &&
        faceCenterY < videoH * 0.85 &&
        width >= videoW * MIN_FACE_WIDTH_RATIO
      )
    }

    drawFaceOverlay(detection, isFaceValid)

    if (detection && isFaceValid) {
      // Activar malla de puntos cuando la cara está validada y quieta
      showMeshRef.current = true
      setState('matching')
      setLastDescriptor(detection.descriptor)
      // Capturar foto del frame actual — queda cacheada por si hay que enviarla en el onNoMatch
      const currentPhoto = videoRef.current ? await captureFrameAsBlob(videoRef.current) : null
      lastPhotoBlobRef.current = currentPhoto

      const match = await matchFaceInDB(detection.descriptor, targetRole, orgId)
      if (!mountedRef.current) return

      if (match) {
        // Requiere confirmaciones consecutivas del mismo cliente para evitar falsos positivos
        const prev = consecutiveMatchRef.current
        if (prev && prev.clientId === match.clientId) {
          prev.count += 1
        } else {
          consecutiveMatchRef.current = { clientId: match.clientId, count: 1 }
        }

        if (consecutiveMatchRef.current && consecutiveMatchRef.current.count >= CONSECUTIVE_MATCHES_REQUIRED) {
          consecutiveMatchRef.current = null
          noMatchCountRef.current = 0
          setState('matched')
          setMatchResult(match)
          setTimeout(() => {
            if (mountedRef.current) onMatch(match, detection.descriptor, currentPhoto)
          }, MATCH_HOLD_MS)
        } else {
          // Aún no suficientes confirmaciones, seguir escaneando
          setState('scanning')
        }
      } else {
        consecutiveMatchRef.current = null
        showMeshRef.current = false
        noMatchCountRef.current += 1

        if (noMatchCountRef.current >= MAX_NO_MATCH_ATTEMPTS) {
          // Tras N intentos, pasamos al flujo manual por teléfono llevando el último
          // descriptor y la foto capturada para re-enrolar al cliente real.
          const descriptorToSend = detection.descriptor
          const photoToSend = currentPhoto
          noMatchCountRef.current = 0
          setState('no_match')
          setTimeout(() => {
            if (mountedRef.current) onNoMatch(descriptorToSend, photoToSend)
          }, MATCH_HOLD_MS)
          return
        }

        setState('no_match')
        setTimeout(() => {
          if (mountedRef.current) {
            setState('scanning')
          }
        }, 2000)
      }
    } else {
      consecutiveMatchRef.current = null
      showMeshRef.current = false
      // Auto-recursión via setTimeout: la referencia a runScanLoop se resuelve
      // en runtime cuando el callback se ejecuta (no en declaración).
      // eslint-disable-next-line react-hooks/immutability
      scanTimerRef.current = setTimeout(runScanLoop, SCAN_INTERVAL_MS)
    }
  }, [state, drawFaceOverlay, onMatch, onNoMatch, targetRole, orgId])

  useEffect(() => {
    if (state === 'scanning') {
      scanTimerRef.current = setTimeout(runScanLoop, SCAN_INTERVAL_MS)
    }
    return () => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
    }
  }, [state, runScanLoop])

  const handleManualNoMatch = () => {
    if (lastDescriptor) {
      onNoMatch(lastDescriptor, lastPhotoBlobRef.current)
    } else {
      onManualEntry()
    }
  }

  const statusLabel = () => {
    switch (state) {
      case 'loading_models':
        return 'Cargando sistema de reconocimiento...'
      case 'requesting_camera':
        return 'Accediendo a la cámara...'
      case 'scanning':
        return faceBox ? 'Cara detectada, analizando...' : 'Acercá tu cara a la cámara'
      case 'matching':
        return 'Buscando en el sistema...'
      case 'matched':
        return '¡Te encontramos!'
      case 'no_match':
        return 'No te reconocemos aún'
      case 'error':
        return 'No se pudo acceder a la cámara'
      default:
        return ''
    }
  }

  const statusColor = () => {
    switch (state) {
      case 'matched':
        return 'text-emerald-400'
      case 'no_match':
      case 'error':
        return 'text-orange-400'
      default:
        return 'text-muted-foreground'
    }
  }

  return (
    <div className="relative z-[1] w-full max-w-sm md:max-w-md flex flex-col items-center gap-2 md:gap-3 flex-1 min-h-0">
      <div className="text-center">
        <h2
          className={
            isTerminal
              ? isLightBg
                ? 'text-2xl md:text-3xl font-bold tracking-tight text-zinc-900'
                : 'text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-cyan-200 via-white to-violet-200 bg-clip-text text-transparent'
              : 'text-2xl md:text-3xl font-bold'
          }
        >
          Check-in
        </h2>
        {branchName && (
          <p
            className={
              isTerminal
                ? isLightBg
                  ? 'mt-1 md:mt-2 text-base md:text-lg text-zinc-600'
                  : 'mt-1 md:mt-2 text-base md:text-lg text-cyan-100/55'
                : 'text-muted-foreground mt-1 md:mt-2 text-base md:text-lg'
            }
          >
            {branchName}
          </p>
        )}
      </div>

      {/* Camera viewport */}
      <div
        className={
          isTerminal
            ? isLightBg
              ? 'relative w-full aspect-[3/4] max-h-[55dvh] rounded-2xl overflow-hidden bg-zinc-950/80 border border-zinc-300 shadow-lg shrink'
              : 'relative w-full aspect-[3/4] max-h-[55dvh] rounded-2xl overflow-hidden bg-zinc-950/80 border border-cyan-400/25 shadow-[0_0_40px_rgba(34,211,238,0.15)] shrink'
            : 'relative w-full aspect-[3/4] max-h-[55dvh] rounded-2xl overflow-hidden bg-black/50 border border-white/10 shrink'
        }
      >
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover mirror"
          playsInline
          muted
          style={{ transform: 'scaleX(-1)' }}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ transform: 'scaleX(-1)' }}
        />

        {/* Oval guide overlay */}
        {(state === 'scanning' || state === 'matching') && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className={`w-56 h-72 md:w-64 md:h-80 rounded-full border-2 border-dashed transition-colors duration-300 ${
                faceBox
                  ? 'border-emerald-400 shadow-[0_0_30px_rgba(34,197,94,0.3)]'
                  : isTerminal
                    ? 'border-cyan-400/40 shadow-[0_0_24px_rgba(34,211,238,0.2)]'
                    : 'border-white/20'
              }`}
            />
          </div>
        )}

        {/* Loading overlay */}
        {(state === 'loading_models' || state === 'requesting_camera') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
            <Loader2 className="size-12 animate-spin text-white/60 mb-4" />
            <p className="text-white/70 text-lg">{statusLabel()}</p>
          </div>
        )}

        {/* Match overlay */}
        {state === 'matched' && matchResult && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="size-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mb-4">
              <UserCheck className="size-10 text-emerald-400" />
            </div>
            <p className="text-3xl font-bold text-white">{matchResult.clientName}</p>
            <p className="text-emerald-400 mt-2 text-lg">¡Bienvenido de vuelta!</p>
          </div>
        )}

        {/* No match overlay */}
        {state === 'no_match' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="size-20 rounded-full bg-orange-500/20 border-2 border-orange-400 flex items-center justify-center mb-4">
              <XCircle className="size-10 text-orange-400" />
            </div>
            <p className="text-xl font-bold text-white">No te reconocemos</p>
            <p className="text-orange-400/80 mt-2">
              {noMatchCountRef.current === 0
                ? 'Pedíte el ingreso manual'
                : `Reintentando... (${noMatchCountRef.current}/${MAX_NO_MATCH_ATTEMPTS})`}
            </p>
          </div>
        )}

        {/* Error overlay */}
        {state === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
            <Camera className="size-12 text-white/40 mb-4" />
            <p className="text-white/70 text-lg text-center px-6">
              No se pudo acceder a la cámara.
              <br />
              Usá el ingreso manual.
            </p>
          </div>
        )}

        {/* Scanning pulse */}
        {state === 'matching' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-4 py-2">
              <Loader2 className="size-4 animate-spin text-white/60" />
              <span className="text-sm text-white/70">Buscando...</span>
            </div>
          </div>
        )}
      </div>

      {/* Status text */}
      <p className={`text-base md:text-lg font-medium text-center transition-colors shrink-0 ${statusColor()}`}>
        {statusLabel()}
      </p>

      {/* Manual entry button */}
      <Button
        onClick={state === 'no_match' ? handleManualNoMatch : onManualEntry}
        variant="outline"
        className={
          isTerminal
            ? isLightBg
              ? 'w-full h-11 md:h-12 text-sm md:text-base rounded-xl gap-2 md:gap-3 shrink-0 border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50 hover:text-zinc-900 hover:border-zinc-400'
              : 'w-full h-11 md:h-12 text-sm md:text-base rounded-xl gap-2 md:gap-3 shrink-0 border-cyan-500/25 bg-zinc-950/50 text-cyan-100 hover:bg-cyan-950/40 hover:text-white hover:border-cyan-400/40'
            : 'w-full h-11 md:h-12 text-sm md:text-base rounded-xl gap-2 md:gap-3 shrink-0'
        }
      >
        <KeyboardIcon className="size-5" />
        Soy Nuevo
      </Button>
    </div>
  )
}
