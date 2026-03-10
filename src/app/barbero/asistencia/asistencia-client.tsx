'use client'

import { ClipboardCheck, AlertTriangle, Clock, LogIn, LogOut } from 'lucide-react'

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

export function AsistenciaClient({ session, attendance }: AsistenciaClientProps) {
    return (
        <div className="min-h-dvh bg-background">
            <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
                <div className="px-4 py-3">
                    <h1 className="font-semibold text-lg">Mi Asistencia</h1>
                    <p className="text-xs text-muted-foreground">{session.full_name} · Este mes</p>
                </div>
            </div>

            <div className="space-y-4 p-4">
                {/* Summary cards */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border bg-card p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="rounded-lg bg-red-500/10 p-2">
                                <AlertTriangle className="size-4 text-red-400" />
                            </div>
                            <span className="text-xs text-muted-foreground">Faltas</span>
                        </div>
                        <p className="text-3xl font-bold tabular-nums">{attendance.absences}</p>
                    </div>
                    <div className="rounded-xl border bg-card p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="rounded-lg bg-yellow-500/10 p-2">
                                <Clock className="size-4 text-yellow-400" />
                            </div>
                            <span className="text-xs text-muted-foreground">Llegadas tarde</span>
                        </div>
                        <p className="text-3xl font-bold tabular-nums">{attendance.lates}</p>
                    </div>
                </div>

                {attendance.absences === 0 && attendance.lates === 0 && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
                        <p className="text-sm text-emerald-300 font-medium">
                            ¡Asistencia perfecta este mes! 🎉
                        </p>
                    </div>
                )}

                {/* Disciplinary events */}
                {attendance.events.length > 0 && (
                    <div>
                        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                            Eventos disciplinarios
                        </h2>
                        <div className="space-y-2">
                            {attendance.events.map((event) => (
                                <div key={event.id} className="rounded-xl border bg-card px-4 py-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <AlertTriangle
                                                className={`size-4 ${event.event_type === 'absence' ? 'text-red-400' : 'text-yellow-400'
                                                    }`}
                                            />
                                            <span className="text-sm font-medium">
                                                {event.event_type === 'absence' ? 'Falta' : 'Tardanza'}
                                            </span>
                                        </div>
                                        <span className="text-xs text-muted-foreground">
                                            {new Date(event.event_date).toLocaleDateString('es-AR', {
                                                day: 'numeric',
                                                month: 'short',
                                            })}
                                        </span>
                                    </div>
                                    {event.notes && (
                                        <p className="text-xs text-muted-foreground mt-1">{event.notes}</p>
                                    )}
                                    {event.consequence_applied && event.consequence_applied !== 'none' && (
                                        <p className="text-xs text-red-400/70 mt-1">
                                            Consecuencia: {event.consequence_applied.replace(/_/g, ' ')}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Attendance log */}
                <div>
                    <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        Registro de entrada/salida
                    </h2>
                    {attendance.logs.length === 0 ? (
                        <div className="rounded-xl border bg-card p-6 text-center text-muted-foreground">
                            <ClipboardCheck className="size-8 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">Sin registros este mes</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {attendance.logs.map((log) => (
                                <div key={log.id} className="rounded-xl border bg-card px-4 py-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {log.action_type === 'clock_in' ? (
                                                <LogIn className="size-4 text-emerald-400" />
                                            ) : (
                                                <LogOut className="size-4 text-blue-400" />
                                            )}
                                            <span className="text-sm font-medium">
                                                {log.action_type === 'clock_in' ? 'Entrada' : 'Salida'}
                                            </span>
                                            {log.face_verified && (
                                                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 rounded-full px-1.5 py-0.5">
                                                    Face ID
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-xs text-muted-foreground tabular-nums">
                                            {new Date(log.recorded_at).toLocaleString('es-AR', {
                                                day: '2-digit',
                                                month: 'short',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
