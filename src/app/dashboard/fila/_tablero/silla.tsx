'use client'

import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  CalendarClock,
  Check,
  Coffee,
  MessageCircleQuestionMark,
  MoreHorizontal,
  Play,
  Scissors,
  UserX,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { computeMinutes } from '@/hooks/use-timer-stage'
import type { NextAppointmentInfo } from '@/lib/queue-appointments'
import type { BreakConfig, QueueEntry } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import { TEXTO_ETAPA, etapaDelCorte, minutosDesde, nombreDePila, type BarberRow } from './derivados'
import { FotoBarbero } from './foto-barbero'
import { TextoEspera } from './texto-espera'

/** Qué pasa en la silla de un barbero ahora mismo. */
export type EstadoSilla = 'cortando' | 'descanso' | 'libre' | 'fin_de_turno' | 'sin_entrada'

export const ANILLO: Record<EstadoSilla, string> = {
  cortando: 'ring-emerald-400',
  descanso: 'ring-amber-400',
  libre: 'ring-foreground/80',
  fin_de_turno: 'ring-amber-500/60',
  sin_entrada: 'ring-white/15',
}

export const PUNTO: Record<EstadoSilla, string> = {
  cortando: 'bg-emerald-400',
  descanso: 'bg-amber-400',
  libre: 'bg-foreground',
  fin_de_turno: 'bg-amber-500/70',
  sin_entrada: 'bg-white/25',
}

export const TEXTO_ESTADO: Record<EstadoSilla, string> = {
  cortando: 'Cortando',
  descanso: 'En descanso',
  libre: 'Libre',
  fin_de_turno: 'Termina su turno',
  sin_entrada: 'Sin entrada',
}

/** Minutos de lo que pasa en la silla (corte sin las pausas, o descanso). */
export function minutosEnLaSilla(enCurso: QueueEntry | undefined, ahora: number): number {
  if (!enCurso) return 0
  if (enCurso.is_break) return minutosDesde(enCurso.started_at, ahora)
  return computeMinutes(enCurso.started_at, enCurso.paused_duration_seconds ?? 0, enCurso.paused_at, ahora) ?? 0
}

/**
 * Mientras se arrastra algo, qué es esta silla para lo que está en la mano:
 * dónde soltarlo (y qué pasa si lo suelta) o por qué no.
 */
export interface SoltarEnSilla {
  acepta: boolean
  /** Con `acepta`: lo que pasa al soltar ("Ignacio espera a Lautaro · queda 2º"). Sin: por qué no ("Ya espera con él"). */
  texto: string
}

/** Por qué una silla libre no tiene a nadie para atender, cuando lo decide el motor. */
export interface AvisoSilla {
  tono: 'turno' | 'descanso'
  texto: string
}

export interface SillaProps {
  barbero: BarberRow
  estado: EstadoSilla
  /** Quién está en la silla (corte o descanso en curso). */
  enCurso?: QueueEntry
  ahora: number
  cortesHoy: number
  /** Cuántos esperan con él (su fila propia, sin el pool). */
  enSuFila: number
  /** A quién le toca en esta silla (ver `sillas` en fila-client: las reglas del motor). */
  siguiente?: QueueEntry
  siguienteDelPool?: boolean
  /** El siguiente es el cliente de un turno: su hora reservada y si ya llegó. */
  siguienteTurno?: { hora: string; aTiempo: boolean }
  /** Libre pero sin nadie para atender por una regla del motor (turno inminente, descanso). */
  aviso?: AvisoSilla
  proximoTurno?: NextAppointmentInfo | null
  oculto: boolean
  /** No fichó hoy pero tiene clientes: se ve igual, con el aviso. */
  sinFichar: boolean
  descansos: BreakConfig[]
  /** Hay algo en la mano: qué es esta silla para eso. `null` sin arrastre. */
  soltar: SoltarEnSilla | null
  /** Le acaban de pasar a alguien: la silla lo acusa un momento. */
  aterrizaje: boolean
  ocupadoId: string | null
  onCobrar: (entry: QueueEntry) => void
  onAtender: (entry: QueueEntry) => void
  onCancelar: (entry: QueueEntry) => void
  onDescanso: (config: BreakConfig) => void
  onVerSuFila: () => void
  filtrada: boolean
  /** Hay alguien esperando en la sucursal (si no, una silla libre no pide nada). */
  hayFila: boolean
}

