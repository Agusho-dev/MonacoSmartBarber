'use client'

import { useMemo, useRef, useState } from 'react'
import {
  CalendarOff,
  ChevronDown,
  CopyCheck,
  Eraser,
  Info,
  MoreHorizontal,
  MousePointerClick,
  Plus,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  NOMBRES_DIAS,
  NOMBRES_DIAS_CORTOS,
  ORDEN_SEMANA,
  aHora,
  aMinutos,
  describirDias,
  duracionFranjas,
  normalizarFranjasDia,
  resumenFranjas,
  type Franja,
  type FranjasSemana,
  type Tramo,
} from './tipos'

/**
 * Editor visual de las franjas en que la sucursal acepta turnos (mig 172).
 *
 * Reemplaza al par único apertura/cierre + días habilitados, que sólo podía
 * decir "de 9 a 21, lunes a sábado". Lo que hace falta es lo contrario: el
 * walk-in llena las horas pico, así que los turnos se empujan a las horas flojas
 * — distinto según el día y con el día cortado al medio ("martes 10–13 y 16–19").
 *
 * Se pinta arrastrando, como una planilla. Guarda con
 * `saveBranchAppointmentHours`; el motor (`getAvailableSlots`) exige que el turno
 * entre ENTERO en una franja.
 */

/** Alto de la grilla: media hora por fila. Es el corte con el que trabaja el rubro. */
const PASO_GRILLA = 30

/** Lunes a sábado: a lo que apuntan los atajos. El domingo se toca por día. */
const DIAS_LABORALES = [1, 2, 3, 4, 5, 6]

interface Rejilla {
  /** Primer minuto dibujado (múltiplo de `PASO_GRILLA`). */
  inicio: number
  fin: number
  filas: number
}

interface Props {
  /** Franjas en edición (0=domingo … 6=sábado). */
  franjas: FranjasSemana
  /**
   * Actualizador funcional: al arrastrar se aplican varias celdas antes de que
   * React vuelva a renderizar, así que leer `franjas` de la closure perdería
   * cambios a mitad del trazo.
   */
  onCambiar: (actualizar: (previas: FranjasSemana) => FranjasSemana) => void
  /** Horario comercial de la sucursal: acota la grilla a lo que existe. */
  horarioComercial: Tramo
  /** Rango del modelo viejo (`appointment_hours_open/close`). */
  horarioViejo: Tramo
  /** Días del modelo viejo (`appointment_days`). */
  diasViejos: number[]
  /** ¿La sucursal ya tenía franjas guardadas antes de esta edición? */
  usaFranjasGuardadas: boolean
  /** Error del último guardado (ej: solape rechazado por el servidor). */
  error?: string | null
}

