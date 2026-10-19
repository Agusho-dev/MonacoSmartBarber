'use client'

import { CalendarClock, ChevronRight, Coffee, MessageCircle, Scissors, User, X, Zap } from 'lucide-react'
import type { QueueEntry } from '@/lib/types/database'
import type { LoyaltyTierLite } from '@/lib/loyalty-checkout'
import { leerLoyaltyEmbed } from '@/lib/loyalty-embed'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { TurnoBadge } from '@/components/appointments/turno-badge'
import { AsesoriaBadge } from '../asesoria-badge'
import { LoyaltyTierChip } from '../loyalty-tier-chip'
import { Sello } from './sello'
import { formatoEspera, nivelEspera, partesDeEspera, type NivelEspera } from './espera'

/**
 * Qué se puede hacer con una ficha. Lo decide el panel (queue-panel.tsx →
 * `accionDe`), con las mismas reglas de siempre: la ficha sólo lo dibuja.
 *  · `atender`: el claim con esta entrada como preferida.
 *  · `reclamar`: lo mismo, sobre un cliente que el hint le sugirió a otro.
 *  · `turno`: arranca ESE turno (`markAppointmentInProgress`). `aTiempo` = su
 *    hora ya llegó y el motor le da precedencia: botón principal.
 */
export type AccionEntrada = { tipo: 'atender' } | { tipo: 'reclamar' } | { tipo: 'turno'; aTiempo: boolean }

export type NotaWhatsApp = { tipo: 'me-esperaba' } | { tipo: 'esperaba-a'; barbero: string }

export interface TarjetaEsperaProps {
  entrada: QueueEntry
  /**
   * `silla`: el próximo, esperando en la silla libre (grande, con Atender).
   * `propia`: en "Tu fila". `local`: en el resto del local (renglón compacto).
   */
  variante: 'silla' | 'propia' | 'local'
  /** Lugar en "Tu fila" (1 = el que sigue). Sólo en `propia`. */
  orden?: number
  /** Minutos que lleva esperando, con el reloj del panel. */
  minutosEsperando: number
  /** Hora de llegada (HH:MM). */
  llegada: string
  /** Categoría del programa de fidelización, o null (programa apagado / sin categoría). */
  tier: LoyaltyTierLite | null
  /** Hora RESERVADA (HH:MM) si entró por un turno. */
  horaTurno: string | null
  /** Pidió asesoría hace instantes: anillo fucsia (queue-panel lo saca a los 12 s). */
  asesoriaReciente?: boolean
  /** Aceptó Menor espera por WhatsApp: a quién esperaba. */
  notaWhatsApp?: NotaWhatsApp | null
  /** "Se atiende con X" (sólo en `local`). */
  atiendeCon?: string | null
  /**
   * La silla trae a alguien del resto del local (sin barbero, lo toma el primero
   * libre) porque tu fila está vacía. Sólo en `silla`.
   */
  delLocal?: boolean
  accion: AccionEntrada | null
  /** Por qué no hay botón, cuando no es obvio (sólo en `silla`). */
  motivoSinAccion?: string | null
  /** Hay una acción en curso sobre esta entrada (atender, ausente…). */
  ocupada?: boolean
  onAccion?: () => void
  onAusente: () => void
  /** Abre la ficha del cliente (observaciones, Instagram, cortes con fotos). */
  onVerFicha?: () => void
}

const TONO_ESPERA: Record<NivelEspera, string> = {
  normal: 'text-foreground',
  demorado: 'text-amber-700',
  critico: 'text-red-700',
}

const FONDO_ESPERA: Record<NivelEspera, string> = {
  normal: 'bg-muted',
  demorado: 'bg-amber-400/20 ring-1 ring-amber-500/40',
  critico: 'bg-red-500/12 ring-1 ring-red-500/45',
}

export function TarjetaEspera(props: TarjetaEsperaProps) {
  if (props.variante === 'local') return <RenglonLocal {...props} />
  return props.variante === 'silla' ? <FichaEnSilla {...props} /> : <FichaPropia {...props} />
}

// ─── Piezas compartidas ──────────────────────────────────────────────────────

function nombreDe(entrada: QueueEntry) {
  return entrada.client?.name?.trim() || 'Cliente'
}

