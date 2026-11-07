'use client'

import { Check, CloudOff, Loader2, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EstadoGuardado } from '@/stores/ficha-asesoria-store'

/*
 * Piezas de la ficha de asesoría. Todo se contesta con UN toque, con botones de
 * 56 px o más (el barbero tiene la máquina en la otra mano) y lo elegido queda
 * en grafito lleno, igual que en el cobro: el panel tiene un solo idioma para
 * «esto está elegido».
 */

const BASE_OPCION =
  'relative flex min-h-14 min-w-0 items-center gap-2.5 rounded-2xl border-2 px-4 py-3 text-left text-[1.0625rem] font-semibold leading-tight outline-none touch-manipulation select-none ' +
  'motion-safe:transition-[background-color,border-color,color,box-shadow,transform] motion-safe:duration-150 motion-safe:active:scale-[0.97] ' +
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50'

export function claseOpcionFicha(elegida: boolean, ninguna = false): string {
  return cn(
    BASE_OPCION,
    elegida
      ? 'ficha-elegida border-primary bg-primary text-primary-foreground shadow-md'
      : ninguna
        ? 'border-dashed border-foreground/25 bg-transparent text-muted-foreground hover:border-foreground/45 hover:text-foreground'
        : 'border-border bg-card text-foreground hover:border-foreground/35',
  )
}

/** Un botón de opción. `marca`: el tilde de las preguntas de varias opciones. */
export function OpcionFicha({
  elegida,
  ninguna = false,
  marca = false,
  deshabilitada,
  onElegir,
  children,
  className,
}: {
  elegida: boolean
  /** «Nada», «Ninguno»: borde punteado mientras no está elegida. */
  ninguna?: boolean
  marca?: boolean
  deshabilitada?: boolean
  onElegir: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={elegida}
      disabled={deshabilitada}
      onClick={onElegir}
      className={cn(claseOpcionFicha(elegida, ninguna), className)}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {marca && (
        <span
          aria-hidden
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full border-2',
            elegida ? 'border-primary-foreground/80 bg-primary-foreground text-primary' : 'border-foreground/20',
          )}
        >
          {elegida && <Check className="size-3.5" strokeWidth={3} />}
        </span>
      )}
    </button>
  )
}

/**
 * La frecuencia como una regla de tiempo: cinco paradas y la barra se llena
 * hasta la elegida (cuánto pasa entre corte y corte).
 */
