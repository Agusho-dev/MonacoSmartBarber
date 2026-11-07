'use client'

import Image from 'next/image'
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  MessageSquareWarning,
  NotebookPen,
  RotateCw,
  ScanFace,
  ShieldAlert,
  Sparkles,
  SprayCan,
  Sprout,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { haceCuanto, primerNombre } from '@/lib/fotos-corte/textos'
import {
  fichaVacia,
  progresoFicha,
  renglonesDeFicha,
  titularDeFicha,
  type DatosFicha,
  type FotoDeFicha,
  type TipoRenglonFicha,
} from '@/lib/asesoria/ficha'
import { useFichaAsesoria } from '@/hooks/use-ficha-asesoria'
import type { QueueEntry } from '@/lib/types/database'

const ICONO: Record<TipoRenglonFicha, typeof ScanFace> = {
  cabeza: ScanFace,
  molesta: MessageSquareWarning,
  cuidados: ShieldAlert,
  frecuencia: CalendarClock,
  crecer: Sprout,
  productos: SprayCan,
}

/** Lo que conviene tener a la vista con el cliente sentado (la charla queda para la hoja). */
const RENGLONES_EN_LA_SILLA: readonly TipoRenglonFicha[] = ['cabeza', 'molesta', 'cuidados', 'productos']

/**
 * «La receta»: la ficha de asesoría leída de un vistazo. El corte y el fade en
 * grande y, debajo, lo que hay que cuidar. Es una cartulina blanca con el canto
 * fucsia (fucsia = asesoría) que se lee igual sobre cualquier color del
 * semáforo. Toda la tarjeta abre la ficha.
 */