/** El nombre abre la ficha. El área táctil crece hacia arriba y abajo, lejos de los botones. */
function Nombre({
  entrada,
  onVerFicha,
  ajustar = false,
  className,
}: {
  entrada: QueueEntry
  onVerFicha?: () => void
  /** Partir en renglones en vez de cortar con "…" (la silla: el nombre se lee entero). */
  ajustar?: boolean
  className?: string
}) {
  const nombre = nombreDe(entrada)
  const corte = ajustar ? '[overflow-wrap:anywhere]' : 'truncate'
  if (!entrada.client || !onVerFicha) {
    return <p className={cn(corte, className)}>{nombre}</p>
  }
  return (
    <button
      type="button"
      onClick={onVerFicha}
      aria-label={`Ver la ficha de ${nombre}`}
      className="group/nombre relative -mx-1 flex min-w-0 max-w-full touch-manipulation items-center gap-1 rounded-md px-1 text-left outline-none before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-[''] focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span className={cn(corte, 'decoration-foreground/25 underline-offset-4 group-hover/nombre:underline', className)}>
        {nombre}
      </span>
      <ChevronRight
        aria-hidden
        className="size-[1.1em] shrink-0 text-muted-foreground/70 motion-safe:transition-transform group-hover/nombre:translate-x-0.5"
      />
    </button>
  )
}

/** Sellos de la ficha: categoría, turno, especial / primer corte, Menor espera, WhatsApp, asesoría. */
function sellosDe(props: TarjetaEsperaProps): React.ReactNode[] {
  const { entrada, tier, horaTurno, notaWhatsApp } = props
  const loyalty = leerLoyaltyEmbed(entrada.client?.loyalty)
  const telefono = entrada.client?.phone ?? ''
  // Cliente especial (walk-in sin teléfono): teléfono virtual 00XXXXXXXX.
  const especial = telefono.startsWith('00') && telefono.length === 10
  // Sin fila de estado = nunca tuvo una visita (verificado en prod).
  const primerCorte = !especial && (loyalty?.total_visits ?? 0) === 0
  const viaWhatsApp = notaWhatsApp != null || (entrada.is_dynamic && entrada.dynamic_via_whatsapp_at != null)
  const sellos: React.ReactNode[] = []
  if (tier) sellos.push(<LoyaltyTierChip key="tier" tier={tier} className="h-6" />)
  // Hora RESERVADA, tomada de la agenda (no de priority_order: en una entrada
  // adoptada de un walk-in ése es la hora de llegada).
  if (horaTurno) {
    sellos.push(<TurnoBadge key="turno" time={horaTurno} className="h-6 px-1.5 text-[0.6875rem]" iconClassName="size-3" />)
  }
  if (especial) sellos.push(<Sello key="especial" tono="ambar">Especial</Sello>)
  if (primerCorte) sellos.push(<Sello key="primer" tono="verde">Primer corte</Sello>)
  if (entrada.is_dynamic) {
    sellos.push(
      <Sello key="menor" tono="azul">
        <Zap className="fill-current" aria-hidden />
        Menor espera
      </Sello>,
    )
  }
  // Califica al de al lado: se pasó a Menor espera desde el aviso de WhatsApp.
  // Entra con una animación corta: es lo que cambió en la ficha.
  if (viaWhatsApp) {
    sellos.push(
      <Sello
        key="whatsapp"
        tono="azul"
        title="Aceptó pasarse a Menor espera desde el aviso de WhatsApp"
        className="bg-transparent motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300"
      >
        <MessageCircle aria-hidden />
        Por WhatsApp
      </Sello>,
    )
  }
  if (entrada.pidio_asesoria === true) {
    sellos.push(
      <AsesoriaBadge
        key="asesoria"
        tono="claro"
        className="h-6 px-1.5 text-[0.6875rem] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300"
      />,
    )
  }
  return sellos
}

function Sellos({ sellos, className }: { sellos: React.ReactNode[]; className?: string }) {
  if (sellos.length === 0) return null
  return <div className={cn('flex flex-wrap items-center gap-1.5', className)}>{sellos}</div>
}

/** Qué viene a hacerse: el servicio, o la asesoría si la eligió en vez de un servicio. */
function Servicio({ entrada, className }: { entrada: QueueEntry; className?: string }) {
  const asesoria = entrada.pidio_asesoria === true
  if (!entrada.service && !asesoria) return null
  return (
    <p className={cn('truncate', className)}>
      {entrada.service ? (
        <>
          {entrada.service.name}
          {asesoria && <span className="font-semibold text-fuchsia-700"> · pidió asesoría</span>}
        </>
      ) : (
        <span className="font-semibold text-fuchsia-700">Quiere asesoría</span>
      )}
    </p>
  )
}