export function ReglaFrecuencia<K extends string>({
  opciones,
  valor,
  deshabilitada,
  onElegir,
  etiqueta,
}: {
  opciones: ReadonlyArray<{ clave: K; texto: string }>
  valor: K | undefined
  deshabilitada?: boolean
  onElegir: (clave: K) => void
  etiqueta: string
}) {
  const indice = valor ? opciones.findIndex((o) => o.clave === valor) : -1
  const tramos = opciones.length - 1
  // Las paradas van al centro de cada columna: la barra arranca y termina ahí.
  const margen = 50 / opciones.length
  return (
    <div role="group" aria-label={etiqueta} className="relative grid" style={{ gridTemplateColumns: `repeat(${opciones.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden
        className="absolute top-[1.625rem] h-2 rounded-full bg-muted"
        style={{ left: `${margen}%`, right: `${margen}%` }}
      />
      <span
        aria-hidden
        className="absolute top-[1.625rem] h-2 rounded-full bg-fuchsia-500 motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ left: `${margen}%`, width: indice <= 0 ? '0%' : `${(indice / tramos) * (100 - 2 * margen)}%` }}
      />
      {opciones.map((o, i) => {
        const elegida = i === indice
        const pasada = indice >= 0 && i < indice
        return (
          <button
            key={o.clave}
            type="button"
            aria-pressed={elegida}
            disabled={deshabilitada}
            onClick={() => onElegir(o.clave)}
            className="group relative flex min-h-[5.5rem] flex-col items-center gap-2 rounded-2xl pt-2 outline-none touch-manipulation select-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <span
              aria-hidden
              className={cn(
                'relative z-[1] flex size-10 items-center justify-center rounded-full border-[3px] motion-safe:transition-[transform,background-color,border-color] motion-safe:duration-200',
                elegida
                  ? 'ficha-elegida scale-110 border-primary bg-primary text-primary-foreground shadow-md'
                  : pasada
                    ? 'border-fuchsia-500 bg-card'
                    : 'border-border bg-card group-hover:border-foreground/35',
              )}
            >
              {elegida && <Check className="size-4" strokeWidth={3} />}
            </span>
            <span
              className={cn(
                'text-center text-base leading-tight max-[480px]:text-sm',
                elegida ? 'font-bold' : 'font-semibold text-foreground/85',
              )}
            >
              {o.texto}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Los números del fade como peines de máquina: la cifra grande en mono y los
 * dientes arriba. El elegido, grafito.
 */
export function PeinesNumero<K extends string>({
  opciones,
  valor,
  deshabilitada,
  onElegir,
  etiqueta,
}: {
  opciones: ReadonlyArray<{ clave: K; texto: string }>
  valor: K | undefined
  deshabilitada?: boolean
  onElegir: (clave: K) => void
  etiqueta: string
}) {
  return (
    <div role="group" aria-label={etiqueta} className="grid grid-cols-5 gap-2.5 sm:gap-3">
      {opciones.map((o) => {
        const elegida = o.clave === valor
        return (
          <button
            key={o.clave}
            type="button"
            aria-pressed={elegida}
            aria-label={`Número ${o.texto}`}
            disabled={deshabilitada}
            onClick={() => onElegir(o.clave)}
            className={cn(
              'ficha-peine relative flex h-[5.75rem] flex-col items-center justify-end rounded-b-[1.25rem] rounded-t-md border-2 pb-3 outline-none touch-manipulation select-none',
              'motion-safe:transition-[background-color,border-color,color,transform] motion-safe:duration-150 motion-safe:active:scale-[0.96]',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40',
              elegida
                ? 'ficha-elegida border-primary bg-primary text-primary-foreground shadow-md'
                : 'border-border bg-card text-foreground hover:border-foreground/35',
            )}
          >
            <span className="font-mono text-[1.875rem] font-semibold leading-none tabular-nums tracking-[-0.04em]">
              {o.texto}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * La tarjeta perforada de la ficha: un agujero por pregunta (y uno por la
 * foto). Cada respuesta lo perfora; tocar un agujero lleva a su pregunta. Es
 * la misma tarjeta de fichar de Metas: el panel entero es un reloj fichador.
 */
export function TarjetaPerforada({
  agujeros,
  actual,
  ola,
  onIr,
}: {
  agujeros: ReadonlyArray<{ clave: string; numero: number; rotulo: string; estado: 'hecha' | 'falta' | 'no_aplica' }>
  /** La pregunta que se está mirando. */
  actual: string | null
  /** Cambia cuando la ficha se completa: los agujeros hacen una ola. */
  ola: number | null
  onIr: (clave: string) => void
}) {
  return (
    // En el celular, dos hileras de 6 (como una tarjeta de fichar de verdad): en
    // una sola los agujeros quedaban de 20 px, imposibles de tocar.
    <div
      key={ola ?? 'quieta'}
      className="grid grid-cols-6 justify-items-center gap-x-1 gap-y-0.5 rounded-2xl bg-muted/70 px-2 py-1.5 sm:grid-cols-12 sm:px-3 sm:py-2"
    >
      {agujeros.map((a, i) => (
        <button
          key={a.clave}
          type="button"
          onClick={() => onIr(a.clave)}
          aria-label={`${a.numero}. ${a.rotulo}: ${a.estado === 'hecha' ? 'respondida' : a.estado === 'no_aplica' ? 'no aplica' : 'falta'}`}
          aria-current={actual === a.clave ? 'step' : undefined}
          className="group relative flex size-11 shrink-0 items-center justify-center rounded-full outline-none touch-manipulation focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden
            style={ola !== null ? { animationDelay: `${i * 40}ms` } : undefined}
            className={cn(
              'flex size-7 items-center justify-center rounded-full font-mono text-[0.6875rem] font-bold tabular-nums motion-safe:transition-[background-color,box-shadow,transform] motion-safe:duration-200',
              a.estado === 'hecha'
                ? 'ficha-perforado bg-fuchsia-600 text-white shadow-[inset_0_2px_3px_oklch(0_0_0/0.35)]'
                : a.estado === 'no_aplica'
                  ? 'bg-transparent text-muted-foreground/60'
                  : 'bg-card text-muted-foreground shadow-[inset_0_1px_3px_oklch(0.2_0.012_260/0.25)]',
              actual === a.clave && 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-muted',
              ola !== null && 'ficha-ola',
            )}
          >
            {a.estado === 'no_aplica' ? <Minus className="size-3.5" /> : a.numero}
          </span>
        </button>
      ))}
    </div>
  )
}

/** Lo que dice la hoja de su guardado: siempre a la vista, nunca en silencio. */
export function EstadoGuardadoFicha({
  estado,
  error,
  reintentable,
  huboCambios,
  onReintentar,
}: {
  estado: EstadoGuardado
  error: string | null
  reintentable: boolean
  huboCambios: boolean
  onReintentar: () => void
}) {
  if (estado === 'error') {
    return (
      <button
        type="button"
        onClick={onReintentar}
        disabled={!reintentable}
        className="flex min-h-11 max-w-[16rem] items-center gap-2 rounded-xl border border-amber-500/50 bg-amber-400/15 px-3 py-1.5 text-left text-sm font-semibold text-amber-900 outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-default"
      >
        <CloudOff className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 leading-tight">
          {error ?? 'Sin guardar'}
          {reintentable && <span className="block text-xs font-medium opacity-80">Tocá para reintentar ya</span>}
        </span>
      </button>
    )
  }
  if (estado === 'guardando' || estado === 'pendiente') {
    return (
      <span className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        Guardando…
      </span>
    )
  }
  return (
    <span className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground" role="status">
      <Check className={cn('size-4', huboCambios && 'text-emerald-600')} aria-hidden />
      {huboCambios ? 'Guardado' : 'Se guarda sola'}
    </span>
  )
}