export function HorariosTurnero({
  franjas,
  onCambiar,
  horarioComercial,
  horarioViejo,
  diasViejos,
  usaFranjasGuardadas,
  error,
}: Props) {
  const [diaAbierto, setDiaAbierto] = useState<number | null>(null)
  const [pintando, setPintando] = useState(false)
  const trazo = useRef<'prender' | 'apagar' | null>(null)
  /**
   * Cuándo terminó la última pincelada. El `click` que el navegador dispara
   * después de un tap ya fue resuelto por el pointerdown: volver a alternar la
   * celda la dejaría como estaba. `event.detail === 0` sólo distingue el teclado
   * en algunos navegadores, así que se usa además esta ventana de tiempo.
   */
  const ultimaPincelada = useRef(0)

  const rejilla = useMemo(() => calcularRejilla(horarioComercial, franjas), [horarioComercial, franjas])

  const slotsPorDia = useMemo(() => {
    const mapa = new Map<number, Set<number>>()
    for (const dia of ORDEN_SEMANA) mapa.set(dia, slotsDeFranjas(franjas[dia] ?? [], rejilla))
    return mapa
  }, [franjas, rejilla])

  const diasConFranja = ORDEN_SEMANA.filter(dia => (franjas[dia] ?? []).length > 0)
  const hayFranjas = diasConFranja.length > 0

  // ─── Mutadores ─────────────────────────────────────────────────────

  function escribirDia(dia: number, nuevas: Franja[]) {
    onCambiar(previas => ({ ...previas, [dia]: normalizarFranjasDia(nuevas) }))
  }

  function pintarCelda(dia: number, fila: number, modo: 'prender' | 'apagar') {
    onCambiar(previas => {
      const actuales = slotsDeFranjas(previas[dia] ?? [], rejilla)
      // Devolver el mismo objeto hace que React descarte el update: sin esto,
      // arrastrar por una celda ya pintada re-renderizaría en cada movimiento.
      if (modo === 'prender' ? actuales.has(fila) : !actuales.has(fila)) return previas
      const siguientes = new Set(actuales)
      if (modo === 'prender') siguientes.add(fila)
      else siguientes.delete(fila)
      return { ...previas, [dia]: franjasDeSlots(siguientes, rejilla) }
    })
  }

  function alternarCelda(dia: number, fila: number) {
    const encendida = slotsPorDia.get(dia)?.has(fila) ?? false
    pintarCelda(dia, fila, encendida ? 'apagar' : 'prender')
  }

  function copiarDia(origen: number, destinos: number[]) {
    onCambiar(previas => {
      const copia = { ...previas }
      const delOrigen = normalizarFranjasDia(previas[origen] ?? [])
      for (const dia of destinos) {
        if (dia === origen) continue
        copia[dia] = delOrigen.map(f => ({ ...f }))
      }
      return copia
    })
  }

  function sumarPreset(inicio: string, fin: string) {
    const desde = Math.max(aMinutos(inicio), aMinutos(horarioComercial.inicio))
    const hasta = Math.min(aMinutos(fin), aMinutos(horarioComercial.fin))
    if (hasta <= desde) return
    const franja: Franja = { start_time: aHora(desde), end_time: aHora(hasta) }
    onCambiar(previas => {
      const copia = { ...previas }
      for (const dia of DIAS_LABORALES) {
        copia[dia] = normalizarFranjasDia([...(previas[dia] ?? []), { ...franja }])
      }
      return copia
    })
  }

  function limpiarTodo() {
    onCambiar(() => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }))
  }

  /** Precarga la semana con el rango viejo, para recortar en vez de arrancar de cero. */
  function empezarConElHorarioActual() {
    const desde = horarioViejo.inicio || '09:00'
    const hasta = horarioViejo.fin || '21:00'
    if (aMinutos(hasta) <= aMinutos(desde)) return
    const dias = diasViejos.length ? diasViejos : DIAS_LABORALES
    onCambiar(() => {
      const copia: FranjasSemana = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
      for (const dia of dias) copia[dia] = [{ start_time: desde, end_time: hasta }]
      return copia
    })
  }

  // ─── Pintado con puntero (mouse + touch) ───────────────────────────

  function celdaEn(x: number, y: number): { dia: number; fila: number } | null {
    const elemento = document.elementFromPoint(x, y)
    const celda = elemento instanceof Element ? elemento.closest<HTMLElement>('[data-celda]') : null
    if (!celda) return null
    const dia = Number(celda.dataset.dia)
    const fila = Number(celda.dataset.fila)
    if (!Number.isInteger(dia) || !Number.isInteger(fila)) return null
    return { dia, fila }
  }

  function alBajarPuntero(e: React.PointerEvent<HTMLDivElement>) {
    // Sólo el botón principal y el primer dedo: con el secundario se abre el
    // menú contextual y con dos dedos se está haciendo zoom, no pintando.
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (!e.isPrimary) return
    const celda = celdaEn(e.clientX, e.clientY)
    if (!celda) return
    const encendida = slotsPorDia.get(celda.dia)?.has(celda.fila) ?? false
    const modo: 'prender' | 'apagar' = encendida ? 'apagar' : 'prender'
    trazo.current = modo
    ultimaPincelada.current = Date.now()
    setPintando(true)
    // Capturar el puntero en el contenedor: en touch los eventos siguen yendo al
    // elemento donde arrancó el gesto, así que `onPointerEnter` de cada celda no
    // se dispara. Con captura + elementFromPoint el arrastre funciona igual con
    // dedo que con mouse.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* Navegadores viejos: se sigue pudiendo tocar celda por celda. */
    }
    pintarCelda(celda.dia, celda.fila, modo)
  }

  function alMoverPuntero(e: React.PointerEvent<HTMLDivElement>) {
    if (!trazo.current) return
    const celda = celdaEn(e.clientX, e.clientY)
    if (!celda) return
    ultimaPincelada.current = Date.now()
    pintarCelda(celda.dia, celda.fila, trazo.current)
  }

  function alSoltarPuntero(e: React.PointerEvent<HTMLDivElement>) {
    if (!trazo.current) return
    trazo.current = null
    ultimaPincelada.current = Date.now()
    setPintando(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* Ya liberado. */
    }
  }

  // ─── Render ────────────────────────────────────────────────────────

  const filas = Array.from({ length: rejilla.filas }, (_, i) => i)

  return (
    <div className="space-y-3">
      {/* Estado vacío: la sucursal sigue con el rango único */}
      {!hayFranjas && (
        <div className="space-y-2.5 rounded-lg border border-dashed border-border bg-muted/30 p-3">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>
              Hoy tomás turnos de{' '}
              <span className="font-medium text-foreground">
                {horarioViejo.inicio || '09:00'} a {horarioViejo.fin || '21:00'}
              </span>
              , {describirDias(diasViejos.length ? diasViejos : DIAS_LABORALES)}. Definí franjas para dar
              turnos sólo en las horas que quieras: podés cortar el día al medio y usar horarios distintos
              según el día.
            </span>
          </p>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={empezarConElHorarioActual}>
            <CopyCheck className="mr-1.5 size-3.5" />
            Empezar con el horario actual
          </Button>
        </div>
      )}

      {/* Al guardar la primera franja cambia el modelo entero de la sucursal */}
      {hayFranjas && !usaFranjasGuardadas && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-500">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Al guardar, el turnero va a ofrecer <span className="font-semibold">únicamente</span> estas
            franjas: los días que queden en blanco dejan de mostrar horarios, aunque el barbero trabaje.
          </span>
        </p>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {/* Atajos */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Atajos · se suman a lunes–sábado
        </p>
        <div className="flex flex-wrap gap-1.5">
          <BotonAtajo etiqueta="Mañana" detalle="09:00 a 13:00" onClick={() => sumarPreset('09:00', '13:00')} />
          <BotonAtajo etiqueta="Tarde" detalle="16:00 a 20:00" onClick={() => sumarPreset('16:00', '20:00')} />
          <BotonAtajo
            etiqueta="Horas flojas"
            detalle="10:00 a 17:00"
            onClick={() => sumarPreset('10:00', '17:00')}
          />
          <BotonAtajo
            etiqueta="Todo el día"
            detalle={`${horarioComercial.inicio} a ${horarioComercial.fin}`}
            onClick={() => sumarPreset(horarioComercial.inicio, horarioComercial.fin)}
          />
          {hayFranjas && (
            <button
              type="button"
              onClick={limpiarTodo}
              className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
            >
              <Eraser className="mr-1.5 inline size-3.5 align-[-2px]" />
              Limpiar todo
            </button>
          )}
        </div>
      </div>

      {/* ─── Grilla de pintar (sm en adelante) ─────────────────────── */}
      <div className="hidden sm:block">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <MousePointerClick className="size-3.5 shrink-0" />
          Arrastrá para pintar las horas en que tomás turnos. Empezá sobre una hora pintada para borrarla.
        </p>

        {/* Encabezado de días */}
        <div className="flex gap-1">
          <div className="w-12 shrink-0" />
          <div className="grid flex-1 grid-cols-7 gap-x-1">
            {ORDEN_SEMANA.map(dia => {
              const delDia = franjas[dia] ?? []
              const minutos = duracionFranjas(delDia)
              return (
                <div key={dia} className="flex min-w-0 items-center justify-center gap-0.5 pb-1">
                  <div className="min-w-0 text-center">
                    <p
                      className={cn(
                        'text-xs font-semibold uppercase tracking-wide',
                        delDia.length ? 'text-foreground' : 'text-muted-foreground/60'
                      )}
                    >
                      {NOMBRES_DIAS_CORTOS[dia]}
                    </p>
                    <p
                      className={cn(
                        'truncate text-[10px] leading-tight tabular-nums',
                        delDia.length ? 'text-muted-foreground' : 'text-muted-foreground/50'
                      )}
                    >
                      {formatearHoras(minutos)}
                    </p>
                  </div>
                  <MenuDia
                    dia={dia}
                    franjas={franjas[dia] ?? []}
                    horarioComercial={horarioComercial}
                    onEscribir={nuevas => escribirDia(dia, nuevas)}
                    onCopiar={destinos => copiarDia(dia, destinos)}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* Celdas */}
        <div className="flex gap-1 pt-2">
          {/* Columna de horas */}
          <div className="w-12 shrink-0 select-none">
            {filas.map(fila => {
              const minuto = rejilla.inicio + fila * PASO_GRILLA
              const enPunto = minuto % 60 === 0
              return (
                <div key={fila} className="relative h-[18px]">
                  {enPunto && (
                    <span className="absolute right-2 top-0 -translate-y-1/2 text-[10px] leading-none tabular-nums text-muted-foreground">
                      {aHora(minuto)}
                    </span>
                  )}
                </div>
              )
            })}
            <div className="relative h-0">
              <span className="absolute right-2 top-0 -translate-y-1/2 text-[10px] leading-none tabular-nums text-muted-foreground">
                {aHora(rejilla.fin)}
              </span>
            </div>
          </div>

          {/* Lienzo */}
          <div
            className={cn(
              'grid flex-1 select-none grid-cols-7 gap-x-1 overflow-hidden rounded-lg border border-border transition-shadow',
              pintando && 'ring-2 ring-primary/40'
            )}
            onPointerDown={alBajarPuntero}
            onPointerMove={alMoverPuntero}
            onPointerUp={alSoltarPuntero}
            onPointerCancel={alSoltarPuntero}
            onLostPointerCapture={alSoltarPuntero}
          >
            {filas.flatMap(fila =>
              ORDEN_SEMANA.map(dia => {
                const encendidas = slotsPorDia.get(dia)
                const activa = encendidas?.has(fila) ?? false
                const primera = activa && !encendidas?.has(fila - 1)
                const ultima = activa && !encendidas?.has(fila + 1)
                const minuto = rejilla.inicio + fila * PASO_GRILLA
                const enPunto = minuto % 60 === 0
                return (
                  <button
                    key={`${dia}-${fila}`}
                    type="button"
                    data-celda="1"
                    data-dia={dia}
                    data-fila={fila}
                    aria-pressed={activa}
                    aria-label={`${NOMBRES_DIAS[dia]} ${aHora(minuto)}`}
                    // El click sólo actúa cuando viene del teclado: con mouse o
                    // dedo ya lo resolvió el pintado del pointerdown, y hacer las
                    // dos cosas dejaría la celda como estaba.
                    onClick={e => {
                      if (e.detail !== 0) return
                      if (Date.now() - ultimaPincelada.current < 600) return
                      alternarCelda(dia, fila)
                    }}
                    // `touch-action: none` va fijo en la celda, no "mientras se
                    // pinta": el navegador decide si el gesto scrollea en el
                    // momento del pointerdown, así que ponerlo después no sirve.
                    // Sólo anula el scroll que arranca ENCIMA de una celda.
                    className={cn(
                      'h-[18px] w-full cursor-crosshair touch-none border-t transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      fila === 0 ? 'border-transparent' : enPunto ? 'border-border' : 'border-border/25',
                      activa
                        ? 'bg-primary/30 hover:bg-primary/40'
                        : 'bg-muted/25 hover:bg-muted/70',
                      primera && 'rounded-t-md',
                      ultima && 'rounded-b-md'
                    )}
                  />
                )
              })
            )}
          </div>
        </div>

        {/* Chips por columna */}
        <div className="flex gap-1 pt-2">
          <div className="w-12 shrink-0" />
          <div className="grid flex-1 grid-cols-7 items-start gap-x-1">
            {ORDEN_SEMANA.map(dia => {
              const delDia = franjas[dia] ?? []
              return (
                <div key={dia} className="min-w-0 space-y-1">
                  {delDia.map(f => (
                    <ChipFranja
                      key={`${f.start_time}-${f.end_time}`}
                      franja={f}
                      dia={dia}
                      onBorrar={() =>
                        escribirDia(
                          dia,
                          delDia.filter(o => !(o.start_time === f.start_time && o.end_time === f.end_time))
                        )
                      }
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ─── Acordeón por día (mobile) ─────────────────────────────── */}
      <div className="space-y-1.5 sm:hidden">
        {ORDEN_SEMANA.map(dia => {
          const delDia = franjas[dia] ?? []
          const abierto = diaAbierto === dia
          return (
            <div key={dia} className="overflow-hidden rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setDiaAbierto(abierto ? null : dia)}
                aria-expanded={abierto}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-tight">{NOMBRES_DIAS[dia]}</span>
                  <span
                    className={cn(
                      'mt-0.5 block truncate text-[11px] leading-tight tabular-nums',
                      delDia.length ? 'text-muted-foreground' : 'text-muted-foreground/60'
                    )}
                  >
                    {delDia.length ? resumenFranjas(delDia) : 'No se toman turnos'}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    'size-4 shrink-0 text-muted-foreground transition-transform',
                    abierto && 'rotate-180'
                  )}
                />
              </button>

              {abierto && (
                <div className="space-y-3 border-t border-border p-3">
                  {delDia.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {delDia.map(f => (
                        <ChipFranja
                          key={`${f.start_time}-${f.end_time}`}
                          franja={f}
                          dia={dia}
                          ancho="auto"
                          onBorrar={() =>
                            escribirDia(
                              dia,
                              delDia.filter(o => !(o.start_time === f.start_time && o.end_time === f.end_time))
                            )
                          }
                        />
                      ))}
                    </div>
                  )}

                  <AgregarFranja
                    horarioComercial={horarioComercial}
                    onAgregar={nueva => escribirDia(dia, [...delDia, nueva])}
                  />

                  <AccionesDia
                    dia={dia}
                    tieneFranjas={delDia.length > 0}
                    onCopiar={destinos => copiarDia(dia, destinos)}
                    onLimpiar={() => escribirDia(dia, [])}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Piezas ──────────────────────────────────────────────────────────

function BotonAtajo({
  etiqueta,
  detalle,
  onClick,
}: {
  etiqueta: string
  detalle: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Sumar ${detalle} de lunes a sábado`}
      className="h-9 rounded-lg border border-border px-3 text-left text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      {etiqueta}
      <span className="ml-1.5 tabular-nums text-muted-foreground/70">{detalle}</span>
    </button>
  )
}

function ChipFranja({
  franja,
  dia,
  ancho = 'columna',
  onBorrar,
}: {
  franja: Franja
  dia: number
  ancho?: 'columna' | 'auto'
  onBorrar: () => void
}) {
  const texto = `${franja.start_time}–${franja.end_time}`
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-primary/30 bg-primary/10 py-0.5 pl-1.5 pr-0.5 text-[10px] font-medium tabular-nums text-foreground',
        ancho === 'columna' ? 'flex w-full justify-between' : 'text-[11px]'
      )}
      title={`${NOMBRES_DIAS[dia]} de ${franja.start_time} a ${franja.end_time}`}
    >
      <span className="truncate">{texto}</span>
      <button
        type="button"
        onClick={onBorrar}
        aria-label={`Borrar la franja de ${franja.start_time} a ${franja.end_time} del ${NOMBRES_DIAS[dia].toLowerCase()}`}
        className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

/**
 * Menú por día del encabezado de la grilla. Repite lo mismo que ofrece el
 * acordeón mobile, para quien prefiere tipear las horas antes que pintarlas.
 */
function MenuDia({
  dia,
  franjas,
  horarioComercial,
  onEscribir,
  onCopiar,
}: {
  dia: number
  franjas: Franja[]
  horarioComercial: Tramo
  onEscribir: (franjas: Franja[]) => void
  onCopiar: (destinos: number[]) => void
}) {
  const [abierto, setAbierto] = useState(false)

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Opciones del ${NOMBRES_DIAS[dia].toLowerCase()}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-64 space-y-3 p-3">
        <p className="text-sm font-semibold leading-tight">{NOMBRES_DIAS[dia]}</p>

        {franjas.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {franjas.map(f => (
              <ChipFranja
                key={`${f.start_time}-${f.end_time}`}
                franja={f}
                dia={dia}
                ancho="auto"
                onBorrar={() =>
                  onEscribir(franjas.filter(o => !(o.start_time === f.start_time && o.end_time === f.end_time)))
                }
              />
            ))}
          </div>
        )}

        <AgregarFranja
          horarioComercial={horarioComercial}
          onAgregar={nueva => onEscribir([...franjas, nueva])}
        />

        <Separator />

        <AccionesDia
          dia={dia}
          tieneFranjas={franjas.length > 0}
          onCopiar={destinos => {
            onCopiar(destinos)
            setAbierto(false)
          }}
          onLimpiar={() => onEscribir([])}
        />
      </PopoverContent>
    </Popover>
  )
}

function AgregarFranja({
  horarioComercial,
  onAgregar,
}: {
  horarioComercial: Tramo
  onAgregar: (franja: Franja) => void
}) {
  const [desde, setDesde] = useState(horarioComercial.inicio)
  const [hasta, setHasta] = useState(horarioComercial.fin)

  const valido =
    /^\d{2}:\d{2}$/.test(desde) && /^\d{2}:\d{2}$/.test(hasta) && aMinutos(hasta) > aMinutos(desde)

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">Agregar franja</p>
      <div className="flex items-center gap-1.5">
        <input
          type="time"
          value={desde}
          onChange={e => setDesde(e.target.value)}
          aria-label="Desde"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="text-xs text-muted-foreground">a</span>
        <input
          type="time"
          value={hasta}
          onChange={e => setHasta(e.target.value)}
          aria-label="Hasta"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="size-9 shrink-0 p-0"
          disabled={!valido}
          aria-label="Agregar la franja"
          onClick={() => onAgregar({ start_time: desde, end_time: hasta })}
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {!valido && (
        <p className="text-[11px] text-amber-500">La hora de fin tiene que ser posterior a la de inicio.</p>
      )}
    </div>
  )
}

function AccionesDia({
  dia,
  tieneFranjas,
  onCopiar,
  onLimpiar,
}: {
  dia: number
  tieneFranjas: boolean
  onCopiar: (destinos: number[]) => void
  onLimpiar: () => void
}) {
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-full justify-start text-xs"
        disabled={!tieneFranjas}
        onClick={() => onCopiar([1, 2, 3, 4, 5, 6, 0])}
      >
        <CopyCheck className="mr-1.5 size-3.5" />
        Copiar a toda la semana
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-full justify-start text-xs"
        disabled={!tieneFranjas}
        onClick={() => onCopiar([1, 2, 3, 4, 5])}
      >
        <CopyCheck className="mr-1.5 size-3.5" />
        Copiar a lunes–viernes
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-full justify-start text-xs text-muted-foreground hover:text-destructive"
        disabled={!tieneFranjas}
        onClick={onLimpiar}
      >
        <CalendarOff className="mr-1.5 size-3.5" />
        {`Limpiar ${NOMBRES_DIAS[dia].toLowerCase()}`}
      </Button>
    </div>
  )
}

// ─── Grilla ↔ franjas ────────────────────────────────────────────────

/**
 * Límites de la grilla: el horario comercial de la sucursal, ampliado si alguna
 * franja ya cargada cae fuera (si no, quedaría invisible y el dueño no podría
 * borrarla desde la grilla).
 */
function calcularRejilla(horarioComercial: Tramo, franjas: FranjasSemana): Rejilla {
  let inicio = aMinutos(horarioComercial.inicio || '08:00')
  let fin = aMinutos(horarioComercial.fin || '22:00')
  if (!(fin > inicio)) {
    inicio = 8 * 60
    fin = 22 * 60
  }
  for (const dia of ORDEN_SEMANA) {
    for (const f of franjas[dia] ?? []) {
      const a = aMinutos(f.start_time)
      const b = aMinutos(f.end_time)
      if (b <= a) continue
      inicio = Math.min(inicio, a)
      fin = Math.max(fin, b)
    }
  }
  inicio = Math.max(0, Math.floor(inicio / PASO_GRILLA) * PASO_GRILLA)
  fin = Math.min(24 * 60, Math.ceil(fin / PASO_GRILLA) * PASO_GRILLA)
  return { inicio, fin, filas: Math.max(1, (fin - inicio) / PASO_GRILLA) }
}

/**
 * Celdas encendidas de un día. Una celda cuenta como pintada sólo si entra
 * ENTERA en una franja: media celda pintada no existe en la grilla.
 */
function slotsDeFranjas(franjas: Franja[], rejilla: Rejilla): Set<number> {
  const celdas = new Set<number>()
  for (const f of franjas) {
    const a = aMinutos(f.start_time)
    const b = aMinutos(f.end_time)
    if (b <= a) continue
    const desde = Math.max(0, Math.ceil((a - rejilla.inicio) / PASO_GRILLA))
    const hasta = Math.min(rejilla.filas, Math.floor((b - rejilla.inicio) / PASO_GRILLA))
    for (let i = desde; i < hasta; i++) celdas.add(i)
  }
  return celdas
}

/** Celdas contiguas → una sola franja. Es lo que fusiona los chips solos. */
function franjasDeSlots(celdas: Set<number>, rejilla: Rejilla): Franja[] {
  const orden = [...celdas].filter(i => i >= 0 && i < rejilla.filas).sort((a, b) => a - b)
  const salida: Franja[] = []
  let i = 0
  while (i < orden.length) {
    let j = i
    while (j + 1 < orden.length && orden[j + 1] === orden[j] + 1) j++
    salida.push({
      start_time: aHora(rejilla.inicio + orden[i] * PASO_GRILLA),
      end_time: aHora(rejilla.inicio + (orden[j] + 1) * PASO_GRILLA),
    })
    i = j + 1
  }
  return salida
}

/** 210 → "3 h 30". Lo que se lee bajo el nombre del día. */
function formatearHoras(minutos: number): string {
  if (minutos <= 0) return '—'
  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  if (!horas) return `${resto} min`
  return resto ? `${horas} h ${resto}` : `${horas} h`
}
