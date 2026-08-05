'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import {
  AlertCircle,
  ArrowRight,
  CalendarX2,
  Loader2,
  Moon,
  Sun,
  Sunrise,
  User,
  Users,
} from 'lucide-react'
import { publicGetAvailableSlots } from '@/lib/actions/public-booking'
import type { PublicSlotGroup, PublicStaff } from '@/lib/actions/public-booking'
import { toDateStr } from '@/lib/time-utils'
import { fechaCortaDeStr, fechaLarga } from '../fechas'
import { fechaDentroDeVentana } from '../ventana'
import { DayStrip } from './day-strip'

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
  /** Barberos habilitados, con los días que trabaja cada uno. */
  staff: PublicStaff[]
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

const DIAS_PLURAL = [
  'domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados',
]

/** "Atiende los martes" / "Atiende martes y jueves". */
function textoDias(days: number[]): string {
  if (!days.length) return ''
  if (days.length >= 6) return 'Atiende casi todos los días'
  const nombres = days.map(d => DIAS_PLURAL[d])
  if (nombres.length === 1) return `Atiende los ${nombres[0]}`
  return `Atiende ${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

// ─── Componente ──────────────────────────────────────────────────────

export function SlotStep({
  branchId,
  serviceIds,
  staff,
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

  /** Barbero que va a atender, cuando ya no hay ambigüedad. */
  const barberoUnico =
    filtro
      ? conCupo.find(g => g.staff_id === filtro) ?? null
      : conCupo.length === 1
        ? conCupo[0]
        : null

  // "Atiende los martes" explica por qué le tocó ese barbero sin haberlo elegido.
  const diasDelBarbero = barberoUnico
    ? textoDias(staff.find(s => s.id === barberoUnico.staff_id)?.days ?? [])
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

      {/* Filtro opcional de barbero: sólo aparece si de verdad hay más de uno */}
      {conCupo.length > 1 && (
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex gap-2">
            <FiltroChip
              activo={filtro === null}
              onClick={() => elegirFiltro(null)}
              icon={<Users className="h-3.5 w-3.5" />}
              label="Cualquiera"
            />
            {conCupo.map(g => (
              <FiltroChip
                key={g.staff_id}
                activo={filtro === g.staff_id}
                onClick={() => elegirFiltro(g.staff_id)}
                icon={<Avatar url={g.staff_avatar_url} name={g.staff_name} size={20} />}
                label={g.staff_name}
              />
            ))}
          </div>
        </div>
      )}

      {/* Un solo barbero: no se pregunta nada, se informa */}
      {barberoUnico && !cargando && (
        <div
          className="flex items-center gap-3 rounded-2xl border p-3"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          <Avatar url={barberoUnico.staff_avatar_url} name={barberoUnico.staff_name} size={44} />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
              Te atiende
            </p>
            <p className="truncate text-base font-bold text-[var(--t-text)]">
              {barberoUnico.staff_name}
            </p>
            {diasDelBarbero && (
              <p className="truncate text-xs text-[var(--t-text-muted)]">{diasDelBarbero}</p>
            )}
          </div>
        </div>
      )}

      {/* Grilla de horarios */}
      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-12 text-[var(--t-text-muted)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Buscando horarios…</span>
        </div>
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
                {franja.slots.map(slot => {
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
                      className="min-h-[48px] rounded-xl border text-[15px] font-semibold tabular-nums transition-[background-color,border-color,transform] duration-150 active:scale-95"
                      style={{
                        backgroundColor: elegido ? 'var(--t-primary)' : 'var(--t-surface)',
                        borderColor: elegido ? 'var(--t-primary)' : 'var(--t-border)',
                        color: elegido ? 'var(--t-on-primary)' : 'var(--t-text)',
                      }}
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

function FiltroChip({
  activo,
  onClick,
  icon,
  label,
}: {
  activo: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className="flex h-11 shrink-0 items-center gap-2 rounded-full border pl-2 pr-4 text-sm font-semibold transition-[background-color,border-color] duration-150"
      style={{
        backgroundColor: activo ? 'var(--t-primary)' : 'var(--t-surface)',
        borderColor: activo ? 'var(--t-primary)' : 'var(--t-border)',
        color: activo ? 'var(--t-on-primary)' : 'var(--t-text)',
      }}
    >
      <span className="flex h-6 w-6 items-center justify-center">{icon}</span>
      {label}
    </button>
  )
}

export function Avatar({
  url,
  name,
  size,
}: {
  url: string | null
  name: string
  size: number
}) {
  if (url) {
    return (
      <Image
        src={url}
        alt={name}
        width={size}
        height={size}
        unoptimized
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border"
      style={{
        width: size,
        height: size,
        backgroundColor: 'var(--t-surface-alt)',
        borderColor: 'var(--t-border)',
      }}
    >
      <User className="text-[var(--t-text-muted)]" style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
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
    <div
      className="rounded-2xl border p-6 text-center"
      style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
    >
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
            {sugerencias.map(str => (
              <button
                key={str}
                type="button"
                onClick={() => onElegirFecha(str)}
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl border px-4 text-sm font-semibold transition-[background-color] duration-150"
                style={{
                  backgroundColor: 'var(--t-surface-alt)',
                  borderColor: 'var(--t-border)',
                  color: 'var(--t-text)',
                }}
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
