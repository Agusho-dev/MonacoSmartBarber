'use client'

import { useState } from 'react'
import Image from 'next/image'
import {
  Check,
  TriangleAlert,
  Info,
  CopyCheck,
  UserRound,
  CalendarClock,
  CalendarOff,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  NOMBRES_DIAS,
  NOMBRES_DIAS_CORTOS,
  ORDEN_SEMANA,
  diasConTurnos,
  franjaValida,
  rangoCorto,
  resumenTramos,
  tramosDeTurnos,
  type AgendaTurnos,
  type BarberoConfig,
  type DiaDeAgenda,
  type JornadaSemanal,
  type Tramo,
} from './tipos'

interface Props {
  barberos: BarberoConfig[]
  /** Lo que se edita acá: quién toma TURNOS cada día (`appointment_staff_days`). */
  agenda: AgendaTurnos
  /** Jornada de trabajo (`staff_schedules`). Sólo contexto: no se escribe. */
  jornada: JornadaSemanal
  /** ¿La sucursal ya usa agenda por día? Con `false` sigue el modelo viejo. */
  usaAgendaPorDia: boolean
  /** `appointment_days`: días en que el turnero toma reservas. */
  diasHabilitados: number[]
  /** Horario del local: propuesta al acotar una franja sin jornada de referencia. */
  horarioLocal: Tramo
  /** Celdas con cambios sin guardar, como `staffId:dia`. */
  celdasSucias: Set<string>
  /** `null` = ese día no toma turnos. */
  onCambiarDia: (staffId: string, dia: number, valor: DiaDeAgenda | null) => void
  onCambiarBarbero: (staffId: string, cambio: { recibeTurnos?: boolean; soloTurnos?: boolean }) => void
}

