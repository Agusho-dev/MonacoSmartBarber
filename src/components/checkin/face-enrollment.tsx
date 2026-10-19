'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { enrollFaceDescriptor, saveFacePhoto } from '@/lib/face-recognition'
import { primerNombre } from '@/lib/escaneo-facial/textos'
import type { FaseEscaner, LecturaFacial, ResultadoEscaner, Veredicto } from '@/lib/escaneo-facial/tipos'
import { EscanerFacial } from '@/components/checkin/escaner-facial'

interface FaceEnrollmentProps {
  clientId?: string
  clientName: string
  onComplete: () => void
  onSkip: () => void
  source?: 'checkin' | 'barber'
  /** Sólo leer: devuelve las capturas por `onCapture` sin guardarlas (las guarda quien llama). */
  captureOnly?: boolean
  onCapture?: (descriptors: Float32Array[], photo: Blob | null) => void
  /** Sucursal seleccionada en el kiosk — usada para autorizar el enrolment en flujos públicos. */
  branchId?: string | null
  /** Fondo claro activo: adapta textos y bordes. */
  isLightBg?: boolean
  /** Lo que gana la persona al registrarse (default: el del cliente). */
  subtitulo?: string
}

/**
 * Registro de la cara: tres capturas de la misma persona, de frente y quieta
 * (con límites más exigentes que al identificar: esta cara es la referencia de
 * todas las visitas que vienen).
 */
export function FaceEnrollment({
  clientId,
  clientName,
  onComplete,
  onSkip,
  source = 'checkin',
  captureOnly = false,
  onCapture,
  branchId = null,
  isLightBg = false,
  subtitulo,
}: FaceEnrollmentProps) {
  const nombre = primerNombre(clientName)
  const [fase, setFase] = useState<FaseEscaner>('preparando')
  const [reinicio, setReinicio] = useState(0)
  const salioRef = useRef(false)
  // Si la pantalla se fue mientras se codificaba la foto, no se avisa a nadie.
  const montadoRef = useRef(true)
  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
    }
  }, [])

  const alLeer = useCallback(
    async (lectura: LecturaFacial): Promise<Veredicto> => {
      if (captureOnly && onCapture) return { tipo: 'exito', nombre }
      if (!clientId) return { tipo: 'fallo', mensaje: 'No pudimos guardar tu cara' }

      const foto = await lectura.foto()
      const guardados: Promise<boolean>[] = lectura.muestras.map((d, i) =>
        enrollFaceDescriptor(clientId, d, source, i === 0 ? lectura.calidad : 0, branchId).catch(() => false),
      )
      if (foto) guardados.push(saveFacePhoto(clientId, foto, branchId).then((url) => url !== null).catch(() => false))
      const resultados = await Promise.all(guardados)
      // Con que se guarde algo alcanza; si no se guardó nada, se dice en vez de mostrar un "listo" falso.
      if (resultados.every((ok) => !ok)) return { tipo: 'fallo', mensaje: 'No pudimos guardar tu cara' }
      return { tipo: 'exito', nombre }
    },
    [captureOnly, onCapture, clientId, source, branchId, nombre],
  )

  const alTerminar = useCallback(
    async ({ tipo, lectura }: ResultadoEscaner) => {
      // Un registro fallido se queda en pantalla con "Probar de nuevo" y "Omitir".
      if (tipo !== 'exito' || salioRef.current) return
      salioRef.current = true
      if (captureOnly && onCapture && lectura) {
        const foto = await lectura.foto()
        if (montadoRef.current) onCapture(lectura.muestras, foto)
        return
      }
      onComplete()
    },
    [captureOnly, onCapture, onComplete],
  )

  const omitir = () => {
    if (salioRef.current) return
    salioRef.current = true
    onSkip()
  }

  const ocupado = fase === 'consultando' || fase === 'exito'

  return (
    <div className="relative z-[1] flex w-full max-w-2xl flex-col items-center gap-2 md:gap-3">
      <div className="text-center">
        <h2
          className={cn(
            'text-2xl font-bold tracking-tight md:text-3xl',
            isLightBg
              ? 'text-zinc-900'
              : 'bg-gradient-to-r from-cyan-200 via-white to-violet-200 bg-clip-text text-transparent',
          )}
        >
          Registrar tu cara
        </h2>
        <p className={cn('mt-1 text-sm md:text-base', isLightBg ? 'text-zinc-600' : 'text-cyan-100/60')}>
          {nombre ? `${nombre}, ` : ''}
          {subtitulo ?? 'la próxima vez entrás con sólo mirar la cámara'}
        </p>
      </div>

      <EscanerFacial
        modo="registrar"
        quien="registro"
        esClaro={isLightBg}
        reinicio={reinicio}
        alLeer={alLeer}
        alTerminar={alTerminar}
        alCambiar={(e) => setFase(e.fase)}
      >
        <div className="mt-1 flex w-full max-w-sm flex-col items-center gap-2">
          {fase === 'fallo' && (
            <Button
              onClick={() => setReinicio((n) => n + 1)}
              className={cn(
                'h-12 w-full gap-2.5 rounded-2xl text-base font-semibold md:h-14 md:text-lg',
                isLightBg ? 'bg-zinc-900 text-white hover:bg-zinc-800' : 'bg-white text-zinc-900 hover:bg-white/90',
              )}
            >
              <RotateCcw className="size-5" />
              Probar de nuevo
            </Button>
          )}
          <Button
            onClick={omitir}
            variant="ghost"
            disabled={ocupado}
            className={cn(
              'h-11 gap-2 rounded-xl px-5 text-base md:h-12 md:text-lg',
              isLightBg ? 'text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900' : 'text-white/60 hover:bg-white/10 hover:text-white',
              fase === 'error' && (isLightBg ? 'text-zinc-900' : 'text-white'),
            )}
          >
            <SkipForward className="size-4 md:size-5" />
            Omitir por ahora
          </Button>
        </div>
      </EscanerFacial>
    </div>
  )
}
