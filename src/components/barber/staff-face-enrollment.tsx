'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
    initFaceModels,
    detectFace,
    enrollStaffFaceDescriptor,
    saveStaffFacePhoto,
    captureFrameAsBlob,
    areModelsLoaded,
    type FaceLandmarkPoint,
} from '@/lib/face-recognition'
import { drawFaceOverlayWithMesh } from '@/lib/face-mesh'
import { Loader2, Camera, CheckCircle2, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface StaffFaceEnrollmentProps {
    staffId: string
    staffName: string
    onComplete: () => void
    onSkip?: () => void
    source?: 'checkin' | 'barber'
}

type EnrollState = 'loading' | 'positioning' | 'capturing' | 'saving' | 'done' | 'error'

const CAPTURE_COUNT = 3
const CAPTURE_INTERVAL_MS = 800

export function StaffFaceEnrollment({
    staffId,
    staffName,
    onComplete,
    onSkip,
    source = 'barber',
}: StaffFaceEnrollmentProps) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const mountedRef = useRef(true)

    const [state, setState] = useState<EnrollState>('loading')
    const [capturedCount, setCapturedCount] = useState(0)
    const [faceDetected, setFaceDetected] = useState(false)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const landmarksRef = useRef<FaceLandmarkPoint[] | null>(null)
    const faceBoxRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
    const faceValidRef = useRef(false)
    const meshAnimRef = useRef<number | null>(null)

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

            if (detection && detection.score > 0.7) {
                faceBoxRef.current = detection.box
                landmarksRef.current = detection.landmarks
                faceValidRef.current = true
                setFaceDetected(true)
            } else {
                faceBoxRef.current = null
                landmarksRef.current = null
                faceValidRef.current = false
                setFaceDetected(false)
            }

            setTimeout(checkFace, 500)
        }

        checkFace()
        return () => { cancelled = true }
    }, [state])

    // Loop de animación — solo cuando la cara está validada
    useEffect(() => {
        const animate = () => {
            const canvas = canvasRef.current
            const video = videoRef.current
            if (canvas && video && video.videoWidth > 0) {
                canvas.width = video.videoWidth
                canvas.height = video.videoHeight
                const ctx = canvas.getContext('2d')!

                if (faceValidRef.current && landmarksRef.current) {
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
            enrollStaffFaceDescriptor(staffId, d, source, i === 0 ? bestScore : 0)
        )

        if (bestPhoto) {
            savePromises.push(
                saveStaffFacePhoto(staffId, bestPhoto).then(() => true)
            )
        }

        await Promise.all(savePromises)

        if (!mountedRef.current) return
        setState('done')
        stopCamera()

        setTimeout(() => {
            if (mountedRef.current) onComplete()
        }, 1500)
    }, [staffId, source, onComplete, stopCamera])

    return (
        <div className="w-full max-w-lg flex flex-col items-center gap-6">
            <div className="text-center">
                <h2 className="text-3xl font-bold">Registro Biométrico</h2>
                <p className="text-muted-foreground mt-2 text-lg">
                    {staffName}, enfocá tu cara para poder fichar tu asistencia con Face ID.
                </p>
            </div>

            <div className="relative w-full aspect-[4/3] rounded-3xl overflow-hidden bg-black/50 border border-white/10">
                <video
                    ref={videoRef}
                    className="absolute inset-0 w-full h-full object-cover"
                    playsInline
                    muted
                    style={{ transform: 'scaleX(-1)' }}
                />
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                    style={{ transform: 'scaleX(-1)' }}
                />

                {(state === 'positioning' || state === 'capturing') && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div
                            className={`w-48 h-64 rounded-full border-2 border-dashed transition-colors duration-300 ${faceDetected ? 'border-emerald-400/60' : 'border-white/20'
                                }`}
                        />
                    </div>
                )}

                {state === 'loading' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
                        <Loader2 className="size-12 animate-spin text-white/60 mb-4" />
                        <p className="text-white/70 text-lg">Preparando cámara...</p>
                    </div>
                )}

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

                {state === 'saving' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
                        <Loader2 className="size-12 animate-spin text-white/60 mb-4" />
                        <p className="text-white/70 text-lg">Guardando métricas faciales...</p>
                    </div>
                )}

                {state === 'done' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-500">
                        <div className="size-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mb-4">
                            <CheckCircle2 className="size-10 text-emerald-400" />
                        </div>
                        <p className="text-2xl font-bold text-white">¡Listo!</p>
                        <p className="text-emerald-400 mt-2">Face ID registrado correctamente</p>
                    </div>
                )}

                {state === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
                        <Camera className="size-12 text-white/40 mb-4" />
                        <p className="text-white/70 text-lg text-center px-6">
                            No se pudo acceder a la cámara
                        </p>
                    </div>
                )}
            </div>

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

            {state === 'positioning' && (
                <Button
                    onClick={handleCapture}
                    disabled={!faceDetected}
                    className="w-full h-16 text-xl rounded-2xl font-semibold"
                    size="lg"
                >
                    <Camera className="size-5 mr-2" />
                    Capturar rostro
                </Button>
            )}

            {(state === 'positioning' || state === 'error') && onSkip && (
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
