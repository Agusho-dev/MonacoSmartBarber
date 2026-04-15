'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  initFaceModels,
  detectFace,
  enrollFaceDescriptor,
  saveFacePhoto,
  captureFrameAsBlob,
  areModelsLoaded,
} from '@/lib/face-recognition'
import { Loader2, Camera, CheckCircle2, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface FaceEnrollmentProps {
  clientId?: string
  clientName: string
  onComplete: () => void
  onSkip: () => void
  source?: 'checkin' | 'barber'
  captureOnly?: boolean
  onCapture?: (descriptors: Float32Array[], photo: Blob | null) => void
}

type EnrollState = 'loading' | 'positioning' | 'capturing' | 'saving' | 'done' | 'error'
const CAPTURE_COUNT = 3
const CAPTURE_INTERVAL_MS = 600

export function FaceEnrollment({
  clientId,
  clientName,
  onComplete,
  onSkip,
  source = 'checkin',
  captureOnly = false,
  onCapture,
}: FaceEnrollmentProps) {
  const isTerminal = source === 'checkin'
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mountedRef = useRef(true)

  const [state, setState] = useState<EnrollState>('loading')
  const [capturedCount, setCapturedCount] = useState(0)
  const [faceDetected, setFaceDetected] = useState(false)
  const autoCaptureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleCaptureRef = useRef<(() => void) | null>(null)

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false

    const boot = async () => {
      await initFaceModels()
      if (cancelled) return

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setState('positioning')
        }
      } catch {
        setState('error')
      }
    }

    boot()

    return () => {
      cancelled = true
      mountedRef.current = false
      stopCamera()
    }
  }, [stopCamera])

  useEffect(() => {
    if (state !== 'positioning') return
    let cancelled = false

    const checkFace = async () => {
      if (cancelled || !videoRef.current || !areModelsLoaded()) return
      const detection = await detectFace(videoRef.current)
      if (cancelled) return

      let isFaceValid = false
      if (detection) {
        const videoW = videoRef.current.videoWidth
        const videoH = videoRef.current.videoHeight
        const faceCenterX = detection.box.x + detection.box.width / 2
        const faceCenterY = detection.box.y + detection.box.height / 2

        isFaceValid = (
          faceCenterX > videoW * 0.30 &&
          faceCenterX < videoW * 0.70 &&
          faceCenterY > videoH * 0.20 &&
          faceCenterY < videoH * 0.80
        )
      }

      setFaceDetected(!!detection && isFaceValid && detection.score > 0.6)

      if (!cancelled) setTimeout(checkFace, 300)
    }

    checkFace()
    return () => { cancelled = true }
  }, [state])

  // Auto-capture: when face is detected for 1.5s, trigger capture automatically
  useEffect(() => {
    handleCaptureRef.current = handleCapture
  })

  useEffect(() => {
    if (state === 'positioning' && faceDetected) {
      autoCaptureTimerRef.current = setTimeout(() => {
        handleCaptureRef.current?.()
      }, 1500)
    } else {
      if (autoCaptureTimerRef.current) {
        clearTimeout(autoCaptureTimerRef.current)
        autoCaptureTimerRef.current = null
      }
    }
    return () => {
      if (autoCaptureTimerRef.current) {
        clearTimeout(autoCaptureTimerRef.current)
        autoCaptureTimerRef.current = null
      }
    }
  }, [state, faceDetected])

  const handleCapture = useCallback(async () => {
    if (!videoRef.current || !areModelsLoaded()) return
    setState('capturing')
    setCapturedCount(0)

    const descriptors: Float32Array[] = []
    let bestPhoto: Blob | null = null
    let bestScore = 0

    for (let i = 0; i < CAPTURE_COUNT; i++) {
      if (!mountedRef.current) return

      const detection = await detectFace(videoRef.current)
      if (detection && detection.score > 0.6) {
        const videoW = videoRef.current.videoWidth
        const videoH = videoRef.current.videoHeight
        const faceCenterX = detection.box.x + detection.box.width / 2
        const faceCenterY = detection.box.y + detection.box.height / 2

        const isFaceValid = (
          faceCenterX > videoW * 0.30 &&
          faceCenterX < videoW * 0.70 &&
          faceCenterY > videoH * 0.20 &&
          faceCenterY < videoH * 0.80
        )

        if (isFaceValid) {
          descriptors.push(detection.descriptor)

          if (detection.score > bestScore) {
            bestScore = detection.score
            bestPhoto = await captureFrameAsBlob(videoRef.current)
          }

          setCapturedCount(i + 1)
        } else {
          // Retry this capture index if face is outside bounding box
          i--
        }
      } else {
        // Retry this capture index if no face detected
        i--
      }

      if (i < CAPTURE_COUNT - 1) {
        await new Promise((r) => setTimeout(r, CAPTURE_INTERVAL_MS))
      }
    }

    if (descriptors.length === 0) {
      setState('positioning')
      return
    }

    // Capture-only mode: return data without saving
    if (captureOnly && onCapture) {
      stopCamera()
      onCapture(descriptors, bestPhoto)
      return
    }

    if (!clientId) return

    setState('saving')

    const savePromises = descriptors.map((d, i) =>
      enrollFaceDescriptor(clientId, d, source, i === 0 ? bestScore : 0)
    )

    if (bestPhoto) {
      savePromises.push(
        saveFacePhoto(clientId, bestPhoto).then(() => true)
      )
    }

    await Promise.all(savePromises)

    if (!mountedRef.current) return
    setState('done')
    stopCamera()

    setTimeout(() => {
      if (mountedRef.current) onComplete()
    }, 1500)
  }, [clientId, source, onComplete, stopCamera, captureOnly, onCapture])

  return (
    <div className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-4 md:gap-6">
      <div className="text-center">
        <h2
          className={
            isTerminal
              ? 'text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-cyan-200 via-white to-violet-200 bg-clip-text text-transparent'
              : 'text-2xl md:text-3xl font-bold'
          }
        >
          Registrar tu cara
        </h2>
        <p
          className={
            isTerminal
              ? 'mt-1 md:mt-2 text-base md:text-lg text-cyan-100/55'
              : 'text-muted-foreground mt-1 md:mt-2 text-base md:text-lg'
          }
        >
          {clientName}, mirá a la cámara para futuras visitas
        </p>
      </div>

      {/* Camera viewport */}
      <div
        className={
          isTerminal
            ? 'relative w-full aspect-[3/4] max-h-[70vh] rounded-3xl overflow-hidden bg-zinc-950/80 border border-cyan-400/25 shadow-[0_0_40px_rgba(34,211,238,0.12)]'
            : 'relative w-full aspect-[3/4] max-h-[70vh] rounded-3xl overflow-hidden bg-black/50 border border-white/10'
        }
      >
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
          style={{ transform: 'scaleX(-1)' }}
        />

        {/* Guide oval */}
        {(state === 'positioning' || state === 'capturing') && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className={`w-56 h-72 md:w-64 md:h-80 rounded-full border-2 border-dashed transition-colors duration-300 ${
                faceDetected
                  ? 'border-emerald-400 shadow-[0_0_30px_rgba(34,197,94,0.3)]'
                  : isTerminal
                    ? 'border-cyan-400/40 shadow-[0_0_24px_rgba(34,211,238,0.2)]'
                    : 'border-white/20'
              }`}
            />
          </div>
        )}

        {/* Loading overlay */}
        {state === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
            <Loader2 className="size-12 animate-spin text-white/60 mb-4" />
            <p className="text-white/70 text-lg">Preparando cámara...</p>
          </div>
        )}

        {/* Capturing overlay */}
        {state === 'capturing' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-4 py-2">
              <Camera className="size-4 text-emerald-400" />
              <span className="text-sm text-white/70">
                Captura {capturedCount}/{CAPTURE_COUNT}
              </span>
            </div>
          </div>
        )}

        {/* Saving overlay */}
        {state === 'saving' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
            <Loader2 className="size-12 animate-spin text-white/60 mb-4" />
            <p className="text-white/70 text-lg">Guardando...</p>
          </div>
        )}

        {/* Done overlay */}
        {state === 'done' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-500">
            <div className="size-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mb-4">
              <CheckCircle2 className="size-10 text-emerald-400" />
            </div>
            <p className="text-2xl font-bold text-white">¡Listo!</p>
            <p className="text-emerald-400 mt-2">Cara registrada correctamente</p>
          </div>
        )}

        {/* Error overlay */}
        {state === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
            <Camera className="size-12 text-white/40 mb-4" />
            <p className="text-white/70 text-lg text-center px-6">
              No se pudo acceder a la cámara
            </p>
          </div>
        )}
      </div>

      {/* Status & instructions */}
      {state === 'positioning' && (
        <div className="text-center space-y-2">
          <p className={`text-base md:text-lg font-medium ${faceDetected ? 'text-emerald-400' : 'text-muted-foreground'}`}>
            {faceDetected ? '¡Perfecto! Capturando automáticamente...' : 'Posicioná tu cara dentro del óvalo'}
          </p>
          {faceDetected && (
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin text-emerald-400" />
              <p className="text-xs md:text-sm text-emerald-400/80">
                Quedate quieto un momento
              </p>
            </div>
          )}
        </div>
      )}

      {/* Skip button */}
      {(state === 'positioning' || state === 'error') && (
        <button
          onClick={() => {
            stopCamera()
            onSkip()
          }}
          className={
            isTerminal
              ? 'flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-950/40 px-4 py-2 text-cyan-100/70 hover:border-cyan-500/25 hover:bg-cyan-950/30 hover:text-cyan-50 transition-colors'
              : 'flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors py-2'
          }
        >
          <SkipForward className="size-4" />
          <span className="text-lg">Omitir por ahora</span>
        </button>
      )}
    </div>
  )
}
