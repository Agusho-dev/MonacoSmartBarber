'use client'

import { AlertTriangle, Check, ClipboardCheck, Clock, ScanFace } from 'lucide-react'
import { EncabezadoPantalla } from '@/components/barber/encabezado-pantalla'
import { cn } from '@/lib/utils'

interface AttendanceData {
    logs: {
        id: string
        action_type: 'clock_in' | 'clock_out'
        recorded_at: string
        face_verified: boolean
        notes: string | null
    }[]
    events: {
        id: string
        event_type: 'absence' | 'late'
        event_date: string
        consequence_applied: string | null
        notes: string | null
    }[]
    absences: number
    lates: number
}

interface AsistenciaClientProps {
    session: { staff_id: string; full_name: string; branch_id: string; role: string }
    attendance: AttendanceData
}

type Marca = AttendanceData['logs'][number]

/** `consequence_type` en palabras. `none` no se muestra. */
const CONSECUENCIAS: Record<string, string> = {
    salary_deduction: 'Descuento de sueldo',
    presentismo_loss: 'Pierde el presentismo',
    incentive_loss: 'Pierde el incentivo',
    warning: 'Apercibimiento',
}

function horaDe(iso: string) {
    return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** Las marcas del mes agrupadas por día (el más reciente arriba) y en orden dentro del día. */
function porDia(logs: Marca[]) {
    const dias = new Map<string, { fecha: Date; marcas: Marca[] }>()
    for (const log of logs) {
        const fecha = new Date(log.recorded_at)
        const clave = fecha.toDateString()
        const dia = dias.get(clave) ?? { fecha, marcas: [] }
        dia.marcas.push(log)
        dias.set(clave, dia)
    }
    return [...dias.values()]
        .sort((a, b) => b.fecha.getTime() - a.fecha.getTime())
        .map((d) => ({
            ...d,
            marcas: [...d.marcas].sort(
                (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
            ),
        }))
}

/**
 * La tarjeta de fichaje del mes: un renglón por día con sus marcas de entrada y
 * salida, como la que se perforaba en el reloj. Arriba, faltas y tardanzas.
 */
export function AsistenciaClient({ session, attendance }: AsistenciaClientProps) {
    const dias = porDia(attendance.logs)
    const perfecta = attendance.absences === 0 && attendance.lates === 0

    return (
        <div>
            <EncabezadoPantalla titulo="Mi asistencia" detalle={`${session.full_name} · este mes`} />

            <div className="px-4 py-5 sm:px-6 sm:py-6">
                <div className="mx-auto max-w-3xl space-y-6">
                    <div className="grid grid-cols-2 gap-3">
                        <Contador
                            etiqueta={attendance.absences === 1 ? 'falta' : 'faltas'}
                            valor={attendance.absences}
                            tono={attendance.absences > 0 ? 'rojo' : 'neutro'}
                            icono={AlertTriangle}
                        />
                        <Contador
                            etiqueta={attendance.lates === 1 ? 'llegada tarde' : 'llegadas tarde'}
                            valor={attendance.lates}
                            tono={attendance.lates > 0 ? 'ambar' : 'neutro'}
                            icono={Clock}
                        />
                    </div>

                    {perfecta && (
                        <p className="flex items-center gap-2.5 rounded-2xl border border-emerald-600/30 bg-emerald-50 px-4 py-3.5 text-[0.9375rem] font-semibold text-emerald-800">
                            <Check className="size-5 shrink-0" aria-hidden />
                            Asistencia perfecta este mes
                        </p>
                    )}

                    {attendance.events.length > 0 && (
                        <section aria-labelledby="asistencia-eventos" className="space-y-3">
                            <h2 id="asistencia-eventos" className="text-[1.0625rem] font-semibold">
                                Faltas y tardanzas
                            </h2>
                            <ul className="space-y-2">
                                {attendance.events.map((event) => (
                                    <li
                                        key={event.id}
                                        className="rounded-2xl border border-border/80 bg-card px-4 py-3"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <span
                                                className={cn(
                                                    'flex items-center gap-2 text-[0.9375rem] font-semibold',
                                                    event.event_type === 'absence' ? 'text-red-700' : 'text-amber-800',
                                                )}
                                            >
                                                <AlertTriangle className="size-4" aria-hidden />
                                                {event.event_type === 'absence' ? 'Falta' : 'Tardanza'}
                                            </span>
                                            <span className="font-mono text-sm tabular-nums text-muted-foreground">
                                                {/* `event_date` es una fecha sin hora: leída como UTC
                                                    caía en el día anterior en Argentina. */}
                                                {new Date(`${event.event_date.slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', {
                                                    day: 'numeric',
                                                    month: 'short',
                                                })}
                                            </span>
                                        </div>
                                        {event.notes && <p className="mt-1 text-sm text-muted-foreground">{event.notes}</p>}
                                        {event.consequence_applied && event.consequence_applied !== 'none' && (
                                            <p className="mt-1 text-sm font-medium text-red-800">
                                                {CONSECUENCIAS[event.consequence_applied] ?? event.consequence_applied.replace(/_/g, ' ')}
                                            </p>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    <section aria-labelledby="asistencia-tarjeta" className="space-y-3">
                        <h2 id="asistencia-tarjeta" className="text-[1.0625rem] font-semibold">
                            Entradas y salidas
                        </h2>
                        {dias.length === 0 ? (
                            <div className="rounded-[1.25rem] border-2 border-dashed border-foreground/15 px-6 py-10 text-center">
                                <ClipboardCheck className="mx-auto size-8 text-muted-foreground/60" aria-hidden />
                                <p className="mt-2 text-[0.9375rem] text-muted-foreground">Sin registros este mes</p>
                            </div>
                        ) : (
                            <ol className="overflow-hidden rounded-[1.25rem] border border-border/80 bg-card">
                                {dias.map(({ fecha, marcas }) => (
                                    <li
                                        key={fecha.toDateString()}
                                        className="flex items-start gap-4 border-b border-border/60 px-4 py-3.5 last:border-b-0 sm:px-5"
                                    >
                                        <div className="w-14 shrink-0 pt-1">
                                            <p className="text-[0.8125rem] font-semibold capitalize text-muted-foreground">
                                                {fecha.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '')}
                                            </p>
                                            <p className="font-mono text-2xl font-semibold leading-none tabular-nums">
                                                {fecha.getDate()}
                                            </p>
                                        </div>
                                        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                                            {marcas.map((m) => (
                                                <span
                                                    key={m.id}
                                                    className={cn(
                                                        'inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-[0.9375rem]',
                                                        m.action_type === 'clock_in'
                                                            ? 'border-foreground/20 bg-background font-semibold'
                                                            : 'border-border bg-muted/50 text-muted-foreground',
                                                    )}
                                                >
                                                    <span className="text-[0.8125rem] font-medium">
                                                        {m.action_type === 'clock_in' ? 'Entrada' : 'Salida'}
                                                    </span>
                                                    <span className="font-mono tabular-nums text-foreground">{horaDe(m.recorded_at)}</span>
                                                    {m.face_verified && (
                                                        <ScanFace className="size-4 text-emerald-700" aria-label="Con reconocimiento facial" />
                                                    )}
                                                </span>
                                            ))}
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </section>
                </div>
            </div>
        </div>
    )
}

function Contador({
    etiqueta,
    valor,
    tono,
    icono: Icono,
}: {
    etiqueta: string
    valor: number
    tono: 'rojo' | 'ambar' | 'neutro'
    icono: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
}) {
    return (
        <div
            className={cn(
                'rounded-[1.25rem] border px-5 py-4',
                tono === 'rojo' && 'border-red-500/35 bg-red-50 text-red-800',
                tono === 'ambar' && 'border-amber-500/45 bg-amber-50 text-amber-900',
                tono === 'neutro' && 'border-border/80 bg-card',
            )}
        >
            <p className="font-mono text-[2.5rem] font-semibold leading-none tabular-nums">{valor}</p>
            <p className={cn('mt-2 flex items-center gap-1.5 text-[0.9375rem] font-medium', tono === 'neutro' && 'text-muted-foreground')}>
                {tono !== 'neutro' && <Icono className="size-4" aria-hidden />}
                {etiqueta}
            </p>
        </div>
    )
}
