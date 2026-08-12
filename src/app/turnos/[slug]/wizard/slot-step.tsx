'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CalendarX2,
  Info,
  Loader2,
  Moon,
  Sun,
  Sunrise,
  UserRoundCog,
} from 'lucide-react'
import { publicGetAvailableSlots } from '@/lib/actions/public-booking'
import type {
  PublicSlotGroup,
  PublicStaff,
  PublicWalkInStaff,
} from '@/lib/actions/public-booking'
import { toDateStr } from '@/lib/time-utils'
import { cn } from '@/lib/utils'
import { textoDias, textoRangos } from '@/lib/franjas'
import { glassPanel, glassInteractive } from '../glass'
import { fechaCortaDeStr, fechaLarga } from '../fechas'
import { fechaDentroDeVentana } from '../ventana'
import { DayStrip } from './day-strip'
import { Avatar } from './avatar'
import { BarberSheet } from './barber-sheet'

/** Tope del escalonado de los chips de horario. */
const STAGGER_MAX = 11

export interface SlotSelection {
  time: string
  staffId: string
  staffName: string
  staffAvatarUrl: string | null
}

interface Props {
  branchId: string
  /** Todos los servicios elegidos: la disponibilidad usa la duración TOTAL. */
  serviceIds: string[]
  /** Barberos habilitados, con los días y franjas en que toma turnos cada uno. */
  staff: PublicStaff[]
  /** Barberos de la sucursal que sólo atienden por orden de llegada. */
  walkInStaff: PublicWalkInStaff[]
  maxAdvanceDays: number
  /** Días reservables reales (config de la sucursal ∩ días que trabaja alguien). */
  enabledDays: number[]
  selectedDate: Date | undefined
  selectedTime: string
  /** El barbero del slot elegido: la selección se keyea por barbero+hora. */
  selectedStaffId: string
  onDateChange: (d: Date) => void
  onSlotSelect: (slot: SlotSelection) => void
  onClearSlot: () => void
}

// ─── Franjas horarias ────────────────────────────────────────────────

const FRANJAS = [
  { id: 'manana', label: 'Mañana', Icon: Sunrise, hasta: 13 * 60 },
  { id: 'tarde', label: 'Tarde', Icon: Sun, hasta: 18 * 60 },
  { id: 'noche', label: 'Noche', Icon: Moon, hasta: 24 * 60 },
] as const

function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// ─── Helpers de disponibilidad ───────────────────────────────────────

function hayCupo(grupos: PublicSlotGroup[]): boolean {
  return grupos.some(g => g.slots.some(s => s.available))
}

/**
 * Estado conocido de una fecha ya consultada.
 *
 * `sin-datos` existe porque antes un error de consulta se colapsaba a `[]` y
 * `hayCupo([])` daba false: un rate-limit o un timeout del motor dejaban el día
 * etiquetado "Lleno" para siempre. Un día que no se pudo consultar no es un día
 * lleno.
 */
type EstadoFecha = 'lleno' | 'sin-datos'
type EstadoFechas = Record<string, EstadoFecha>

/**
 * Aplica marcas de fecha sobre el estado previo. `null` BORRA la marca: una
 * fecha que vuelve a consultarse con éxito tiene que poder dejar de estar
 * marcada (el set anterior sólo crecía, así que una marca equivocada era
 * definitiva).
 *
 * Vive fuera del componente para poder usarse dentro del efecto sin sumarle
 * dependencias.
 */
function aplicarEstados(
  prev: EstadoFechas,
  cambios: Array<[string, EstadoFecha | null]>
): EstadoFechas {
  let next = prev
  for (const [key, estado] of cambios) {
    if ((prev[key] ?? null) === estado) continue
    if (next === prev) next = { ...prev }
    if (estado === null) delete next[key]
    else next[key] = estado
  }
  return next
}