function LineaWhatsApp({ nota }: { nota: NotaWhatsApp | null | undefined }) {
  if (!nota) return null
  return (
    <p className="flex items-start gap-1.5 text-[0.8125rem] text-muted-foreground">
      <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-blue-600" aria-hidden />
      {nota.tipo === 'me-esperaba' ? (
        <span>Sigue en tu fila · si otro barbero se libera antes, lo atiende él</span>
      ) : (
        <span>
          Esperaba a <span className="font-medium text-foreground/80">{nota.barbero}</span>
        </span>
      )}
    </p>
  )
}

/** "22 min" con el número en mono y la unidad en la letra del texto. */
export function CifraEspera({
  minutos,
  claseUnidad = 'text-[0.62em]',
}: {
  minutos: number
  /** Tamaño de la unidad relativo a la cifra (en el cronómetro de la silla, más chica). */
  claseUnidad?: string
}) {
  return (
    <>
      {partesDeEspera(minutos).map((p, i) => (
        <span key={i} className="inline-flex items-baseline">
          <span className="font-mono font-semibold tabular-nums">{p.valor}</span>
          {p.unidad && <span className={cn('ml-[0.2em] font-sans font-semibold', claseUnidad)}>{p.unidad}</span>}
          {i === 0 && p.unidad === 'h' && <span className="w-[0.3em]" />}
        </span>
      ))}
    </>
  )
}

/** La espera como sello de reloj: minutos grandes, llegada chica. Ámbar a los 40, rojo a los 70. */
function Espera({
  minutos,
  llegada,
  tamano,
}: {
  minutos: number
  llegada: string
  tamano: 'grande' | 'normal' | 'chica'
}) {
  const nivel = nivelEspera(minutos)
  const texto = formatoEspera(minutos)
  if (tamano === 'chica') {
    return (
      <span
        className={cn(
          'inline-flex h-7 shrink-0 items-center rounded-lg px-2 text-[0.9375rem] leading-none',
          FONDO_ESPERA[nivel],
          TONO_ESPERA[nivel],
        )}
        aria-label={`Esperando hace ${texto}`}
      >
        <CifraEspera minutos={minutos} />
      </span>
    )
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
      <span
        className={cn(
          'inline-flex items-baseline rounded-xl leading-none',
          tamano === 'grande' ? 'px-3 py-2 text-[2.125rem] max-sm:text-[1.625rem]' : 'px-2.5 py-1.5 text-xl max-sm:text-lg',
          FONDO_ESPERA[nivel],
          TONO_ESPERA[nivel],
        )}
        aria-label={`Esperando hace ${texto}`}
      >
        <CifraEspera minutos={minutos} />
      </span>
      <span className={cn('text-muted-foreground max-sm:hidden', tamano === 'grande' ? 'text-[0.8125rem]' : 'text-xs')}>
        {nivel === 'critico' ? 'Lleva demasiado' : nivel === 'demorado' ? 'Se está demorando' : 'esperando'}
        {' · '}
        <span className="font-mono tabular-nums">llegó {llegada}</span>
      </span>
    </div>
  )
}

function BotonAccion({
  props,
  tamano,
}: {
  props: TarjetaEsperaProps
  tamano: 'silla' | 'propia' | 'local'
}) {
  const { accion, onAccion, ocupada } = props
  if (!accion || !onAccion) return null
  const esTurno = accion.tipo === 'turno'
  const secundaria = accion.tipo === 'reclamar' || (esTurno && !accion.aTiempo)
  const texto = esTurno ? 'Iniciar turno' : accion.tipo === 'reclamar' ? 'Reclamar' : 'Atender'
  const Icono = esTurno ? CalendarClock : Scissors
  return (
    <Button
      type="button"
      onClick={onAccion}
      disabled={ocupada}
      variant={secundaria ? 'outline' : 'default'}
      title={esTurno && !accion.aTiempo ? 'Todavía no es la hora del turno' : undefined}
      className={cn(
        'touch-manipulation font-bold motion-safe:active:scale-[0.98]',
        tamano === 'silla' && 'h-16 w-full rounded-2xl px-8 text-lg [&_svg]:size-5',
        tamano === 'propia' && 'h-12 rounded-xl px-5 text-base [&_svg]:size-[1.125rem]',
        tamano === 'local' && 'h-11 rounded-xl px-4 text-[0.9375rem]',
        secundaria && 'border-foreground/25 bg-card',
      )}
    >
      <Icono aria-hidden />
      {ocupada ? 'Un momento…' : texto}
    </Button>
  )
}