/**
 * La silla de un barbero en la columna del tablero: además de mostrarse, es el
 * lugar donde soltar a un cliente arrastrado desde la fila (pasa a esperar a este
 * barbero sin perder su hora de llegada) o un descanso (se le asigna).
 */
export function Silla(props: SillaProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: props.barbero.id,
    data: { type: 'Column', columnId: props.barbero.id, zona: 'sillas' },
    // Una silla que no lo acepta (es de otra sucursal, ya lo espera) no es
    // destino: soltar ahí no hace nada, en vez de hacer algo raro.
    disabled: props.soltar ? !props.soltar.acepta : false,
  })
  return <FichaSilla {...props} refNodo={setNodeRef} isOver={isOver} />
}

/**
 * Lo que se ve de una silla, sin el arrastre: lo usan la columna (`Silla`) y la
 * hoja del celular. Arriba quién y cuánto; en el segundo renglón sólo con quién
 * está y Cobrar; el botón lleno "Atender a…" sólo en una silla libre con alguien
 * para ella. Al pasar algo por encima, el cartel de "Soltá" se dibuja ENCIMA de
 * la silla: si la silla cambiara de alto bajo el puntero, dnd-kit no remide las
 * de alrededor y el destino titila entre ésta y ninguna.
 */
export function FichaSilla({
  barbero,
  estado,
  enCurso,
  ahora,
  cortesHoy,
  enSuFila,
  siguiente,
  siguienteDelPool,
  siguienteTurno,
  aviso,
  proximoTurno,
  oculto,
  sinFichar,
  descansos,
  soltar,
  aterrizaje,
  ocupadoId,
  onCobrar,
  onAtender,
  onCancelar,
  onDescanso,
  onVerSuFila,
  filtrada,
  hayFila,
  refNodo,
  isOver = false,
  className,
}: SillaProps & { refNodo?: (el: HTMLElement | null) => void; isOver?: boolean; className?: string }) {
  const cortando = estado === 'cortando' && enCurso ? enCurso : undefined
  const enDescanso = estado === 'descanso' && enCurso ? enCurso : undefined
  const minutos = minutosEnLaSilla(enCurso, ahora)
  const etapa = etapaDelCorte(minutos)
  const ocupado = ocupadoId !== null && (ocupadoId === enCurso?.id || ocupadoId === siguiente?.id)
  const apagada = estado === 'sin_entrada' || estado === 'fin_de_turno'
  const recibe = !!soltar?.acepta
  const rechaza = !!soltar && !soltar.acepta

  return (
    <article
      ref={refNodo}
      aria-label={`${barbero.full_name}: ${TEXTO_ESTADO[estado]}`}
      className={cn(
        'relative flex flex-col gap-2.5 rounded-2xl border bg-card px-3.5 py-3',
        'transition-[border-color,box-shadow,opacity,scale] duration-200',
        isOver
          ? 'border-foreground shadow-[0_0_0_3px_oklch(1_0_0/0.12)] motion-safe:scale-[1.015]'
          : aterrizaje
            ? 'border-emerald-400/80 shadow-[0_0_0_4px_oklch(0.77_0.15_163/0.18)]'
            : recibe
              ? 'border-dashed border-foreground/35 bg-white/[0.035]'
              : filtrada
                ? 'border-foreground/40'
                : 'border-border',
        rechaza && 'opacity-45',
        apagada && !soltar && 'opacity-70',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="relative shrink-0">
          <FotoBarbero barbero={barbero} tamano="lg" className={cn('size-10 ring-2 ring-offset-2 ring-offset-card', ANILLO[estado])} />
          <span className={cn('absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-card', PUNTO[estado])} aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold leading-tight">{barbero.full_name}</h3>
            {(cortando || enDescanso) && (
              <span
                className={cn('shrink-0 leading-none', enDescanso ? 'text-amber-200' : TEXTO_ETAPA[etapa])}
                title={cortando ? 'Minutos de corte' : 'Minutos de descanso'}
              >
                <TextoEspera minutos={minutos} className="text-[1.375rem] font-semibold" claseUnidad="text-[0.55em]" />
              </span>
            )}
          </div>
          {/* El segundo renglón es sólo "con quién" y Cobrar: lo demás va al pie,
              para que el nombre del cliente no se achique. */}
          <div className="mt-1 flex min-h-7 items-center gap-2">
            <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
              {cortando ? (
                <>
                  <span className="min-w-0 truncate">
                    con <span className="font-medium text-foreground/90">{cortando.client?.name ?? 'Cliente'}</span>
                  </span>
                  {cortando.pidio_asesoria && (
                    <MessageCircleQuestionMark
                      className="size-3.5 shrink-0 text-fuchsia-300"
                      aria-label={
                        cortando.asesoria_vista_at
                          ? 'Pidió asesoría · su barbero ya vio el aviso'
                          : 'Pidió asesoría · su barbero todavía no confirmó el aviso'
                      }
                    />
                  )}
                </>
              ) : (
                <span
                  className={cn(
                    'truncate',
                    estado === 'fin_de_turno' && 'text-amber-300',
                    estado === 'descanso' && 'text-amber-200',
                  )}
                >
                  {TEXTO_ESTADO[estado]}
                </span>
              )}
            </p>
            {cortando && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onCobrar(cortando)}
                disabled={ocupado}
                className="h-7 shrink-0 gap-1 px-2.5 text-[0.8125rem]"
              >
                <Check className="size-3.5" aria-hidden />
                Cobrar
              </Button>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-mr-1.5 size-8 shrink-0 self-start text-muted-foreground hover:text-foreground"
              aria-label={`Más acciones para ${barbero.full_name}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={onVerSuFila} className="gap-2">
              <Users className="size-4" aria-hidden />
              {filtrada ? 'Ver toda la fila' : 'Ver sólo su fila'}
            </DropdownMenuItem>
            {descansos.length > 0 && !enCurso?.is_break && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Mandar a descanso</DropdownMenuLabel>
                {descansos.map((d) => (
                  <DropdownMenuItem key={d.id} onSelect={() => onDescanso(d)} className="gap-2">
                    <Coffee className="size-4 text-amber-300" aria-hidden />
                    <span className="flex-1 truncate">{d.name}</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{d.duration_minutes} min</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {enCurso && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onCancelar(enCurso)} className="gap-2 text-red-400 focus:text-red-300">
                  <UserX className="size-4" aria-hidden />
                  {enCurso.is_break ? 'Terminar el descanso' : 'Cancelar el corte'}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* El único botón lleno de la columna: una silla libre con alguien para
          ella es lo que el mostrador tiene que resolver. */}
      {estado === 'libre' && siguiente ? (
        <Button
          type="button"
          onClick={() => onAtender(siguiente)}
          disabled={ocupado}
          className="h-auto min-h-10 w-full justify-start gap-2.5 py-2 text-left"
        >
          <Play className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.9375rem] font-semibold leading-tight">
              Atender a {nombreDePila(siguiente.client?.name)}
            </span>
            {siguienteTurno ? (
              <span className="mt-0.5 block text-xs font-medium leading-tight opacity-70">
                Turno de las {siguienteTurno.hora}
                {siguienteTurno.aTiempo ? ' · ya es la hora' : ''}
              </span>
            ) : siguienteDelPool ? (
              <span className="mt-0.5 block text-xs font-medium leading-tight opacity-70">de Menor espera</span>
            ) : null}
          </span>
          <TextoEspera
            minutos={minutosDesde(siguiente.checked_in_at, ahora)}
            className="shrink-0 text-[0.8125rem] font-semibold opacity-75"
          />
        </Button>
      ) : estado === 'libre' && aviso ? (
        <p
          className={cn(
            'flex items-center gap-2 rounded-xl border px-3 py-2 text-[0.8125rem]',
            aviso.tono === 'turno' ? 'border-violet-400/25 text-violet-200' : 'border-amber-400/25 text-amber-200',
          )}
        >
          {aviso.tono === 'turno' ? (
            <CalendarClock className="size-4 shrink-0" aria-hidden />
          ) : (
            <Coffee className="size-4 shrink-0" aria-hidden />
          )}
          <span className="min-w-0">{aviso.texto}</span>
        </p>
      ) : estado === 'libre' && hayFila ? (
        // Hay gente esperando pero nadie para esta silla (son de otros barberos
        // y los de Menor espera ya se le sugirieron a otra): se la ofrece.
        <p className="rounded-xl border border-dashed border-foreground/15 px-3 py-2 text-center text-[0.8125rem] text-muted-foreground">
          Libre · arrastrale a alguien de la fila
        </p>
      ) : null}

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted-foreground">
        <span className="inline-flex items-center gap-1" title={`${cortesHoy} ${cortesHoy === 1 ? 'corte' : 'cortes'} hoy`}>
          <Scissors className="size-3.5" aria-hidden />
          <span className="font-mono tabular-nums">{cortesHoy}</span> hoy
        </span>
        {enSuFila > 0 && (
          <button
            type="button"
            onClick={onVerSuFila}
            className="rounded underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="font-mono tabular-nums">{enSuFila}</span> {enSuFila === 1 ? 'espera' : 'esperan'} con él
          </button>
        )}
        {proximoTurno && (
          <span
            className="inline-flex min-w-0 items-center gap-1.5 text-violet-300"
            title={`Próximo turno ${proximoTurno.timeLabel} · ${proximoTurno.appointment.client?.name ?? 'Cliente'}`}
          >
            <CalendarClock className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              Turno {proximoTurno.timeLabel} · {nombreDePila(proximoTurno.appointment.client?.name)}
            </span>
            {proximoTurno.minutesUntil <= 60 && (
              <span className="shrink-0 font-mono tabular-nums text-violet-200">
                {proximoTurno.minutesUntil <= 1 ? 'ahora' : `en ${proximoTurno.minutesUntil} min`}
              </span>
            )}
          </span>
        )}
        {cortando?.paused_at && <span className="text-amber-300">En pausa</span>}
        {sinFichar && estado !== 'sin_entrada' && <span className="text-amber-300">Sin fichar</span>}
        {oculto && <span>Oculto en la tablet</span>}
      </footer>

      {/* Mientras hay algo en la mano: el cartel va ENCIMA (no cambia el alto).
          Blanco, como el blanco del dock del celular: "acá cae". */}
      {isOver && soltar?.acepta ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center gap-3 rounded-2xl bg-foreground px-4 text-background"
        >
          <FotoBarbero barbero={barbero} tamano="lg" className="size-11 ring-2 ring-background/40" />
          <span className="min-w-0">
            <span className="block text-base font-semibold leading-tight">Soltá acá</span>
            <span className="mt-0.5 block text-[0.8125rem] font-medium leading-snug text-background/70">{soltar.texto}</span>
          </span>
        </div>
      ) : rechaza ? (
        <span className="pointer-events-none absolute right-3 top-3 z-10 rounded-full border border-border bg-card px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
          {soltar.texto}
        </span>
      ) : null}
    </article>
  )
}

/** Un descanso de la sucursal, para arrastrarlo a una silla. */
export function FichaDescanso({ config }: { config: BreakConfig }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `template-break-${config.id}`,
    data: { isTemplate: true, config },
  })
  return (
    <button
      type="button"
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...attributes}
      {...listeners}
      className={cn(
        'inline-flex h-9 shrink-0 cursor-grab touch-manipulation items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 text-[0.8125rem] font-medium text-amber-200 active:cursor-grabbing',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60',
        isDragging ? 'opacity-40' : 'hover:border-amber-400/60',
      )}
      aria-label={`Arrastrar ${config.name} (${config.duration_minutes} min) a una silla`}
    >
      <Coffee className="size-3.5" aria-hidden />
      {config.name}
      <span className="font-mono tabular-nums text-amber-300/80">{config.duration_minutes}′</span>
    </button>
  )
}

/** Los que no ficharon hoy y no tienen a nadie: una línea, no una silla cada uno. */
export function SinFichar({ barberos, className }: { barberos: BarberRow[]; className?: string }) {
  if (barberos.length === 0) return null
  return (
    <div className={cn('flex items-center gap-2.5 rounded-2xl border border-border px-3.5 py-2.5 text-[0.8125rem] text-muted-foreground', className)}>
      <span className="flex shrink-0 -space-x-1.5">
        {barberos.slice(0, 4).map((b) => (
          <FotoBarbero key={b.id} barbero={b} tamano="md" className="size-6 opacity-60 ring-2 ring-background" />
        ))}
      </span>
      <span className="min-w-0">
        No ficharon hoy: <span className="text-foreground/75">{barberos.map((b) => nombreDePila(b.full_name)).join(', ')}</span>
      </span>
    </div>
  )
}
