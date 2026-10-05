'use client'

import { MessageCircleQuestionMark, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { AvisoAsesoria } from '@/lib/barber-utils'

/**
 * Aviso de llegada de un pedido de asesoría (mig 217) en el panel del barbero.
 *
 * Es una tarjeta emergente de sonner (`toast.custom`): arriba al centro, 8 s y
 * no bloqueante — el barbero puede estar cortando y no tiene que soltar nada
 * para que se vaya. Con el panel girado 180° sale igual de derecha: el Toaster
 * del panel vive adentro de la caja girada (GiroPanelRaiz). Ahí el deslizar
 * para descartar está apagado, por eso la tarjeta trae su propia X.
 *
 * Lo que dispara el aviso (qué entrada, por qué y con qué alcance) lo deriva
 * `asesoriasNuevas` en barber-utils; acá sólo se arma el texto y se muestra.
 */

/** Cuánto dura el aviso en pantalla. */
const DURACION_AVISO_MS = 8_000

/**
 * Más avisos que éstos a la vez (volver a la fila después de un rato fuera, ver
 * `leerVistaAsesoria`) y sale UNO solo con el total: una pila de tarjetas tapa
 * la fila justo cuando el barbero la quiere mirar.
 */
const MAX_AVISOS_SUELTOS = 3

interface AsesoriaAvisoProps {
  titulo: string
  bajada: string
  /** Aviso liviano (Menor espera en la fila de otro): mismo idioma, menos peso. */
  liviana?: boolean
  onCerrar: () => void
}

export function AsesoriaAviso({ titulo, bajada, liviana = false, onCerrar }: AsesoriaAvisoProps) {
  return (
    // `w-(--width)`: sonner no le da ancho a un toast custom fuera del celular
    // (el <li> se achica al contenido y quedaría corrido del centro). En el
    // celular el <li> sí tiene ancho propio y `max-w-full` lo respeta.
    <div
      className={cn(
        'relative flex w-(--width) max-w-full items-start gap-3 overflow-hidden rounded-2xl border bg-card py-3 pl-4 pr-1.5 text-card-foreground',
        'shadow-[0_14px_32px_-14px_oklch(0.45_0.24_322/0.5)]',
        liviana ? 'border-fuchsia-500/25' : 'border-fuchsia-500/45',
      )}
    >
      {/* Acento fucsia: el mismo de la tarjeta de la fila. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-fuchsia-500" />
      <span
        aria-hidden
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-xl',
          liviana ? 'bg-fuchsia-500/12 text-fuchsia-700' : 'bg-fuchsia-600 text-white shadow-sm shadow-fuchsia-600/30',
        )}
      >
        <MessageCircleQuestionMark className="size-5" />
      </span>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-[15px] font-bold leading-snug">{titulo}</p>
        <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{bajada}</p>
      </div>
      <button
        type="button"
        onClick={onCerrar}
        aria-label="Cerrar aviso"
        className="-my-1 flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-fuchsia-500/50"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}

/** Nombre para el aviso: completo (en la fila puede haber dos Juan) y sin espacios de más. */
function nombreDelAviso(aviso: AvisoAsesoria): string | null {
  const limpio = (aviso.entrada.client?.name ?? '').trim().replace(/\s+/g, ' ')
  return limpio || null
}

/**
 * Título y bajada del aviso. `ocupado` = el barbero está cortando o en descanso:
 * la bajada le dice cuándo le toca en vez de pedirle que lo asesore ya.
 */
export function textosDelAvisoAsesoria(
  aviso: AvisoAsesoria,
  ocupado: boolean,
): { titulo: string; bajada: string } {
  const nombre = nombreDelAviso(aviso)

  if (aviso.alcance === 'menor_espera') {
    return {
      titulo: `${nombre ?? 'Un cliente'} pidió asesoría · Menor espera`,
      bajada: 'Lo atiende el primero que se libere.',
    }
  }

  const titulo =
    aviso.motivo === 'sumada'
      ? `${nombre ?? 'Un cliente'} ahora pide asesoría`
      : aviso.motivo === 'reasignada'
        ? nombre
          ? `Te pasaron a ${nombre}: pidió asesoría`
          : 'Te pasaron un cliente: pidió asesoría'
        : `${nombre ?? 'Un cliente'} pidió asesoría`

  const n = aviso.posicion ?? 1
  const bajada = ocupado
    ? `Cuando termines: está ${n}.º en tu fila.`
    : n === 1
      ? 'Es el próximo de tu fila. No sabe qué hacerse: asesoralo antes de empezar.'
      : `Está ${n}.º en tu fila. No sabe qué hacerse: asesoralo antes de empezar.`

  return { titulo, bajada }
}

/**
 * Muestra el aviso. El id por entrada hace que un segundo aviso del mismo
 * cliente (lo pasaron a tu fila después de llegar) reemplace al primero en vez
 * de apilarse.
 */
export function mostrarAvisoAsesoria(aviso: AvisoAsesoria, ocupado: boolean): void {
  const { titulo, bajada } = textosDelAvisoAsesoria(aviso, ocupado)
  const liviana = aviso.alcance === 'menor_espera'
  toast.custom(
    (id) => (
      <AsesoriaAviso titulo={titulo} bajada={bajada} liviana={liviana} onCerrar={() => toast.dismiss(id)} />
    ),
    { id: `asesoria-${aviso.entrada.id}`, position: 'top-center', duration: DURACION_AVISO_MS },
  )
}

/** Título y bajada del aviso que resume varios pedidos juntos. */
export function textosDelResumenAsesoria(avisos: AvisoAsesoria[]): { titulo: string; bajada: string } {
  const total = avisos.length
  const deMiFila = avisos.filter((a) => a.alcance === 'mi_fila').length
  const bajada =
    deMiFila === total
      ? 'Están en tu fila: buscalos por el sello «Asesoría».'
      : deMiFila > 0
        ? `${deMiFila} en tu fila; a los demás los atiende el primero que se libere. Buscalos por el sello «Asesoría».`
        : 'Los atiende el primero que se libere. Buscalos por el sello «Asesoría».'
  return { titulo: `${total} clientes piden asesoría`, bajada }
}

/**
 * Muestra los avisos de una lectura de la fila: uno por pedido o, si son más
 * de `MAX_AVISOS_SUELTOS`, uno solo con el total (liviano si ninguno es de
 * «Mi fila»).
 */
export function mostrarAvisosAsesoria(avisos: AvisoAsesoria[], ocupado: boolean): void {
  if (avisos.length <= MAX_AVISOS_SUELTOS) {
    for (const aviso of avisos) mostrarAvisoAsesoria(aviso, ocupado)
    return
  }
  const { titulo, bajada } = textosDelResumenAsesoria(avisos)
  const liviana = avisos.every((a) => a.alcance === 'menor_espera')
  toast.custom(
    (id) => (
      <AsesoriaAviso titulo={titulo} bajada={bajada} liviana={liviana} onCerrar={() => toast.dismiss(id)} />
    ),
    { id: 'asesoria-resumen', position: 'top-center', duration: DURACION_AVISO_MS },
  )
}
