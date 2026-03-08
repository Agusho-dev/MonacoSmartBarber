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
  clientId: string
  clientName: string
  onComplete: () => void
  onSkip: () => void
  source?: 'checkin' | 'barber'
}

type EnrollState = 'loading' | 'positioning' | 'capturing' | 'saving' | 'done' | 'error'

const CAPTURE_COUNT = 3
const CAPTURE_INTERVAL_MS = 800

export function FaceEnrollment({
  clientId,
  clientName,
  onComplete,
  onSkip,
  source = 'checkin',
}: FaceEnrollmentProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mountedRef = useRef(true)

  const [state, setState] = useState<EnrollState>('loading')
  const [capturedCount, setCapturedCount] = useState(0)
  const [faceDetected, setFaceDetected] = useState(false)

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
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
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
      setFaceDetected(!!detection && detection.score > 0.7)
      setTimeout(checkFace, 500)
    }

    checkFace()
    return () => { cancelled = true }
  }, [state])

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
        descriptors.push(detection.descriptor)

        if (detection.score > bestScore) {
          bestScore = detection.score
          bestPhoto = await captureFrameAsBlob(videoRef.current)
        }

        setCapturedCount(i + 1)
      }

      if (i < CAPTURE_COUNT - 1) {
        await new Promise((r) => setTimeout(r, CAPTURE_INTERVAL_MS))
      }
    }

    if (descriptors.length === 0) {
      setState('positioning')
      return
    }

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
  }, [clientId, source, onComplete, stopCamera])

  return (
    <div className="w-full max-w-lg flex flex-col items-center gap-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold">Registrar tu cara</h2>
        <p className="text-muted-foreground mt-2 text-lg">
          {clientName}, mirá a la cámara para futuras visitas
        </p>
      </div>

      {/* Camera viewport */}
      <div className="relative w-full aspect-[4/3] rounded-3xl overflow-hidden bg-black/50 border border-white/10">
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
              className={`w-48 h-64 rounded-full border-2 border-dashed transition-colors duration-300 ${
                faceDetected ? 'border-emerald-400/60' : 'border-white/20'
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
          <p className={`text-lg font-medium ${faceDetected ? 'text-emerald-400' : 'text-muted-foreground'}`}>
            {faceDetected ? '¡Perfecto! Tu cara está bien posicionada' : 'Posicioná tu cara dentro del óvalo'}
          </p>
          {faceDetected && (
            <p className="text-sm text-muted-foreground">
              Quedate quieto un momento
            </p>
          )}
        </div>
      )}

      {/* Capture button */}
      {state === 'positioning' && (
        <Button
          onClick={handleCapture}
          disabled={!faceDetected}
          className="w-full h-16 text-xl rounded-2xl font-semibold"
          size="lg"
        >
          <Camera className="size-5 mr-2" />
          Capturar
        </Button>
      )}

      {/* Skip button */}
      {(state === 'positioning' || state === 'error') && (
        <button
          onClick={() => {
            stopCamera()
            onSkip()
          }}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors py-2"
        >
          <SkipForward className="size-4" />
          <span className="text-lg">Omitir por ahora</span>
        </button>
      )}
    </div>
  )
}
