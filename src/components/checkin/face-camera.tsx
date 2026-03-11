'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  initFaceModels,
  detectFace,
  matchFaceInDB,
  areModelsLoaded,
  type FaceDetectionResult,
  type FaceMatchResult,
} from '@/lib/face-recognition'
import { Loader2, Camera, KeyboardIcon, UserCheck, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface FaceCameraProps {
  onMatch: (match: FaceMatchResult, descriptor: Float32Array) => void
  onNoMatch: (descriptor: Float32Array) => void
  onManualEntry: () => void
  branchName?: string
  targetRole?: 'client' | 'staff'
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
const MATCH_HOLD_MS = 2000

export function FaceCamera({
  onMatch,
  onNoMatch,
  onManualEntry,
  branchName,
  targetRole = 'client',
}: FaceCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const [state, setState] = useState<CameraState>('loading_models')
  const [matchResult, setMatchResult] = useState<FaceMatchResult | null>(null)
  const [lastDescriptor, setLastDescriptor] = useState<Float32Array | null>(null)
  const [faceBox, setFaceBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

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
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } },
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
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas || !video) return

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (detection) {
        const { x, y, width, height } = detection.box
        ctx.strokeStyle = isValid ? '#22c55e' : '#f59e0b'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.roundRect(x, y, width, height, 12)
        ctx.stroke()

        setFaceBox({ x, y, w: width, h: height })
      } else {
        setFaceBox(null)
      }
    },
    []
  )

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

      // Check if face center falls roughly within central 40% width and 60% height
      isFaceValid = (
        faceCenterX > videoW * 0.30 &&
        faceCenterX < videoW * 0.70 &&
        faceCenterY > videoH * 0.20 &&
        faceCenterY < videoH * 0.80
      )
    }

    drawFaceOverlay(detection, isFaceValid)

    if (detection && isFaceValid && detection.score > 0.6) {
      setState('matching')
      setLastDescriptor(detection.descriptor)

      const match = await matchFaceInDB(detection.descriptor, targetRole)
      if (!mountedRef.current) return

      if (match) {
        setState('matched')
        setMatchResult(match)
        setTimeout(() => {
          if (mountedRef.current) onMatch(match, detection.descriptor)
        }, MATCH_HOLD_MS)
      } else {
        setState('no_match')
        setTimeout(() => {
          if (mountedRef.current) {
            setState('scanning')
          }
        }, 2000)
      }
    } else {
      scanTimerRef.current = setTimeout(runScanLoop, SCAN_INTERVAL_MS)
    }
  }, [state, drawFaceOverlay, onMatch, targetRole])

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
      onNoMatch(lastDescriptor)
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
    <div className="w-full max-w-sm md:max-w-lg flex flex-col items-center gap-4 md:gap-6">
      <div className="text-center">
        <h2 className="text-2xl md:text-3xl font-bold">Check-in</h2>
        {branchName && (
          <p className="text-muted-foreground mt-1 md:mt-2 text-base md:text-lg">{branchName}</p>
        )}
      </div>

      {/* Camera viewport */}
      <div className="relative w-full aspect-[3/4] max-h-[70vh] rounded-3xl overflow-hidden bg-black/50 border border-white/10">
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
              className={`w-56 h-72 md:w-64 md:h-80 rounded-full border-2 border-dashed transition-colors duration-300 ${faceBox ? 'border-emerald-400 shadow-[0_0_30px_rgba(34,197,94,0.3)]' : 'border-white/20'
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
            <p className="text-orange-400/80 mt-2">Reintentando...</p>
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
      <p className={`text-base md:text-lg font-medium text-center transition-colors ${statusColor()}`}>
        {statusLabel()}
      </p>

      {/* Manual entry button */}
      <Button
        onClick={state === 'no_match' ? handleManualNoMatch : onManualEntry}
        variant="outline"
        className="w-full h-14 md:h-16 text-base md:text-lg rounded-2xl gap-2 md:gap-3"
      >
        <KeyboardIcon className="size-5" />
        Ingresar manualmente
      </Button>
    </div>
  )
}