/** "No se presentó": confirma antes, porque saca al cliente de la fila para siempre. */
function BotonAusente({
  props,
  estilo,
}: {
  props: TarjetaEsperaProps
  estilo: 'icono' | 'texto'
}) {
  const nombre = nombreDe(props.entrada)
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {estilo === 'icono' ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={props.ocupada}
            aria-label={`${nombre} no se presentó`}
            title="No se presentó / Ausente"
            className="size-11 shrink-0 rounded-xl text-muted-foreground hover:bg-red-500/10 hover:text-red-700 [&_svg]:size-5"
          >
            <X />
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={props.ocupada}
            className="h-12 rounded-xl px-4 text-[0.9375rem] font-semibold text-muted-foreground hover:bg-red-500/10 hover:text-red-700"
          >
            <X aria-hidden className="size-4" />
            No vino
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿{nombre} no se presentó?</AlertDialogTitle>
          <AlertDialogDescription>
            Lo marca como ausente y lo saca de la fila. No se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Volver</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={props.onAusente}
          >
            Sí, no vino
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Tinte de la ficha: la asesoría se reconoce de lejos por el color de la cartulina. */
function claseCartulina(entrada: QueueEntry, asesoriaReciente?: boolean) {
  return cn(
    entrada.pidio_asesoria === true
      ? 'border-fuchsia-500/35 bg-[oklch(0.985_0.012_330)]'
      : 'border-border/80 bg-card',
    asesoriaReciente && 'asesoria-recien',
  )
}

// ─── Variantes ───────────────────────────────────────────────────────────────

/**
 * El próximo, esperando en la silla libre: la ficha más grande de la pantalla.
 *
 * Se dibuja "sin marcar": filete punteado y cartulina gris, el mismo lenguaje de
 * la silla vacía y del descanso próximo. Cartulina llena es "corre el reloj"; si
 * el que espera también fuera blanco, se confundiría con un corte de 0–25 min.
 */
function FichaEnSilla(props: TarjetaEsperaProps) {
  const { entrada, minutosEsperando, llegada, motivoSinAccion, onVerFicha, asesoriaReciente, delLocal } = props
  const asesoria = entrada.pidio_asesoria === true
  return (
    <article
      aria-label={`Sigue ${nombreDe(entrada)}`}
      className={cn(
        'silla-entra relative rounded-[1.75rem] border-2 border-dashed p-5 sm:p-7',
        asesoria ? 'border-fuchsia-500/45 bg-[oklch(0.975_0.016_330)]' : 'border-foreground/20 bg-secondary',
        asesoriaReciente && 'asesoria-recien',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Nombre
            entrada={entrada}
            onVerFicha={onVerFicha}
            ajustar
            className="text-[2.25rem] font-bold leading-[1.1] tracking-[-0.02em] max-sm:text-[1.75rem]"
          />
          <Servicio entrada={entrada} className="mt-1 text-lg font-medium text-foreground/75 max-sm:text-base" />
          {delLocal && (
            <p className="mt-1 text-[0.9375rem] font-semibold text-blue-700">
              Sin barbero asignado: lo atiende el primero que lo tome
            </p>
          )}
          {/* "Sigue" encabeza los sellos: dice en palabras el estado de la silla. */}
          <Sellos
            sellos={[
              <Sello key="sigue" tono="tinta">
                Sigue
              </Sello>,
              ...sellosDe(props),
            ]}
            className="mt-3"
          />
        </div>
        <Espera minutos={minutosEsperando} llegada={llegada} tamano="grande" />
      </div>
      <LineaWhatsApp nota={props.notaWhatsApp} />
      <div className="mt-6 space-y-2">
        <BotonAccion props={props} tamano="silla" />
        {!props.accion && motivoSinAccion && (
          <p className="text-[0.9375rem] font-medium text-muted-foreground">{motivoSinAccion}</p>
        )}
        <div className="flex justify-end">
          <BotonAusente props={props} estilo="texto" />
        </div>
      </div>
    </article>
  )
}

/** Una ficha de "Tu fila". */
function FichaPropia(props: TarjetaEsperaProps) {
  const { entrada, orden, minutosEsperando, llegada, onVerFicha, asesoriaReciente } = props
  const esElQueSigue = orden === 1
  const sellos = sellosDe(props)
  const hayRenglonDeAbajo = sellos.length > 0 || !!props.notaWhatsApp || (!!props.accion && !!props.onAccion)
  return (
    <article
      aria-label={`${orden ? `${orden}º en tu fila: ` : ''}${nombreDe(entrada)}`}
      className={cn(
        'ficha-asoma flex items-start gap-3 rounded-[1.25rem] border p-4 shadow-[0_8px_22px_-18px_oklch(0.2_0.012_260/0.5)] sm:gap-4 sm:p-5',
        claseCartulina(entrada, asesoriaReciente),
      )}
    >
      {orden != null && (
        <div className="flex w-9 shrink-0 flex-col items-center pt-0.5 sm:w-11">
          <span
            className={cn(
              'font-mono text-[1.75rem] font-semibold leading-none tabular-nums',
              esElQueSigue ? 'text-foreground' : 'text-muted-foreground/70',
            )}
          >
            {orden}
          </span>
          {esElQueSigue && <span className="mt-1 text-[0.6875rem] font-semibold text-muted-foreground">sigue</span>}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Nombre
              entrada={entrada}
              onVerFicha={onVerFicha}
              className="text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] max-sm:text-lg"
            />
            <Servicio entrada={entrada} className="mt-0.5 text-[0.9375rem] text-foreground/65" />
          </div>
          <Espera minutos={minutosEsperando} llegada={llegada} tamano="normal" />
          <div className="-mr-2 -mt-1">
            <BotonAusente props={props} estilo="icono" />
          </div>
        </div>
        {/* Sellos a la izquierda y, si hay, la acción a la derecha. Sin nada
            que mostrar (lo normal en el que no sigue) el renglón no existe. */}
        {hayRenglonDeAbajo && (
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <Sellos sellos={sellos} />
              <LineaWhatsApp nota={props.notaWhatsApp} />
            </div>
            <BotonAccion props={props} tamano="propia" />
          </div>
        )}
      </div>
    </article>
  )
}

/** Un renglón del resto del local: compacto, para no competir con lo propio. */
function RenglonLocal(props: TarjetaEsperaProps) {
  const { entrada, minutosEsperando, onVerFicha, atiendeCon, asesoriaReciente } = props
  return (
    <article
      aria-label={nombreDe(entrada)}
      className={cn(
        'ficha-asoma flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-4 py-3',
        claseCartulina(entrada, asesoriaReciente),
      )}
    >
      <div className="min-w-0 flex-1 basis-56">
        <Nombre entrada={entrada} onVerFicha={onVerFicha} className="text-base font-semibold leading-tight" />
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
          {atiendeCon ? (
            <>
              <User className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                con <span className="font-medium text-foreground/75">{atiendeCon}</span>
              </span>
            </>
          ) : (
            <span className="truncate font-medium text-blue-700">Sin barbero: lo toma el primero libre</span>
          )}
        </div>
        <Sellos sellos={sellosDe(props)} className="mt-2" />
        <div className="mt-1">
          <LineaWhatsApp nota={props.notaWhatsApp} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Espera minutos={minutosEsperando} llegada={props.llegada} tamano="chica" />
        <BotonAccion props={props} tamano="local" />
        <BotonAusente props={props} estilo="icono" />
      </div>
    </article>
  )
}

/**
 * Mi descanso pendiente, en su lugar del tarjetero (ámbar = descansos en todo
 * el panel). Cuando lo primero de la fila es el descanso y la silla está libre,
 * sube a la silla (`SillaDescansoProximo`) en vez de aparecer acá.
 */
export function FichaDescansoEnFila({ cortesAntes }: { cortesAntes: number }) {
  return (
    <article
      aria-label="Tu descanso"
      className="ficha-asoma flex items-center gap-4 rounded-[1.25rem] border border-dashed border-amber-500/50 bg-amber-400/10 p-4 sm:p-5"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/25 text-amber-800">
        <Coffee className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-tight text-amber-900">Tu descanso</p>
        <p className="mt-0.5 text-[0.9375rem] text-amber-900/75">
          {cortesAntes === 0
            ? 'Arranca cuando termines este corte'
            : `Después de ${cortesAntes} ${cortesAntes === 1 ? 'cliente' : 'clientes'} más`}
        </p>
      </div>
    </article>
  )
}
