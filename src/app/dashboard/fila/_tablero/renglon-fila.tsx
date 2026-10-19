'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDown,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  CalendarClock,
  ExternalLink,
  GripVertical,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Phone,
  Play,
  UserX,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AsesoriaBadge } from '@/components/barber/asesoria-badge'
import { TurnoBadge } from '@/components/appointments/turno-badge'
import { esMovidaPorWhatsApp } from '@/lib/barber-utils'
import type { QueueEntry } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import {
  BARRA_NIVEL,
  TEXTO_NIVEL,
  esDelPool,
  lecturaDeEspera,
  minutosDesde,
  nombreDePila,
  ordinal,
  telefonoLlamable,
  type BarberRow,
} from './derivados'
import { FotoBarbero } from './foto-barbero'
import { TextoEspera } from './texto-espera'

/** A dónde se puede pasar a alguien desde el menú (el pool o un barbero). */
export interface DestinoFila {
  id: string
  nombre: string
  /** "libre", "cortando", "sin fichar"… al lado del nombre. */
  nota?: string
}

interface RenglonFilaProps {
  entry: QueueEntry
  /** Su número en la fila de la sucursal, en orden de llegada. */
  orden: number
  ahora: number
  /** Hora RESERVADA del turno (de la agenda), si es un turno. */
  horaTurno?: string
  /** Nombre del servicio que eligió, si se conoce. */
  servicio?: string | null
  /** El barbero que lo va a atender (no está en el pool). */
  barbero?: BarberRow
  /** Su lugar en la fila de ese barbero (1 = sigue él). */
  lugar?: number
  /** La sucursal, sólo cuando se ven todas. */
  sucursal?: string
  /** Menor espera por WhatsApp (mig 218): a quién esperaba. */
  esperabaA?: string
  /**
   * Si se le puede arrancar el corte ya y, si hay una sola silla que lo puede
   * tomar, con quién (`con`: su cara va en el botón); si no, por qué.
   */
  atender: { habilitado: boolean; motivo?: string; con?: BarberRow }
  onAtender: () => void
  destinos: DestinoFila[]
  onMover: (destino: string) => void
  /** Subirlo o bajarlo un lugar (sin arrastrar: celular y teclado). */
  onSubir?: () => void
  onBajar?: () => void
  onSacar: () => void
  ocupado: boolean
}

/**
 * Nada que nazca en los botones o en el menú arranca un arrastre. Los sensores
 * de dnd-kit escuchan `mousedown` / `touchstart` en el renglón, y los eventos
 * sintéticos de React viajan por los portales: sin esto, apretar un ítem del
 * menú y moverse 5 px arrastraba el renglón y lo soltaba en el de abajo, o sea
 * le cambiaba el lugar en la fila a alguien en vez de hacer lo que decía el ítem.
 */
const frenar = (e: React.SyntheticEvent) => e.stopPropagation()

/**
 * La tarjeta de un cliente en la fila. Se agarra entera (con el mouse se
 * arrastra; con el dedo, manteniéndola apretada) para soltarla en la silla de un
 * barbero, que es la gracia de esta pantalla, o entre dos tarjetas para cambiarle
 * el lugar. Los turnos no se arrastran: `reordenar` reescribe `priority_order`
 * del arrastrado y en un turno ésa es su HORA RESERVADA (la clave de toda la
 * convivencia con la fila). Se reprograman desde la agenda.
 */
