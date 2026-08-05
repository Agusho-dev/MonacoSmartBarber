'use client'

import { useEffect, useMemo, useRef } from 'react'
import { RotateCw } from 'lucide-react'
import { toDateStr } from '@/lib/time-utils'
import { diasDeVentana } from '../ventana'

const DIAS_ABREV = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

interface Props {
  /** Ventana de reserva: hoy … hoy + N. */
  maxAdvanceDays: number
  /** Días de semana reservables (0=domingo). El resto se dibuja deshabilitado. */
  enabledDays: number[]
  selectedDate: Date | undefined
  onSelect: (d: Date) => void
  /** Fechas YYYY-MM-DD que ya consultamos y volvieron sin ningún hueco. */
  fullDates: Set<string>
  /**
   * Fechas cuya consulta FALLÓ (rate-limit, DB caída). No son días llenos: se
   * marcan aparte para que el chip no mienta y tocarlas reintenta la consulta.
   */
  unknownDates: Set<string>
}

/**
 * Tira horizontal de días.
 *
 * Sustituye al calendario mensual: con `max_advance_days = 15` un mes entero
 * era una tarjeta blanca enorme (la fuente de la "isla" clara flotando sobre el
 * fondo de marca) para elegir entre dos semanas. La tira además hereda el tema
 * sin pelearse con las clases `text-slate-*` que trae el componente Calendar.
 */
export function DayStrip({
  maxAdvanceDays,
  enabledDays,
  selectedDate,
  onSelect,
  fullDates,
  unknownDates,
}: Props) {
  // La tira NO se genera con `maxAdvanceDays` a secas: el motor de
  // disponibilidad puede rechazar el último día de la ventana según la hora del
  // día (ver `ventana.ts`). Ofrecer un chip que después devuelve "Fecha fuera
  // del rango permitido" es peor que no ofrecerlo.
  const dias = useMemo(() => diasDeVentana(maxAdvanceDays), [maxAdvanceDays])

  // Un bloque por mes, con su encabezado propio: así el encabezado siempre
  // corresponde a los días que tiene debajo, sin escuchar el scroll.
  const bloques = useMemo(() => {
    const anioActual = new Date().getFullYear()
    const out: { key: string; label: string; days: Date[] }[] = []
    for (const d of dias) {
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const ultimo = out[out.length - 1]
      if (ultimo && ultimo.key === key) {
        ultimo.days.push(d)
      } else {
        const label =
          d.getFullYear() === anioActual
            ? MESES[d.getMonth()]
            : `${MESES[d.getMonth()]} ${d.getFullYear()}`
        out.push({ key, label, days: [d] })
      }
    }
    return out
  }, [dias])

  const selectedStr = selectedDate ? toDateStr(selectedDate) : ''
  const hoyStr = dias[0] ? toDateStr(dias[0]) : ''
  const mananaStr = dias[1] ? toDateStr(dias[1]) : ''

  const selectedRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    // `block: 'nearest'` para que centrar el chip no arrastre la página entera
    // hacia arriba en celular.
    selectedRef.current?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    })
  }, [selectedStr])

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-4">
        {bloques.map(bloque => (
          <div key={bloque.key} className="flex flex-col gap-2">
            <span className="px-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
              {bloque.label}
            </span>
            <div className="flex gap-2">
              {bloque.days.map(d => {
                const str = toDateStr(d)
                const habilitado = enabledDays.includes(d.getDay())
                const sinCupo = habilitado && fullDates.has(str)
                // "No lo pudimos consultar" NO es "lleno": el chip queda a
                // opacidad plena y tocarlo vuelve a pedir la disponibilidad.
                const sinDatos = habilitado && !sinCupo && unknownDates.has(str)
                const seleccionado = str === selectedStr
                const etiqueta =
                  str === hoyStr ? 'Hoy' : str === mananaStr ? 'Mañana' : ''

                return (
                  <button
                    key={str}
                    ref={seleccionado ? selectedRef : undefined}
                    type="button"
                    disabled={!habilitado}
                    onClick={() => onSelect(d)}
                    aria-pressed={seleccionado}
                    aria-label={`${DIAS_ABREV[d.getDay()]} ${d.getDate()}${
                      sinCupo
                        ? ', sin cupos'
                        : sinDatos
                          ? ', no pudimos consultar, tocá para reintentar'
                          : ''
                    }`}
                    className="flex h-[84px] w-[62px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border transition-[background-color,border-color,transform] duration-150 disabled:cursor-not-allowed enabled:active:scale-95"
                    style={{
                      backgroundColor: seleccionado
                        ? 'var(--t-primary)'
                        : habilitado
                          ? 'var(--t-surface)'
                          : 'transparent',
                      borderColor: seleccionado
                        ? 'var(--t-primary)'
                        : 'var(--t-border)',
                      color: seleccionado
                        ? 'var(--t-on-primary)'
                        : habilitado
                          ? 'var(--t-text)'
                          : 'var(--t-text-faint)',
                      opacity: habilitado ? (sinCupo ? 0.62 : 1) : 0.38,
                    }}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                      {DIAS_ABREV[d.getDay()]}
                    </span>
                    <span className="text-[22px] font-bold leading-none tabular-nums">
                      {d.getDate()}
                    </span>
                    <span className="flex h-3 items-center justify-center text-[9px] font-semibold uppercase tracking-wide opacity-80">
                      {sinCupo ? (
                        'Lleno'
                      ) : sinDatos ? (
                        <RotateCw className="h-3 w-3" aria-hidden />
                      ) : (
                        etiqueta
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