export function RecetaFicha({
  datos,
  fotos,
  actualizadaEn,
  barbero,
  variante,
  enCurso = false,
  onAbrir,
}: {
  datos: DatosFicha
  fotos: readonly FotoDeFicha[]
  actualizadaEn: string | null
  barbero: string | null
  /** `silla`: la tarjeta del corte (lo justo). `completa`: la ficha del cliente (todo). */
  variante: 'silla' | 'completa'
  /** La ficha se está completando en esta visita y todavía le falta algo. */
  enCurso?: boolean
  onAbrir?: () => void
}) {
  const titular = titularDeFicha(datos)
  const todos = renglonesDeFicha(datos)
  const renglones = variante === 'silla' ? todos.filter((r) => RENGLONES_EN_LA_SILLA.includes(r.tipo)) : todos
  const progreso = progresoFicha(datos)
  const foto = fotos[0] ?? null
  const quien = primerNombre(barbero)
  const cuando = actualizadaEn ? haceCuanto(actualizadaEn) : null

  const contenido = (
    <>
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-fuchsia-500" />
      <div className="flex gap-4 py-4 pl-5 pr-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.07em] text-fuchsia-700">
            <span className="inline-flex items-center gap-1">
              <NotebookPen className="size-3.5" aria-hidden />
              Ficha de asesoría
            </span>
            {enCurso ? (
              <span className="font-semibold normal-case tracking-normal text-muted-foreground">
                · {progreso.hechas} de {progreso.total}
              </span>
            ) : (
              cuando && (
                <span className="font-medium normal-case tracking-normal text-muted-foreground">
                  · {cuando}
                  {quien ? ` con ${quien}` : ''}
                </span>
              )
            )}
          </p>
          <p
            className={cn(
              'mt-1.5 font-bold leading-[1.15] tracking-[-0.015em] [overflow-wrap:anywhere]',
              variante === 'silla' ? 'text-[1.375rem] max-sm:text-xl' : 'text-[1.25rem]',
              !titular && 'text-muted-foreground',
            )}
          >
            {titular ?? 'Todavía sin el corte'}
          </p>
          {renglones.length > 0 && (
            <ul className="mt-2.5 space-y-1.5">
              {renglones.map((r) => {
                const Icono = ICONO[r.tipo]
                return (
                  <li
                    key={r.tipo}
                    className={cn(
                      'flex items-start gap-2 text-[0.9375rem] leading-snug',
                      r.atencion ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <Icono
                      className={cn('mt-[0.15em] size-4 shrink-0', r.atencion ? 'text-fuchsia-700' : 'text-muted-foreground/80')}
                      aria-hidden
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{r.texto}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {foto && (
          <div className="relative size-[5.5rem] shrink-0 overflow-hidden rounded-xl border bg-muted max-sm:size-16">
            <Image src={foto.url} alt="Foto del corte de la ficha" fill sizes="88px" className="object-cover" draggable={false} />
          </div>
        )}
      </div>
      {onAbrir && (
        <span className="flex items-center justify-between gap-2 border-t border-dashed border-border px-5 py-2.5 text-[0.9375rem] font-semibold">
          <span className={cn(enCurso && 'text-fuchsia-700')}>{enCurso ? 'Seguir con la ficha' : 'Ver y editar la ficha'}</span>
          <ChevronRight className="size-4 text-muted-foreground motion-safe:transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      )}
    </>
  )

  const clase =
    'group relative block w-full overflow-hidden rounded-2xl border border-border bg-card text-left text-card-foreground shadow-[0_8px_22px_-16px_oklch(0.2_0.012_260/0.6)]'
  if (!onAbrir) return <div className={clase}>{contenido}</div>
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={cn(
        clase,
        'touch-manipulation outline-none motion-safe:transition-transform motion-safe:active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-fuchsia-500/60',
      )}
    >
      {contenido}
    </button>
  )
}

/**
 * La ficha de asesoría en la tarjeta del corte. Decide qué mostrar:
 * - tiene ficha → la receta (o «Seguir con la ficha» si se está completando);
 * - pidió asesoría y no hay ficha → la invitación fucsia a completarla;
 * - nada de eso → un botón discreto para armarla igual (el barbero decide).
 * Un error de lectura se dice, con Reintentar (Known Risk #13).
 */
export function FichaEnLaSilla({ entrada, onAbrir }: { entrada: QueueEntry; onAbrir: () => void }) {
  const clienteId = entrada.client?.id ?? null
  const { ficha, reintentar } = useFichaAsesoria(clienteId, entrada.id, !!clienteId)
  if (!clienteId) return null

  const pidio = entrada.pidio_asesoria === true
  const datos = ficha?.datos
  const tiene = !!datos && !fichaVacia(datos)

  if (tiene && datos) {
    const progreso = progresoFicha(datos)
    const enCurso = !progreso.completa && (pidio || (ficha?.entradasTocadas.includes(entrada.id) ?? false))
    return (
      <RecetaFicha
        datos={datos}
        fotos={ficha?.fotos ?? []}
        actualizadaEn={ficha?.servidor?.actualizadaEn ?? null}
        barbero={ficha?.servidor?.actualizadaPor?.nombre ?? null}
        variante="silla"
        enCurso={enCurso}
        onAbrir={onAbrir}
      />
    )
  }

  if (ficha?.carga.tipo === 'error') {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-2xl bg-black/10 py-2 pl-3.5 pr-1.5 text-[0.9375rem] font-semibold">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 leading-snug">No pudimos ver si tiene ficha de asesoría</span>
        <button
          type="button"
          onClick={reintentar}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 font-semibold underline-offset-4 hover:underline"
        >
          <RotateCw className="size-4" aria-hidden />
          Reintentar
        </button>
      </div>
    )
  }

  if (pidio) {
    return (
      <button
        type="button"
        onClick={onAbrir}
        className="ficha-invita group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border-2 border-dashed border-fuchsia-500/70 bg-card px-4 py-4 text-left text-card-foreground outline-none touch-manipulation motion-safe:active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-fuchsia-500/60"
      >
        <span className="asesoria-respira-suave flex size-12 shrink-0 items-center justify-center rounded-2xl bg-fuchsia-600 text-white shadow-md shadow-fuchsia-600/30">
          <NotebookPen className="size-6" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-bold leading-tight">Completá su ficha de asesoría</span>
          <span className="mt-0.5 block text-[0.9375rem] leading-snug text-muted-foreground">
            Mientras charlan: un toque por respuesta, se guarda sola.
          </span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-fuchsia-700" aria-hidden />
      </button>
    )
  }

  // Sin ficha y sin pedido: discreto, sobre el color del semáforo (hereda la tinta).
  if (ficha?.carga.tipo !== 'lista') return null
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex min-h-11 items-center gap-2 rounded-xl px-1 text-[0.9375rem] font-semibold underline-offset-4 outline-none touch-manipulation hover:underline focus-visible:ring-2 focus-visible:ring-current/40"
    >
      <Sparkles className="size-4" aria-hidden />
      Armar su ficha de asesoría
    </button>
  )
}