export function RenglonFila({
  entry,
  orden,
  ahora,
  horaTurno,
  servicio,
  barbero,
  lugar,
  sucursal,
  esperabaA,
  atender,
  onAtender,
  destinos,
  onMover,
  onSubir,
  onBajar,
  onSacar,
  ocupado,
}: RenglonFilaProps) {
  const esTurno = entry.is_appointment
  const esDescanso = entry.is_break
  const delPool = esDelPool(entry)

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
    data: { entry },
    // Sólo `draggable`: el turno sigue siendo un lugar donde soltar, para que un
    // walk-in se pueda poner antes o después de él.
    disabled: { draggable: esTurno },
  })

  const minutos = minutosDesde(entry.checked_in_at, ahora)
  const { nivel, fraccion } = lecturaDeEspera(minutos)
  const pidioAsesoria = !esDescanso && entry.pidio_asesoria === true
  const viaWhatsApp = esMovidaPorWhatsApp(entry)
  const nombre = esDescanso ? 'Descanso' : (entry.client?.name ?? 'Cliente')
  const telefono = esDescanso ? null : telefonoLlamable(entry.client?.phone)
  const nombreBarbero = nombreDePila(barbero?.full_name ?? entry.barber?.full_name)

  /**
   * Un turno no se arrastra: si lo intenta de verdad (el mismo umbral de 5 px
   * del MouseSensor), se le dice dónde se mueve. Con un `onPointerDown` pelado,
   * cualquier toque para scrollear en la tablet levantaba el cartel.
   */
  function avisarQueNoSeArrastra(e: React.PointerEvent) {
    const x0 = e.clientX
    const y0 = e.clientY
    function limpiar() {
      window.removeEventListener('pointermove', alMover)
      window.removeEventListener('pointerup', limpiar)
      window.removeEventListener('pointercancel', limpiar)
    }
    function alMover(ev: PointerEvent) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      limpiar()
      toast.info('Los turnos se mueven desde la agenda, no desde la fila', {
        id: 'turno-no-se-arrastra',
        description: 'Ahí se reprograma la hora o el barbero y la fila se actualiza sola.',
        action: { label: 'Ir a la agenda', onClick: () => { window.location.href = '/dashboard/turnos/agenda' } },
      })
    }
    window.addEventListener('pointermove', alMover)
    window.addEventListener('pointerup', limpiar)
    window.addEventListener('pointercancel', limpiar)
  }

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)',
      }}
      // Con el mouse o el dedo se agarra desde cualquier parte de la tarjeta;
      // con el teclado, desde su número (que es el que recibe el foco).
      {...(esTurno ? { onPointerDown: avisarQueNoSeArrastra } : listeners)}
      className={cn(
        // La tarjeta se arma según el ancho de la LISTA (container query), no de
        // la pantalla: a 1024 px con el menú abierto, o en un iPad, la lista mide
        // lo que un celular y el formato ancho le aplastaba los nombres.
        // Sin selección de texto ni el menú de "guardar imagen" de iOS al
        // mantenerla apretada: ese gesto es el que la levanta.
        'group relative grid touch-manipulation select-none grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-2.5 overflow-hidden rounded-xl border py-2.5 pl-1.5 pr-2 outline-none [-webkit-touch-callout:none]',
        'transition-[border-color,background-color,opacity] duration-150',
        '@lg:grid-cols-[3rem_minmax(0,1fr)_7.5rem_auto] @lg:gap-x-3 @lg:py-2 @lg:pr-2.5',
        esTurno
          ? 'cursor-default border-violet-400/20 bg-violet-500/[0.04]'
          : esDescanso
            ? 'cursor-grab border-amber-400/20 bg-amber-500/[0.05] active:cursor-grabbing'
            : 'cursor-grab border-white/[0.08] bg-white/[0.025] hover:border-white/[0.2] hover:bg-white/[0.05] active:cursor-grabbing',
        // El lugar que deja la tarjeta mientras está en la mano.
        isDragging && 'border-dashed border-white/25 bg-transparent [&>*]:opacity-25',
      )}
    >
      {/* La manija y su número en la fila: la llegada, no la posición de la tablet */}
      <span
        ref={setActivatorNodeRef}
        {...(esTurno ? {} : attributes)}
        aria-label={esTurno ? undefined : `Mover a ${nombre}: pasarlo a un barbero o cambiarle el lugar`}
        className="flex items-center gap-0.5 rounded-md py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {esTurno ? (
          <CalendarClock className="size-3.5 shrink-0 text-violet-300/70" aria-hidden />
        ) : (
          <GripVertical
            className="size-3.5 shrink-0 text-foreground/30 transition-colors group-hover:text-foreground/70 pointer-coarse:text-foreground/45"
            aria-hidden
          />
        )}
        <span
          className={cn(
            'min-w-0 flex-1 text-center font-mono text-[0.9375rem] font-semibold tabular-nums',
            esDescanso ? 'text-amber-300/80' : 'text-muted-foreground',
          )}
        >
          {esDescanso ? <Pause className="mx-auto size-4" aria-hidden /> : orden}
        </span>
      </span>

      {/* Con una lista ancha, nombre y "con quién" van en un solo renglón: con
          40 esperando entran más a la vista. */}
      <div className="min-w-0 @[46rem]:flex @[46rem]:items-center @[46rem]:gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @[46rem]:w-[12rem] @[46rem]:shrink-0">
          <span className={cn('min-w-0 truncate text-[0.9375rem] font-semibold', esDescanso ? 'text-amber-200' : 'text-foreground')}>
            {nombre}
          </span>
          {esTurno && horaTurno && <TurnoBadge time={horaTurno} className="text-violet-300" />}
          {pidioAsesoria && (
            <span title="Pidió asesoría sin costo: no sabe qué hacerse. El barbero lo ve al empezar a atenderlo." className="inline-flex">
              <AsesoriaBadge tono="oscuro" />
            </span>
          )}
          {viaWhatsApp && (
            <span
              title="Aceptó pasarse a Menor espera desde el aviso de WhatsApp. Conserva su lugar en la fila."
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-px text-[0.6875rem] font-semibold text-sky-300"
            >
              <MessageCircle className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{esperabaA ? `WhatsApp · esperaba a ${nombreDePila(esperabaA)}` : 'Por WhatsApp'}</span>
            </span>
          )}
        </div>

        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-muted-foreground @[46rem]:mt-0 @[46rem]:flex-1">
          {esDescanso ? (
            <span className="truncate">de {barbero?.full_name ?? entry.barber?.full_name ?? 'su barbero'}</span>
          ) : delPool ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-sky-300">
              <span className="size-2 rounded-full bg-sky-400" aria-hidden />
              Menor espera
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <FotoBarbero barbero={barbero ?? entry.barber ?? undefined} tamano="xs" />
              <span>
                con <span className="font-medium text-foreground/85">{nombreBarbero}</span>
              </span>
              {lugar !== undefined &&
                (lugar === 1 ? (
                  <span className="font-semibold text-foreground">· sigue</span>
                ) : (
                  <span className="font-mono tabular-nums">· {ordinal(lugar)}</span>
                ))}
            </span>
          )}
          {servicio && !esDescanso && <span className="hidden min-w-0 truncate @lg:inline">· {servicio}</span>}
          {sucursal && <span className="min-w-0 truncate">· {sucursal}</span>}
          {/* Con la lista angosta la espera va acá, en su renglón */}
          {!esDescanso && (
            <TextoEspera minutos={minutos} className={cn('ml-auto shrink-0 pl-1 font-semibold @lg:hidden', TEXTO_NIVEL[nivel])} />
          )}
        </p>
      </div>

      {/* La espera dibujada: en orden de llegada las barras bajan como una
          escalera, y quien se quedó atrás salta a la vista. */}
      <div className="hidden flex-col items-end gap-1.5 @lg:flex" aria-hidden>
        {!esDescanso && (
          <>
            <TextoEspera minutos={minutos} className={cn('text-[0.9375rem] font-semibold', TEXTO_NIVEL[nivel])} />
            <span className="h-1 w-full overflow-hidden rounded-full bg-foreground/[0.08]">
              <span
                className={cn('block h-full rounded-full', BARRA_NIVEL[nivel])}
                style={{ width: `${Math.max(4, fraccion * 100)}%` }}
              />
            </span>
          </>
        )}
      </div>

      {/* Con la lista angosta la espera no tiene columna: su barra corre por el
          borde de abajo de la tarjeta. */}
      {!esDescanso && (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 @lg:hidden">
          <span className={cn('block h-full opacity-70', BARRA_NIVEL[nivel])} style={{ width: `${Math.max(3, fraccion * 100)}%` }} />
        </span>
      )}

      {/* Los botones y el menú (que se portalea, pero sus eventos pasan por acá)
          no arrancan un arrastre. */}
      <div className="flex items-center justify-end gap-1" onMouseDown={frenar} onTouchStart={frenar} onPointerDown={frenar}>
        {/* Sólo cuando se puede: con su barbero cortando, un botón apagado en
            cada tarjeta era ruido. El menú dice por qué y ofrece pasarlo. */}
        {!esDescanso && atender.habilitado && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onAtender()
            }}
            disabled={ocupado}
            title={
              atender.con
                ? `Atender a ${nombre} con ${atender.con.full_name}`
                : delPool
                  ? 'Elegir barbero y arrancar el corte'
                  : 'Arrancar el corte'
            }
            className="h-9 gap-1.5 px-2.5 @lg:px-3"
            aria-label={atender.con ? `Atender a ${nombre} con ${nombreDePila(atender.con.full_name)}` : `Atender a ${nombre}`}
          >
            <Play className="size-3.5" aria-hidden />
            <span className="hidden @lg:inline">Atender</span>
            {/* Una sola silla puede tomarlo: arranca con ESE barbero, y se ve. */}
            {atender.con && <FotoBarbero barbero={atender.con} tamano="xs" className="size-5 ring-1 ring-foreground/20" />}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={ocupado}
              className="size-9 text-muted-foreground hover:text-foreground"
              aria-label={`Más acciones para ${nombre}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {!esDescanso && !atender.habilitado && atender.motivo && (
              <>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{atender.motivo}</DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            {telefono && (
              <>
                <DropdownMenuItem asChild>
                  <a href={`tel:${telefono.replace(/[^\d+]/g, '')}`} className="gap-2">
                    <Phone className="size-4" aria-hidden />
                    <span className="flex-1">Llamar</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{telefono}</span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {esTurno ? (
              <>
                <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                  <CalendarClock className="size-3.5 text-violet-300" aria-hidden />
                  Los turnos se mueven desde la agenda
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <a href="/dashboard/turnos/agenda" className="gap-2">
                    <ExternalLink className="size-4" aria-hidden />
                    Abrir la agenda
                  </a>
                </DropdownMenuItem>
              </>
            ) : !esDescanso && destinos.length > 0 ? (
              <>
                <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                  <ArrowRightLeft className="size-3.5" aria-hidden />
                  Pasar a
                </DropdownMenuLabel>
                {destinos.map((d) => (
                  <DropdownMenuItem key={d.id} onSelect={() => onMover(d.id)} className="gap-2">
                    <span className="min-w-0 flex-1 truncate">{d.nombre}</span>
                    {d.nota && <span className="shrink-0 text-xs text-muted-foreground">{d.nota}</span>}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            {(esTurno || (!esDescanso && destinos.length > 0)) && <DropdownMenuSeparator />}
            {!esTurno && (onSubir || onBajar) && (
              <>
                {onSubir && (
                  <DropdownMenuItem onSelect={onSubir} className="gap-2">
                    <ArrowUp className="size-4" aria-hidden />
                    Subir un lugar
                  </DropdownMenuItem>
                )}
                {onBajar && (
                  <DropdownMenuItem onSelect={onBajar} className="gap-2">
                    <ArrowDown className="size-4" aria-hidden />
                    Bajar un lugar
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={onSacar} className="gap-2 text-red-400 focus:text-red-300">
              <UserX className="size-4" aria-hidden />
              {esDescanso ? 'Cancelar el descanso' : 'Sacar de la fila'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

/** A dónde va a parar lo que se arrastra, para decirlo en la tarjeta en la mano. */
export interface DestinoEnLaMano {
  texto: string
  /** El barbero (su cara va al lado); sin barbero es Menor espera. */
  barbero?: BarberRow
}

/**
 * La tarjeta en la mano mientras se arrastra: el cliente y, al pasar por una
 * silla, a dónde va a parar ("→ Lautaro · queda 2º"). La confirmación se lee
 * debajo del puntero, sin buscarla en la silla.
 */
export function RenglonFantasma({
  entry,
  ahora,
  destino,
}: {
  entry: QueueEntry
  ahora: number
  destino?: DestinoEnLaMano | null
}) {
  const minutos = minutosDesde(entry.checked_in_at, ahora)
  const { nivel } = lecturaDeEspera(minutos)
  return (
    <div
      className={cn(
        'w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card px-3 py-2.5 shadow-[0_24px_48px_-12px_rgb(0_0_0/0.85)] motion-safe:rotate-[1.5deg]',
        destino ? 'border-foreground/60' : 'border-white/20',
      )}
    >
      <div className="flex items-center gap-2.5">
        {entry.is_break ? (
          <Pause className="size-4 shrink-0 text-amber-300" aria-hidden />
        ) : (
          <GripVertical className="size-4 shrink-0 text-foreground/50" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">
          {entry.is_break ? 'Descanso' : (entry.client?.name ?? 'Cliente')}
        </span>
        {!entry.is_break && (
          <TextoEspera minutos={minutos} className={cn('shrink-0 text-sm font-semibold', TEXTO_NIVEL[nivel])} />
        )}
      </div>
      {destino && (
        <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2 text-[0.8125rem] font-medium">
          <ArrowRight className="size-3.5 shrink-0 text-foreground/70" aria-hidden />
          {destino.barbero ? (
            <FotoBarbero barbero={destino.barbero} tamano="xs" className="size-5" />
          ) : (
            <span className="size-2.5 shrink-0 rounded-full bg-sky-400" aria-hidden />
          )}
          <span className="min-w-0 truncate">{destino.texto}</span>
        </div>
      )}
    </div>
  )
}
