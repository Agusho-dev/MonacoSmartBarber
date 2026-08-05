'use client'

import { useState, useEffect, useMemo, useTransition } from 'react'
import { Check, Hourglass, Loader2, MapPin } from 'lucide-react'
import { getAvailableSlots, createAppointment } from '@/lib/actions/appointments'
import { markWaitlistBooked } from '@/lib/actions/waitlist'
import { themeVars, type TurneroTheme } from '../../[slug]/theme'
import { fechaLargaDeStr } from '../../[slug]/fechas'
import type { AppointmentWaitlist } from '@/lib/types/database'
import { toDateStr } from '@/lib/time-utils'

interface AvailableOption {
  date: string
  time: string
  barberId: string
  barberName: string
}

function keyDe(o: AvailableOption): string {
  return `${o.date}|${o.time}|${o.barberId}`
}

export function EsperaClient({
  entry,
  theme,
}: {
  entry: AppointmentWaitlist
  theme: TurneroTheme
}) {
  const [loading, setLoading] = useState(true)
  const [options, setOptions] = useState<AvailableOption[]>([])
  const [picked, setPicked] = useState<string>('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let alive = true
    ;(async () => {
      const from = new Date(entry.preferred_date_from + 'T12:00:00')
      const to = new Date(entry.preferred_date_to + 'T12:00:00')
      const dates: string[] = []
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        dates.push(toDateStr(d))
      }

      const found: AvailableOption[] = []
      for (const dateStr of dates) {
        const { slots } = await getAvailableSlots(
          entry.branch_id,
          dateStr,
          entry.service_id ?? undefined,
          entry.barber_id ?? undefined,
        )
        for (const barber of slots) {
          for (const slot of barber.slots) {
            if (slot.available) {
              found.push({
                date: dateStr,
                time: slot.time,
                barberId: barber.barberId,
                barberName: barber.barberName,
              })
              if (found.length >= 30) break
            }
          }
          if (found.length >= 30) break
        }
        if (found.length >= 30) break
      }

      if (alive) {
        setOptions(found)
        setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [entry])

  // Un bloque por día con sus horas: una lista plana de 30 combinaciones
  // "fecha · hora · barbero" dentro de un <select> era ilegible en celular.
  const porDia = useMemo(() => {
    const mapa = new Map<string, AvailableOption[]>()
    for (const o of options) {
      const acumulado = mapa.get(o.date)
      if (acumulado) acumulado.push(o)
      else mapa.set(o.date, [o])
    }
    return [...mapa.entries()].map(([date, slots]) => ({ date, slots }))
  }, [options])

  function handleConfirm() {
    setError('')
    const option = options.find(o => keyDe(o) === picked)
    if (!option) { setError('Elegí un horario'); return }
    if (!entry.client) { setError('Cliente no encontrado'); return }

    startTransition(async () => {
      const result = await createAppointment({
        branchId: entry.branch_id,
        clientPhone: entry.client!.phone,
        clientName: entry.client!.name,
        barberId: option.barberId,
        serviceId: entry.service_id ?? '',
        appointmentDate: option.date,
        startTime: option.time,
        durationMinutes: entry.service?.duration_minutes ?? 30,
        source: 'public',
      })

      if (result.error || !result.appointment) {
        setError(result.error ?? 'Error al crear turno')
        return
      }

      await markWaitlistBooked(entry.id, result.appointment.id)
      setConfirmed(true)
    })
  }

  if (confirmed) {
    return (
      <Marco theme={theme}>
        <div
          className="rounded-3xl border p-8 text-center"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          <span
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: 'var(--t-primary)', color: 'var(--t-on-primary)' }}
          >
            <Check className="h-8 w-8" strokeWidth={3} />
          </span>
          <h1 className="mt-4 text-xl font-bold text-[var(--t-text)]">Turno confirmado</h1>
          <p className="mt-1.5 text-sm text-[var(--t-text-muted)]">
            Te esperamos en {entry.branch?.name ?? 'el local'}.
          </p>
        </div>
      </Marco>
    )
  }

  const vence = entry.notification_expires_at
    ? new Date(entry.notification_expires_at).toLocaleString('es-AR', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : null

  return (
    <Marco theme={theme}>
      <div
        className="rounded-3xl border p-6"
        style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
      >
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
          <Hourglass className="h-3.5 w-3.5" />
          Lista de espera
        </p>
        <h1 className="mt-1.5 text-2xl font-bold leading-tight text-[var(--t-text)]">
          Se liberó un horario
        </h1>
        {entry.branch?.name && (
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-[var(--t-text-muted)]">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {entry.branch.name}
            {entry.branch.address && ` · ${entry.branch.address}`}
          </p>
        )}
        {vence && (
          <p className="mt-3 text-xs font-semibold text-[var(--t-text-muted)]">
            Reservá antes del {vence}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[var(--t-text-muted)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Buscando horarios…</span>
        </div>
      ) : options.length === 0 ? (
        <div
          className="rounded-2xl border p-6 text-center text-sm text-[var(--t-text-muted)]"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          Ya no quedan horarios disponibles en el rango que pediste. Escribinos para coordinar
          otro día.
        </div>
      ) : (
        <>
          {porDia.map(bloque => (
            <div
              key={bloque.date}
              className="rounded-2xl border p-4"
              style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--t-text-muted)]">
                {fechaLargaDeStr(bloque.date)}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {bloque.slots.map(o => {
                  const key = keyDe(o)
                  const elegido = key === picked
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setPicked(key); setError('') }}
                      aria-pressed={elegido}
                      className="min-h-[48px] rounded-xl border text-sm font-semibold tabular-nums transition-colors"
                      style={{
                        backgroundColor: elegido ? 'var(--t-primary)' : 'var(--t-surface-alt)',
                        borderColor: elegido ? 'var(--t-primary)' : 'var(--t-border)',
                        color: elegido ? 'var(--t-on-primary)' : 'var(--t-text)',
                      }}
                    >
                      {o.time}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {error && (
            <div
              className="rounded-2xl p-3.5 text-sm font-medium"
              style={{ backgroundColor: 'var(--t-danger-bg)', color: 'var(--t-danger-text)' }}
              role="alert"
            >
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending || !picked}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl text-base font-bold disabled:cursor-not-allowed"
            style={{
              backgroundColor: picked && !isPending ? 'var(--t-primary)' : 'var(--t-surface-alt)',
              color: picked && !isPending ? 'var(--t-on-primary)' : 'var(--t-text-faint)',
            }}
          >
            {isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Confirmando…</>
            ) : (
              'Confirmar turno'
            )}
          </button>
        </>
      )}
    </Marco>
  )
}

function Marco({ theme, children }: { theme: TurneroTheme; children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-[var(--t-bg)] p-4 text-[var(--t-text)]"
      style={themeVars(theme)}
    >
      <div className="mx-auto w-full max-w-md space-y-4 py-6">{children}</div>
    </div>
  )
}