export function SemanaBarberos({
  barberos,
  agenda,
  jornada,
  usaAgendaPorDia,
  diasHabilitados,
  horarioLocal,
  celdasSucias,
  onCambiarDia,
  onCambiarBarbero,
}: Props) {
  const barberosQueAtienden = barberos.filter(b => b.recibeTurnos)

  function jornadaDe(staffId: string, dia: number): Tramo[] {
    return jornada[staffId]?.[dia] ?? []
  }

  function alternarDia(staffId: string, dia: number) {
    // Un tap prende el día con la opción por defecto: toma turnos durante toda
    // su jornada (franja NULL). Acotar la franja es el caso raro y vive en el
    // popover.
    onCambiarDia(staffId, dia, agenda[staffId]?.[dia] ? null : { franja: null })
  }

  /**
   * Quién va a ofrecer el turnero ese día, tal como lo resuelve el motor: no
   * alcanza con tener el día marcado, tiene que haber una franja real (propia o
   * su jornada). Un día marcado sobre un día que no trabaja no ofrece nada.
   */
  function quienAtiende(dia: number): BarberoConfig[] {
    return barberosQueAtienden.filter(
      b => tramosDeTurnos({ agenda, jornada, staffId: b.id, dia, usaAgendaPorDia }).length > 0
    )
  }

  /** Días marcados que el motor va a ignorar: sin franja propia ni jornada. */
  const asignacionesSinHorario = barberosQueAtienden.flatMap(b =>
    ORDEN_SEMANA.filter(dia => {
      const entrada = agenda[b.id]?.[dia]
      return !!entrada && !entrada.franja && jornadaDe(b.id, dia).length === 0
    }).map(dia => ({ barbero: b, dia }))
  )

  if (!barberos.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quién toma turnos cada día</CardTitle>
          <CardDescription>Esta sucursal todavía no tiene barberos cargados.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            <UserRound className="size-5 shrink-0" />
            <p>
              Agregá barberos desde <span className="font-medium text-foreground">Equipo</span> y volvé acá
              para armar la semana.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card id="seccion-semana" className="overflow-hidden scroll-mt-24">
      <CardHeader>
        <CardTitle className="text-base">Quién toma turnos cada día</CardTitle>
        <CardDescription>
          Tocá un día para que ese barbero reciba turnos ese día. Es sólo la agenda: su horario de
          trabajo, el fichaje y la asistencia no se tocan.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Mientras no haya ninguna celda prendida, la sucursal sigue con el
            modelo viejo (todos los habilitados que trabajen ese día). Decirlo
            acá evita que el dueño crea que ya definió una agenda rotativa. */}
        {!usaAgendaPorDia ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>
              Todavía <span className="font-medium text-foreground">no definiste quién atiende cada día</span>:
              hoy el turnero le ofrece al cliente cualquier barbero habilitado, en el horario de trabajo que
              tenga cargado. Si tu agenda rota por día (uno los martes, otro los miércoles), marcá los días
              acá abajo.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>
              Los horarios en gris son la <span className="font-medium text-foreground">jornada de trabajo</span>{' '}
              del barbero: están de referencia, para que veas si el día que marcás es un día que trabaja.
              Marcar o desmarcar un día no la modifica.
            </p>
          </div>
        )}

        <div className="-mx-2 overflow-x-auto px-2 pb-1">
          <div className="min-w-[560px]">
            {/* Encabezado de días */}
            <div className="grid grid-cols-[minmax(8.5rem,1.3fr)_repeat(7,minmax(3.25rem,1fr))] gap-1.5">
              <div className="sticky left-0 z-10 bg-card" />
              {ORDEN_SEMANA.map(dia => {
                const habilitado = diasHabilitados.includes(dia)
                const atienden = quienAtiende(dia)
                return (
                  <div key={dia} className="pb-1 text-center">
                    <p
                      className={cn(
                        'text-xs font-semibold uppercase tracking-wide',
                        habilitado ? 'text-foreground' : 'text-muted-foreground/50'
                      )}
                    >
                      {NOMBRES_DIAS_CORTOS[dia]}
                    </p>
                    <p
                      className={cn(
                        'text-[10px] tabular-nums',
                        !habilitado
                          ? 'text-muted-foreground/40'
                          : atienden.length
                            ? 'text-muted-foreground'
                            : 'text-amber-500'
                      )}
                    >
                      {!habilitado ? 'cerrado' : atienden.length ? `${atienden.length}` : 'nadie'}
                    </p>
                  </div>
                )
              })}
            </div>

            {/* Filas: un barbero por fila */}
            <div className="space-y-1.5">
              {barberos.map(barbero => (
                <div
                  key={barbero.id}
                  className="grid grid-cols-[minmax(8.5rem,1.3fr)_repeat(7,minmax(3.25rem,1fr))] items-stretch gap-1.5"
                >
                  <FilaBarbero
                    barbero={barbero}
                    diasDeTurnos={diasConTurnos(agenda, barbero.id).length}
                    onCambiar={onCambiarBarbero}
                  />

                  {ORDEN_SEMANA.map(dia => (
                    <CeldaDia
                      key={dia}
                      barbero={barbero}
                      dia={dia}
                      entrada={agenda[barbero.id]?.[dia]}
                      jornadaDelDia={jornadaDe(barbero.id, dia)}
                      diaHabilitado={diasHabilitados.includes(dia)}
                      sucia={celdasSucias.has(`${barbero.id}:${dia}`)}
                      horarioLocal={horarioLocal}
                      hayOtrosDias={diasConTurnos(agenda, barbero.id).some(d => d !== dia)}
                      onAlternar={() => alternarDia(barbero.id, dia)}
                      onGuardar={valor => onCambiarDia(barbero.id, dia, valor)}
                      onAplicarASemana={franja => {
                        // Sólo pisa los días que ya toman turnos: "usar en sus
                        // otros días" nunca debe agregar días que el dueño no
                        // pidió.
                        for (const otro of diasConTurnos(agenda, barbero.id)) {
                          if (otro === dia) continue
                          onCambiarDia(barbero.id, otro, { franja: franja ? { ...franja } : null })
                        }
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Pie: quién atiende turnos cada día, en nombres */}
            <div className="mt-3 grid grid-cols-[minmax(8.5rem,1.3fr)_repeat(7,minmax(3.25rem,1fr))] gap-1.5 border-t border-border pt-3">
              <p className="sticky left-0 z-10 bg-card pr-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Atienden turnos
              </p>
              {ORDEN_SEMANA.map(dia => {
                const habilitado = diasHabilitados.includes(dia)
                const atienden = quienAtiende(dia)
                return (
                  <div key={dia} className="min-w-0 text-center">
                    {!habilitado ? (
                      <p className="text-[10px] leading-tight text-muted-foreground/40">—</p>
                    ) : atienden.length ? (
                      <div className="space-y-0.5">
                        {atienden.map(b => (
                          <p key={b.id} className="truncate text-[10px] leading-tight text-foreground" title={b.nombre}>
                            {primerNombre(b.nombre)}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] font-medium leading-tight text-amber-500">Sin turnos</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <ResumenSemana
          barberosQueAtienden={barberosQueAtienden}
          diasHabilitados={diasHabilitados}
          quienAtiende={quienAtiende}
          asignacionesSinHorario={asignacionesSinHorario}
        />
      </CardContent>
    </Card>
  )
}

// ─── Fila: identidad del barbero + si recibe turnos ──────────────────

function FilaBarbero({
  barbero,
  diasDeTurnos,
  onCambiar,
}: {
  barbero: BarberoConfig
  diasDeTurnos: number
  onCambiar: (staffId: string, cambio: { recibeTurnos?: boolean; soloTurnos?: boolean }) => void
}) {
  return (
    <div
      className={cn(
        'sticky left-0 z-10 flex min-w-0 items-center gap-2 rounded-lg bg-card py-1 pr-2',
        !barbero.recibeTurnos && 'opacity-60'
      )}
    >
      {barbero.avatarUrl ? (
        <Image
          src={barbero.avatarUrl}
          alt=""
          width={32}
          height={32}
          className="size-8 shrink-0 rounded-full object-cover"
          unoptimized
        />
      ) : (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
          {iniciales(barbero.nombre)}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight" title={barbero.nombre}>
          {barbero.nombre}
        </p>
        {/* `block w-full` no es decorativo: un <button> es inline-block y se
            dimensiona con su texto, así que `truncate` (overflow-hidden +
            ellipsis) no recorta nada — el subtítulo crecía más que su columna y
            se montaba encima del Switch de la derecha. */}
        <button
          type="button"
          onClick={() => onCambiar(barbero.id, { soloTurnos: !barbero.soloTurnos })}
          disabled={!barbero.recibeTurnos}
          className={cn(
            'block w-full max-w-full truncate text-left text-[10px] leading-tight transition-colors',
            barbero.recibeTurnos
              ? 'text-muted-foreground hover:text-foreground'
              : 'cursor-default text-muted-foreground/70'
          )}
          title={
            barbero.recibeTurnos
              ? 'Tocá para cambiar si además atiende gente sin turno'
              : 'Este barbero no recibe turnos'
          }
        >
          {barbero.recibeTurnos
            ? `${barbero.soloTurnos ? 'Sólo turnos' : 'Turnos y walk-in'} · ${diasDeTurnos} ${diasDeTurnos === 1 ? 'día' : 'días'}`
            : 'No recibe turnos'}
        </button>
      </div>

      {/* Sin className que toque el ancho o el alto: el thumb se desplaza con
          `translate-x-[calc(100%-2px)]`, atado a las medidas del primitivo, y
          cualquier ancho o alto propio lo deja a mitad de camino. El `shrink-0`
          que estaba acá ya lo trae el Switch de base. */}
      <Switch
        checked={barbero.recibeTurnos}
        onCheckedChange={valor => onCambiar(barbero.id, { recibeTurnos: valor })}
        aria-label={`${barbero.nombre} recibe turnos`}
      />
    </div>
  )
}

// ─── Celda: un día de un barbero ─────────────────────────────────────

function CeldaDia({
  barbero,
  dia,
  entrada,
  jornadaDelDia,
  diaHabilitado,
  sucia,
  horarioLocal,
  hayOtrosDias,
  onAlternar,
  onGuardar,
  onAplicarASemana,
}: {
  barbero: BarberoConfig
  dia: number
  entrada: DiaDeAgenda | undefined
  jornadaDelDia: Tramo[]
  diaHabilitado: boolean
  sucia: boolean
  horarioLocal: Tramo
  hayOtrosDias: boolean
  onAlternar: () => void
  onGuardar: (valor: DiaDeAgenda | null) => void
  onAplicarASemana: (franja: Tramo | null) => void
}) {
  const tomaTurnos = !!entrada
  const trabaja = jornadaDelDia.length > 0
  // Día marcado, sin franja propia y sin jornada: el motor lo saltea en
  // silencio. Es el único caso que hay que gritar en la grilla.
  const sinEfecto = tomaTurnos && !entrada?.franja && !trabaja
  const activo = tomaTurnos && barbero.recibeTurnos && diaHabilitado && !sinEfecto

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onAlternar}
        aria-pressed={tomaTurnos}
        aria-label={`${barbero.nombre}, ${NOMBRES_DIAS[dia]}${tomaTurnos ? ': toma turnos' : ': no toma turnos'}${trabaja ? `, trabaja ${resumenTramos(jornadaDelDia)}` : ', no trabaja ese día'}`}
        title={
          tomaTurnos
            ? trabaja
              ? `Trabaja ${resumenTramos(jornadaDelDia)}`
              : 'Ese día no trabaja'
            : trabaja
              ? `Trabaja ${resumenTramos(jornadaDelDia)} · no toma turnos`
              : 'Ese día no trabaja'
        }
        className={cn(
          'flex h-16 w-full flex-col items-center justify-center gap-1 rounded-lg border transition-all',
          // El tramo inferior de la celda lo ocupa el chip con la franja.
          tomaTurnos && 'pb-6',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          tomaTurnos
            ? sinEfecto
              ? 'border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15'
              : activo
                ? 'border-primary/40 bg-primary/15 hover:bg-primary/25'
                : 'border-border bg-muted/60 hover:bg-muted'
            : 'border-dashed border-border/70 bg-transparent hover:border-border hover:bg-muted/40'
        )}
      >
        {tomaTurnos ? (
          <span
            className={cn(
              'flex size-5 items-center justify-center rounded-full',
              sinEfecto
                ? 'bg-amber-500 text-background'
                : activo
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted-foreground/30 text-foreground'
            )}
          >
            {sinEfecto ? (
              <TriangleAlert className="size-3" strokeWidth={2.5} />
            ) : (
              <Check className="size-3.5" strokeWidth={3} />
            )}
          </span>
        ) : trabaja ? (
          // Jornada de contexto: se ve que ese día trabaja, aunque no tome
          // turnos. Es la referencia para decidir dónde poner la agenda.
          <span className="px-0.5 text-[10px] leading-tight tabular-nums text-muted-foreground/50">
            {rangoCorto(jornadaDelDia[0])}
          </span>
        ) : (
          <span className="block h-1 w-4 rounded-full bg-border" />
        )}
      </button>

      {/* Marca de cambio sin guardar: la celda es la unidad que se escribe. */}
      {sucia && <span className="pointer-events-none absolute right-1.5 top-1.5 size-1.5 rounded-full bg-amber-500" />}

      {tomaTurnos && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              // `inset-x-px bottom-px` en vez de pegarse al borde: si no, el chip
              // tapa el borde redondeado de la celda y una celda activa parecía
              // no tener borde abajo. `overflow-hidden` + el span que trunca son
              // obligatorios: "10:30–19:30" no entra en una columna de 3.25rem y
              // se derramaba sobre la celda de al lado.
              className={cn(
                'absolute inset-x-px bottom-px flex h-6 items-center justify-center gap-0.5 overflow-hidden rounded-b-[7px] border-t border-border/40 bg-background/40 px-1 text-[10px] font-medium tabular-nums transition-colors hover:bg-background/80 hover:text-foreground',
                sinEfecto ? 'text-amber-500' : entrada?.franja ? 'text-foreground' : 'text-muted-foreground'
              )}
              aria-label={`Editar la franja de turnos de ${barbero.nombre} el ${NOMBRES_DIAS[dia]}`}
            >
              <span className="min-w-0 truncate">
                {entrada?.franja
                  ? rangoCorto(entrada.franja)
                  : trabaja
                    ? rangoCorto(jornadaDelDia[0])
                    : 'sin horario'}
              </span>
              {!entrada?.franja && trabaja && jornadaDelDia.length > 1 && (
                <span className="shrink-0 text-[9px]">+{jornadaDelDia.length - 1}</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-72 p-0">
            <EditorDeDia
              nombre={barbero.nombre}
              dia={dia}
              entrada={entrada!}
              jornadaDelDia={jornadaDelDia}
              horarioLocal={horarioLocal}
              hayOtrosDias={hayOtrosDias}
              onGuardar={onGuardar}
              onAplicarASemana={onAplicarASemana}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

// ─── Editor de la franja de turnos de un día ─────────────────────────

function EditorDeDia({
  nombre,
  dia,
  entrada,
  jornadaDelDia,
  horarioLocal,
  hayOtrosDias,
  onGuardar,
  onAplicarASemana,
}: {
  nombre: string
  dia: number
  entrada: DiaDeAgenda
  jornadaDelDia: Tramo[]
  horarioLocal: Tramo
  hayOtrosDias: boolean
  onGuardar: (valor: DiaDeAgenda | null) => void
  onAplicarASemana: (franja: Tramo | null) => void
}) {
  const [borrador, setBorrador] = useState<Tramo | null>(entrada.franja ? { ...entrada.franja } : null)
  const trabaja = jornadaDelDia.length > 0
  const valido = !borrador || franjaValida(borrador)

  /**
   * Cada edición sube al padre apenas es válida (no en el blur): un `type=time`
   * puede quedar a medio escribir y el popover se cierra al tocar afuera, sin
   * garantía de blur previo. Lo inválido queda sólo en el borrador.
   */
  function aplicar(franja: Tramo | null) {
    setBorrador(franja)
    if (!franja || franjaValida(franja)) onGuardar({ franja })
  }

  return (
    <div className="space-y-3 p-3">
      <div>
        <p className="text-sm font-semibold leading-tight">{NOMBRES_DIAS[dia]}</p>
        <p className="text-xs text-muted-foreground">{nombre}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">¿En qué horario acepta turnos?</p>

        <OpcionFranja
          activa={borrador === null}
          titulo="Toda su jornada"
          detalle={trabaja ? `Trabaja ${resumenTramos(jornadaDelDia)}` : 'Ese día no trabaja'}
          alerta={!trabaja}
          onClick={() => aplicar(null)}
        />

        <OpcionFranja
          activa={borrador !== null}
          titulo="Sólo una franja"
          detalle="Acepta turnos nada más que en ese rango"
          onClick={() => aplicar(borrador ?? { ...(jornadaDelDia[0] ?? horarioLocal) })}
        />
      </div>

      {borrador !== null && (
        <div className="flex items-center gap-1.5">
          <input
            type="time"
            value={borrador.inicio}
            onChange={e => aplicar({ ...borrador, inicio: e.target.value })}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Desde"
          />
          <span className="text-xs text-muted-foreground">a</span>
          <input
            type="time"
            value={borrador.fin}
            onChange={e => aplicar({ ...borrador, fin: e.target.value })}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Hasta"
          />
        </div>
      )}

      {!valido && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-500">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          La hora de fin tiene que ser posterior a la de inicio.
        </p>
      )}

      {/* No lo impedimos: acotar la franja es exactamente la forma de dar turnos
          un día que el barbero no tiene como jornada. Pero con "toda su jornada"
          el motor no encuentra ninguna franja y no ofrece nada. */}
      {borrador === null && !trabaja && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] leading-snug text-amber-500">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span>
            Ese día no tiene horario de trabajo cargado, así que el turnero no va a ofrecer nada. Elegí
            &ldquo;Sólo una franja&rdquo; o cargale la jornada desde Equipo.
          </span>
        </p>
      )}

      {hayOtrosDias && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-full text-xs"
          disabled={!valido}
          onClick={() => onAplicarASemana(borrador)}
        >
          <CopyCheck className="mr-1 size-3.5" />
          Usar esto en sus otros días de turnos
        </Button>
      )}

      <button
        type="button"
        onClick={() => onGuardar(null)}
        className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-muted-foreground transition-colors hover:text-destructive"
      >
        <CalendarOff className="size-3.5" />
        Este día no toma turnos
      </button>
    </div>
  )
}

function OpcionFranja({
  activa,
  titulo,
  detalle,
  alerta,
  onClick,
}: {
  activa: boolean
  titulo: string
  detalle: string
  alerta?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={cn(
        'flex w-full items-start gap-2 rounded-lg border p-2 text-left transition-colors',
        activa ? 'border-primary bg-primary/10' : 'border-border hover:border-foreground/30 hover:bg-muted/40'
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
          activa ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
        )}
      >
        {activa && <Check className="size-2.5" strokeWidth={4} />}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium leading-tight">{titulo}</span>
        <span
          className={cn(
            'block text-[11px] leading-snug',
            alerta ? 'text-amber-500' : 'text-muted-foreground'
          )}
        >
          {detalle}
        </span>
      </span>
    </button>
  )
}

// ─── Resumen en palabras ─────────────────────────────────────────────

function ResumenSemana({
  barberosQueAtienden,
  diasHabilitados,
  quienAtiende,
  asignacionesSinHorario,
}: {
  barberosQueAtienden: BarberoConfig[]
  diasHabilitados: number[]
  quienAtiende: (dia: number) => BarberoConfig[]
  asignacionesSinHorario: Array<{ barbero: BarberoConfig; dia: number }>
}) {
  if (!barberosQueAtienden.length) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <p className="text-muted-foreground">
          Ningún barbero está marcado para recibir turnos, así que el turnero no va a ofrecer nada.
          Prendé el interruptor de la derecha de cada barbero que atienda con agenda.
        </p>
      </div>
    )
  }

  const diasSinNadie = ORDEN_SEMANA.filter(d => diasHabilitados.includes(d) && quienAtiende(d).length === 0)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {ORDEN_SEMANA.filter(d => diasHabilitados.includes(d)).map(dia => {
          const atienden = quienAtiende(dia)
          return (
            <span
              key={dia}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
                atienden.length
                  ? 'border-border bg-muted/40 text-foreground'
                  : 'border-amber-500/30 bg-amber-500/5 text-amber-500'
              )}
            >
              <span className="font-semibold">{NOMBRES_DIAS[dia]}:</span>
              <span className={cn(!atienden.length && 'font-medium')}>
                {atienden.length ? atienden.map(b => primerNombre(b.nombre)).join(', ') : 'nadie'}
              </span>
            </span>
          )
        })}
      </div>

      {diasSinNadie.length > 0 && (
        <p className="text-[11px] text-amber-500">
          {diasSinNadie.length === 1
            ? `Los ${NOMBRES_DIAS[diasSinNadie[0]].toLowerCase()} el turnero no va a mostrar ningún horario.`
            : `Hay ${diasSinNadie.length} días abiertos a reservas en los que el turnero no va a mostrar ningún horario.`}
        </p>
      )}

      {asignacionesSinHorario.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] leading-snug">
          <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
          <p className="text-muted-foreground">
            <span className="font-medium text-amber-500">
              {asignacionesSinHorario
                .map(a => `${primerNombre(a.barbero.nombre)} el ${NOMBRES_DIAS[a.dia].toLowerCase()}`)
                .join(', ')}
            </span>{' '}
            {asignacionesSinHorario.length === 1 ? 'toma turnos un día que no trabaja' : 'toman turnos días que no trabajan'}
            . Tocá el horario de la celda y elegí una franja, o el turnero no va a mostrar nada esos días.
          </p>
        </div>
      )}
    </div>
  )
}

function primerNombre(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] || nombre
}

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).slice(0, 2)
  return partes.map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}