/**
 * Próximas fechas reservables después de `desde`, dentro de la ventana.
 *
 * El tope lo decide `fechaDentroDeVentana` y no un cálculo propio: sugerir un
 * día que el motor va a rechazar por rango es exactamente el error que se
 * quería evitar en la tira.
 */
function proximosDias(
  desde: string,
  enabled: number[],
  maxAdvanceDays: number,
  limite: number
): string[] {
  const cursor = new Date(`${desde}T12:00:00`)
  const out: string[] = []
  while (out.length < limite) {
    cursor.setDate(cursor.getDate() + 1)
    if (!fechaDentroDeVentana(cursor, maxAdvanceDays)) break
    if (enabled.includes(cursor.getDay())) out.push(toDateStr(cursor))
  }
  return out
}

// ─── Componente ──────────────────────────────────────────────────────

export function SlotStep({
  branchId,
  serviceIds,
  staff,
  walkInStaff,
  maxAdvanceDays,
  enabledDays,
  selectedDate,
  selectedTime,
  selectedStaffId,
  onDateChange,
  onSlotSelect,
  onClearSlot,
}: Props) {
  const [grupos, setGrupos] = useState<PublicSlotGroup[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [filtroStaff, setFiltroStaff] = useState<string | null>(null)
  const [sheetAbierta, setSheetAbierta] = useState(false)
  const [sugerencias, setSugerencias] = useState<string[]>([])
  const [buscandoAlternativas, setBuscandoAlternativas] = useState(false)
  /** Qué sabemos de cada fecha ya consultada: llena, o no se pudo consultar. */
  const [estadoFechas, setEstadoFechas] = useState<EstadoFechas>({})
  /** true si NINGUNA de las fechas alternativas se pudo consultar. */
  const [barridoFallido, setBarridoFallido] = useState(false)

  // La disponibilidad de un día no cambia mientras el cliente completa el
  // wizard: cachearla evita re-pegarle al motor cada vez que vuelve a un día ya
  // visto, que además consume el rate-limit (20 consultas/min por IP+sucursal).
  const cache = useRef(new Map<string, PublicSlotGroup[]>())

  const dateStr = selectedDate ? toDateStr(selectedDate) : ''
  // `serviceIds`/`enabledDays` son arrays nuevos en cada render del padre: sin
  // estas claves estables el efecto se re-dispararía en loop.
  const serviceKey = serviceIds.join(',')
  const enabledKey = enabledDays.join(',')

  useEffect(() => {
    if (!dateStr || !serviceKey) return
    let cancelado = false

    const ids = serviceKey.split(',')
    const dias = enabledKey ? enabledKey.split(',').map(Number) : []

    async function cargar() {
      let delDia = cache.current.get(dateStr)

      if (!delDia) {
        setCargando(true)
        setError('')
        setSugerencias([])
        setBarridoFallido(false)

        const res = await publicGetAvailableSlots(branchId, dateStr, ids)
        if (cancelado) return

        if (res.error) {
          setError(res.error)
          setGrupos([])
          setCargando(false)
          setSugerencias([])
          // La consulta falló (rate-limit, motor caído): el día queda marcado
          // como "no pudimos consultar", NUNCA como lleno, y sin cachear — así
          // volver a tocarlo reintenta de verdad.
          setEstadoFechas(prev => aplicarEstados(prev, [[dateStr, 'sin-datos']]))
          return
        }
        delDia = res.slots
        cache.current.set(dateStr, delDia)
      }

      setGrupos(delDia)
      setError('')
      setCargando(false)

      if (hayCupo(delDia)) {
        // Consulta buena y con lugar: se limpia cualquier marca vieja de esa
        // fecha (podía venir de un intento fallido anterior).
        setEstadoFechas(prev => aplicarEstados(prev, [[dateStr, null]]))
        setSugerencias([])
        setBuscandoAlternativas(false)
        setBarridoFallido(false)
        return
      }

      // Día sin huecos: en vez de dejar al cliente probando fecha por fecha,
      // adelantamos las próximas con disponibilidad. Con caché, cada día vacío
      // cuesta 3 consultas extra como mucho y sólo la primera vez.
      setEstadoFechas(prev => aplicarEstados(prev, [[dateStr, 'lleno']]))
      const candidatos = proximosDias(dateStr, dias, maxAdvanceDays, 3)
      if (!candidatos.length) {
        setSugerencias([])
        setBuscandoAlternativas(false)
        setBarridoFallido(false)
        return
      }

      setBuscandoAlternativas(true)
      const resultados = await Promise.all(
        candidatos.map(async key => {
          const hit = cache.current.get(key)
          if (hit) return { key, grupos: hit, fallo: false }
          const r = await publicGetAvailableSlots(branchId, key, ids)
          // El error se propaga como `fallo` en vez de colapsarse a `[]`:
          // colapsarlo hacía que un día que no se pudo consultar entrara al set
          // de días llenos y se pintara "Lleno" para siempre.
          if (r.error) return { key, grupos: [] as PublicSlotGroup[], fallo: true }
          cache.current.set(key, r.slots)
          return { key, grupos: r.slots, fallo: false }
        })
      )
      if (cancelado) return

      setSugerencias(
        resultados.filter(r => !r.fallo && hayCupo(r.grupos)).map(r => r.key)
      )
      setEstadoFechas(prev =>
        aplicarEstados(
          prev,
          resultados.map(r =>
            r.fallo
              ? [r.key, 'sin-datos' as const]
              : hayCupo(r.grupos)
                ? [r.key, null]
                : [r.key, 'lleno' as const]
          )
        )
      )
      // Si no se pudo consultar NINGUNA alternativa hay que decirlo: sin esto,
      // "no hay próximos días con lugar" y "no pudimos averiguarlo" se veían
      // exactamente igual.
      setBarridoFallido(resultados.every(r => r.fallo))
      setBuscandoAlternativas(false)
    }

    cargar()
    return () => { cancelado = true }
  }, [dateStr, serviceKey, enabledKey, branchId, maxAdvanceDays])

  const conCupo = useMemo(
    () => grupos.filter(g => g.slots.some(s => s.available)),
    [grupos]
  )

  // Si el barbero filtrado no atiende el día elegido, el filtro se ignora solo
  // en vez de dejar la grilla vacía sin explicación.
  const filtro = filtroStaff && conCupo.some(g => g.staff_id === filtroStaff) ? filtroStaff : null

  /**
   * Una entrada por HORA, no por barbero.
   *
   * El motor devuelve un grupo por barbero y con "Cualquiera" el mismo 15:00
   * aparecía dos veces. Como la premisa es que el cliente no elija barbero, se
   * queda el primero que ofrece esa hora (orden del motor) y después se le
   * muestra quién lo atiende.
   */
  const horarios = useMemo(() => {
    const visibles = filtro ? conCupo.filter(g => g.staff_id === filtro) : conCupo
    const porHora = new Map<string, SlotSelection>()
    for (const g of visibles) {
      for (const s of g.slots) {
        if (!s.available || porHora.has(s.time)) continue
        porHora.set(s.time, {
          time: s.time,
          staffId: g.staff_id,
          staffName: g.staff_name,
          staffAvatarUrl: g.staff_avatar_url,
        })
      }
    }
    return [...porHora.values()].sort((a, b) => a.time.localeCompare(b.time))
  }, [conCupo, filtro])

  const porFranja = useMemo(
    () =>
      FRANJAS.map((franja, i) => {
        const desde = i === 0 ? 0 : FRANJAS[i - 1].hasta
        return {
          ...franja,
          slots: horarios.filter(h => {
            const m = minutos(h.time)
            return m >= desde && m < franja.hasta
          }),
        }
      }).filter(f => f.slots.length > 0),
    [horarios]
  )

  // ─── Quién va a atender ─────────────────────────────────────────
  //
  // Hay tres grados de certeza y la pantalla los dice distinto, porque
  // prometer un barbero que después cambia es peor que no prometer nada:
  //
  //   · Eligió barbero, o hay uno solo ese día  → "Te atiende X".
  //   · Ya eligió la hora                       → "Te atiende X" (el motor
  //     devuelve un grupo por barbero, así que la hora viene con dueño).
  //   · Todavía no eligió hora y hay varios     → "Posiblemente te atienda X":
  //     depende de qué hora toque, y decirlo es más honesto que callarlo.
  const barberoDelSlot = selectedTime
    ? conCupo.find(g => g.staff_id === selectedStaffId) ?? null
    : null

  const barberoUnico =
    filtro
      ? conCupo.find(g => g.staff_id === filtro) ?? null
      : conCupo.length === 1
        ? conCupo[0]
        : null

  const barberoMostrado = barberoDelSlot ?? barberoUnico ?? conCupo[0] ?? null
  const esSeguro = !!(barberoDelSlot || barberoUnico)

  const fichaDelBarbero = barberoMostrado
    ? staff.find(s => s.id === barberoMostrado.staff_id) ?? null
    : null

  // Las franjas del día elegido, no las de toda la semana: "Da turnos de 16 a
  // 19" al lado de una grilla que arranca 16:00 explica la grilla.
  const franjasDelDia = selectedDate && fichaDelBarbero
    ? fichaDelBarbero.windows?.[selectedDate.getDay()] ?? []
    : []

  // El filtro se ignora solo cuando el barbero no atiende el día elegido (si no,
  // la grilla quedaría vacía sin explicación). Pero ignorarlo EN SILENCIO deja
  // al cliente creyendo que reservó con él, así que se avisa.
  const filtroIgnorado = !!filtroStaff && filtro !== filtroStaff
  const nombreFiltrado = filtroIgnorado
    ? staff.find(s => s.id === filtroStaff)?.full_name ?? ''
    : ''

  function elegirFiltro(id: string | null) {
    onClearSlot()
    setFiltroStaff(id)
  }

  const fechasLlenas = useMemo(
    () =>
      new Set(
        Object.keys(estadoFechas).filter(k => estadoFechas[k] === 'lleno')
      ),
    [estadoFechas]
  )
  const fechasSinDatos = useMemo(
    () =>
      new Set(
        Object.keys(estadoFechas).filter(k => estadoFechas[k] === 'sin-datos')
      ),
    [estadoFechas]
  )

  return (
    <div className="space-y-6">
      <DayStrip
        maxAdvanceDays={maxAdvanceDays}
        enabledDays={enabledDays}
        selectedDate={selectedDate}
        onSelect={onDateChange}
        fullDates={fechasLlenas}
        unknownDates={fechasSinDatos}
      />

      {selectedDate && (
        <p className="text-sm font-semibold text-[var(--t-text)]">
          {fechaLarga(selectedDate)}
        </p>
      )}

      {/* ── Quién te atiende ─────────────────────────────────────── */}
      {barberoMostrado && !cargando && (
        <div className={cn(glassPanel, 't-rise p-3.5')}>
          <div className="flex items-center gap-3">
            <Avatar
              url={barberoMostrado.staff_avatar_url}
              name={barberoMostrado.staff_name}
              size={46}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
                {esSeguro ? 'Te atiende' : 'Posiblemente te atienda'}
              </p>
              <p className="truncate text-base font-bold leading-tight text-[var(--t-text)]">
                {barberoMostrado.staff_name}
              </p>
              {/* Dos líneas antes que cortar: con horario entrecortado
                  ("10 a 13 y 16 a 19") `truncate` se comía justo la segunda
                  franja, que es la información nueva. */}
              <p className="line-clamp-2 text-xs leading-snug text-[var(--t-text-muted)]">
                {franjasDelDia.length > 0
                  ? `Da turnos de ${textoRangos(franjasDelDia)}`
                  : fichaDelBarbero?.days.length
                    ? `Toma turnos ${textoDias(fichaDelBarbero.days)}`
                    : 'Según el horario que elijas'}
              </p>
            </div>
            {(conCupo.length > 1 || staff.length > 1 || walkInStaff.length > 0) && (
              <button
                type="button"
                onClick={() => setSheetAbierta(true)}
                className={cn(
                  glassInteractive,
                  'flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold text-[var(--t-text)]'
                )}
              >
                <UserRoundCog className="h-4 w-4" />
                {filtro ? 'Cambiar' : 'Elegir barbero'}
              </button>
            )}
          </div>

          {filtroIgnorado && nombreFiltrado && (
            <p className="mt-3 flex items-start gap-2 rounded-xl p-2.5 text-xs leading-relaxed text-[var(--t-text-muted)]"
              style={{
                backgroundColor: 'var(--t-glass-inner)',
                boxShadow: 'inset 0 0 0 1px var(--t-glass-border)',
              }}
              role="status"
            >
              <Info className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--t-accent)]" />
              <span>
                <strong className="font-bold text-[var(--t-text)]">{nombreFiltrado}</strong> no toma
                turnos ese día. Te mostramos los horarios de todos.
              </span>
            </p>
          )}
        </div>
      )}

      {/* Sin barberos con cupo todavía (día lleno, o cargando la primera vez)
          igual tiene que poder abrirse la hoja: es la única forma de descubrir
          qué días atiende cada uno sin ir probando fecha por fecha. */}
      {!barberoMostrado && !cargando && (staff.length > 0 || walkInStaff.length > 0) && (
        <button
          type="button"
          onClick={() => setSheetAbierta(true)}
          className={cn(
            glassInteractive,
            't-rise flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold text-[var(--t-text)]'
          )}
        >
          <UserRoundCog className="h-4 w-4" />
          Ver barberos y sus horarios
        </button>
      )}

      <BarberSheet
        abierto={sheetAbierta}
        staff={staff}
        walkIn={walkInStaff}
        seleccionado={filtroStaff}
        onSeleccionar={elegirFiltro}
        onCerrar={() => setSheetAbierta(false)}
      />

      {/* Grilla de horarios */}
      {cargando ? (
        <GrillaEsqueleto />
      ) : error ? (
        <div
          className="rounded-2xl p-4 text-sm"
          style={{ backgroundColor: 'var(--t-danger-bg)', color: 'var(--t-danger-text)' }}
          role="alert"
        >
          {error}
        </div>
      ) : horarios.length === 0 ? (
        <SinHorarios
          fecha={selectedDate}
          sugerencias={sugerencias}
          buscando={buscandoAlternativas}
          barridoFallido={barridoFallido}
          onElegirFecha={str => onDateChange(new Date(`${str}T12:00:00`))}
        />
      ) : (
        <div className="space-y-5">
          {porFranja.map(franja => (
            <div key={franja.id} className="space-y-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
                <franja.Icon className="h-3.5 w-3.5" />
                {franja.label}
              </p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {franja.slots.map((slot, i) => {
                  // Keyeado por barbero+hora: con dos barberos, marcar sólo por
                  // hora encendía el 15:00 de los dos a la vez.
                  const elegido =
                    selectedTime === slot.time && selectedStaffId === slot.staffId
                  return (
                    <button
                      key={`${slot.staffId}-${slot.time}`}
                      type="button"
                      onClick={() => onSlotSelect(slot)}
                      aria-pressed={elegido}
                      className={cn(
                        glassInteractive,
                        't-rise min-h-[48px] rounded-xl text-[15px] font-semibold tabular-nums'
                      )}
                      style={{
                        '--t-i': Math.min(i, STAGGER_MAX),
                        backgroundColor: elegido ? 'var(--t-primary)' : undefined,
                        borderColor: elegido ? 'var(--t-primary)' : undefined,
                        color: elegido ? 'var(--t-on-primary)' : 'var(--t-text)',
                        transform: elegido ? 'scale(1.05)' : undefined,
                        boxShadow: elegido
                          ? '0 12px 28px -12px var(--t-ring), var(--t-glass-shadow)'
                          : undefined,
                      } as React.CSSProperties}
                    >
                      {slot.time}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Piezas ──────────────────────────────────────────────────────────

/**
 * Esqueleto de la grilla mientras se consulta la disponibilidad.
 *
 * Reemplaza al spinner con "Buscando horarios…": un spinner centrado no dice
 * nada de lo que viene y la pantalla pega un salto cuando llegan los datos. El
 * esqueleto ya tiene la forma de la grilla, así que el contenido aterriza donde
 * el ojo lo estaba esperando.
 */
function GrillaEsqueleto() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Buscando horarios disponibles</span>
      {[6, 10].map((cantidad, bloque) => (
        <div key={bloque} className="space-y-2.5">
          <div className="t-skel h-3 w-24 rounded-full" />
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {Array.from({ length: cantidad }, (_, i) => (
              <div
                key={i}
                className="t-skel t-rise min-h-[48px] rounded-xl"
                style={{ '--t-i': Math.min(i, STAGGER_MAX) } as React.CSSProperties}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SinHorarios({
  fecha,
  sugerencias,
  buscando,
  barridoFallido,
  onElegirFecha,
}: {
  fecha: Date | undefined
  sugerencias: string[]
  buscando: boolean
  /** No se pudo consultar NINGUNA de las fechas alternativas. */
  barridoFallido: boolean
  onElegirFecha: (str: string) => void
}) {
  return (
    <div className={cn(glassPanel, 't-rise p-6 text-center')}>
      <CalendarX2 className="mx-auto h-8 w-8 text-[var(--t-text-faint)]" />
      <p className="mt-3 text-base font-bold text-[var(--t-text)]">
        No quedan horarios{fecha ? ' ese día' : ''}
      </p>
      <p className="mt-1 text-sm text-[var(--t-text-muted)]">
        {fecha ? (
          <>
            Los turnos del {fechaLarga(fecha)} ya están
            todos tomados.
          </>
        ) : (
          'Elegí un día para ver los horarios disponibles.'
        )}
      </p>

      {buscando && (
        <p className="mt-4 flex items-center justify-center gap-2 text-sm text-[var(--t-text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Buscando los próximos días…
        </p>
      )}

      {!buscando && sugerencias.length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
            Próximos días con lugar
          </p>
          <div className="mt-2.5 flex flex-wrap justify-center gap-2">
            {sugerencias.map((str, i) => (
              <button
                key={str}
                type="button"
                onClick={() => onElegirFecha(str)}
                className={cn(
                  glassInteractive,
                  't-rise flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-[var(--t-text)]'
                )}
                style={{ '--t-i': i } as React.CSSProperties}
              >
                {fechaCortaDeStr(str)}
                <ArrowRight className="h-3.5 w-3.5 opacity-70" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Que el barrido de alternativas se haya caído no es lo mismo que "no
          hay lugar en los próximos días": decirlo evita que el cliente se vaya
          creyendo que la agenda está completa. */}
      {!buscando && sugerencias.length === 0 && barridoFallido && (
        <p className="mt-4 flex items-center justify-center gap-1.5 text-sm text-[var(--t-text-muted)]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          No pudimos consultar los próximos días. Probá de nuevo en un momento.
        </p>
      )}

      {!buscando && sugerencias.length === 0 && !barridoFallido && fecha && (
        <p className="mt-4 text-sm text-[var(--t-text-muted)]">
          Probá con otro día de la tira de arriba.
        </p>
      )}
    </div>
  )
}
