'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyRound, MapPin, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { matchFaceInDB, type FaceMatchResult } from '@/lib/face-recognition'
import { primerNombre } from '@/lib/escaneo-facial/textos'
import type { FaseEscaner, LecturaFacial, ResultadoEscaner, Veredicto } from '@/lib/escaneo-facial/tipos'
import { EscanerFacial } from '@/components/checkin/escaner-facial'

interface FaceCameraProps {
  onMatch: (match: FaceMatchResult, descriptor: Float32Array, photoBlob: Blob | null) => void
  /** No coincidió: viaja la lectura para guardarle la cara a quien entre por el teléfono. */
  onNoMatch: (descriptor: Float32Array, photoBlob: Blob | null) => void
  onManualEntry: () => void
  branchName?: string
  targetRole?: 'client' | 'staff'
  orgId?: string | null
  /** Fondo claro activo: adapta textos y bordes. */
  isLightBg?: boolean
  /** Título sobre la lente (default "Check-in"). */
  titulo?: string
}

/** Sin reconocer a nadie durante esto, el botón del ingreso manual se ofrece con más fuerza. */
const DESTACAR_MANUAL_MS = 12_000

/**
 * Identificación por la cara en el kiosko: clientes (check-in) y staff (fichaje).
 *
 * Cada intento junta dos muestras coherentes de la cara y compara su promedio
 * en UN viaje a la base. Si no coincide, prueba una vez más; si tampoco,
 * `onNoMatch` con la lectura, para que el flujo del teléfono le guarde esa cara
 * al cliente que se identifique (así la próxima lo reconoce).
 */
export function FaceCamera({
  onMatch,
  onNoMatch,
  onManualEntry,
  branchName,
  targetRole = 'client',
  orgId,
  isLightBg = false,
  titulo,
}: FaceCameraProps) {
  const esStaff = targetRole === 'staff'
  const coincidenciaRef = useRef<FaceMatchResult | null>(null)
  /** La última lectura que no coincidió (ver `ingresoManual`). */
  const sinCoincidenciaRef = useRef<LecturaFacial | null>(null)
  const salioRef = useRef(false)
  const [fase, setFase] = useState<FaseEscaner>('preparando')
  const [destacarManual, setDestacarManual] = useState(false)

  const alLeer = useCallback(
    async (lectura: LecturaFacial): Promise<Veredicto> => {
      const match = await matchFaceInDB(lectura.descriptor, targetRole, orgId)
      if (match) {
        coincidenciaRef.current = match
        // La foto se codifica mientras corre la animación: al terminar ya está.
        void lectura.foto()
        return { tipo: 'exito', nombre: primerNombre(match.clientName) }
      }
      sinCoincidenciaRef.current = lectura
      return { tipo: 'reintento' }
    },
    [targetRole, orgId],
  )

  // Si la pantalla se fue (Atrás, reinicio por inactividad) mientras se
  // codificaba la foto, no se navega desde una cámara que ya no está.
  const montadoRef = useRef(true)
  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
    }
  }, [])

  const alTerminar = useCallback(
    async ({ tipo, lectura }: ResultadoEscaner) => {
      if (salioRef.current) return
      salioRef.current = true
      const foto = lectura ? await lectura.foto() : null
      if (!montadoRef.current) return
      if (tipo === 'exito' && coincidenciaRef.current && lectura) {
        onMatch(coincidenciaRef.current, lectura.descriptor, foto)
      } else if (lectura) {
        onNoMatch(lectura.descriptor, foto)
      } else {
        onManualEntry()
      }
    },
    [onMatch, onNoMatch, onManualEntry],
  )

  // Si pasa un rato sin reconocer a nadie, el botón se ofrece con más fuerza:
  // el que no tiene la cara registrada no tiene por qué seguir esperando.
  const esperando = fase === 'buscando' || fase === 'ajustando'
  useEffect(() => {
    if (!esperando) return
    const id = setTimeout(() => setDestacarManual(true), DESTACAR_MANUAL_MS)
    return () => clearTimeout(id)
  }, [esperando])

  const terminando = fase === 'exito' || fase === 'fallo'
  const destacado = (destacarManual && esperando) || fase === 'error'

  const ingresoManual = () => {
    if (salioRef.current || terminando) return
    salioRef.current = true
    const lectura = sinCoincidenciaRef.current
    if (lectura) {
      void lectura.foto().then((foto) => {
        if (montadoRef.current) onNoMatch(lectura.descriptor, foto)
      })
    } else onManualEntry()
  }

  return (
    <div className="relative z-[1] flex w-full max-w-2xl flex-col items-center gap-2 md:gap-3">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
        <h2
          className={cn(
            'text-2xl font-bold tracking-tight md:text-3xl',
            isLightBg
              ? 'text-zinc-900'
              : 'bg-gradient-to-r from-cyan-200 via-white to-violet-200 bg-clip-text text-transparent',
          )}
        >
          {titulo ?? 'Check-in'}
        </h2>
        {branchName && (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tracking-wide backdrop-blur-sm md:text-sm',
              isLightBg ? 'border border-zinc-300 bg-white/70 text-zinc-700' : 'border border-white/10 bg-zinc-950/50 text-white/70',
            )}
          >
            <MapPin className={cn('size-3 md:size-3.5', isLightBg ? 'text-cyan-700' : 'text-cyan-300/70')} />
            {branchName}
          </span>
        )}
      </div>

      <EscanerFacial
        modo="identificar"
        quien={esStaff ? 'staff' : 'cliente'}
        esClaro={isLightBg}
        alLeer={alLeer}
        alTerminar={alTerminar}
        alCambiar={(e) => setFase(e.fase)}
      >
        <Button
          onClick={ingresoManual}
          variant="outline"
          disabled={terminando}
          className={cn(
            'mt-1 h-12 w-full max-w-sm gap-2.5 rounded-2xl text-base font-semibold transition-all duration-500 md:h-14 md:text-lg',
            isLightBg
              ? 'border-zinc-300 bg-white text-zinc-800 shadow-sm hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900'
              : 'checkin-glass-surface border-white/15 text-white hover:border-white/30 hover:bg-white/10 hover:text-white',
            destacado &&
              (isLightBg
                ? 'border-cyan-600/50 ring-4 ring-cyan-600/15'
                : 'border-cyan-300/50 ring-4 ring-cyan-300/15 shadow-[0_0_32px_rgba(34,211,238,0.25)]'),
          )}
        >
          {esStaff ? <KeyRound className="size-5" /> : <Smartphone className="size-5" />}
          {esStaff ? 'Ingresar con mi PIN' : 'Ingresar con mi teléfono'}
        </Button>
      </EscanerFacial>
    </div>
  )
}
