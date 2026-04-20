'use client'

import { AlertTriangle, CalendarClock, CheckCircle2, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DueDateBadgeProps {
    /** YYYY-MM-DD o null. Si null, no muestra nada. */
    dueDate: string | null
    /** Fecha local de referencia YYYY-MM-DD. */
    today: string
    /** Si true, el badge muestra "Pagado" verde. */
    isPaid?: boolean
    className?: string
}

function parseLocalDate(s: string): Date {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function daysBetween(a: Date, b: Date): number {
    const ms = a.getTime() - b.getTime()
    return Math.round(ms / (1000 * 60 * 60 * 24))
}

function formatShort(dueDate: string): string {
    const [, m, d] = dueDate.split('-')
    return `${d}/${m}`
}

/**
 * Badge con color semántico según proximidad al vencimiento.
 * - Pagado: verde sólido con check
 * - Vencido: rojo sólido, icono alerta
 * - Hoy: ámbar pulsante
 * - ≤3 días: amarillo
 * - ≤7 días: azul
 * - Futuro: gris
 */
export function DueDateBadge({ dueDate, today, isPaid, className }: DueDateBadgeProps) {
    if (isPaid) {
        return (
            <span className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30',
                className,
            )}>
                <CheckCircle2 className="size-3" />
                Pagado
            </span>
        )
    }

    if (!dueDate) {
        return (
            <span className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                'bg-muted/60 text-muted-foreground border border-border/60',
                className,
            )}>
                <Clock className="size-3" />
                Sin vencimiento
            </span>
        )
    }

    const due = parseLocalDate(dueDate)
    const now = parseLocalDate(today)
    const diff = daysBetween(due, now)

    let tone: 'overdue' | 'today' | 'soon' | 'upcoming' | 'future'
    let text: string
    let Icon = CalendarClock

    if (diff < 0) {
        tone = 'overdue'
        text = diff === -1 ? 'Venció ayer' : `Venció hace ${-diff}d`
        Icon = AlertTriangle
    } else if (diff === 0) {
        tone = 'today'
        text = 'Vence hoy'
        Icon = AlertTriangle
    } else if (diff <= 3) {
        tone = 'soon'
        text = `En ${diff}d · ${formatShort(dueDate)}`
    } else if (diff <= 7) {
        tone = 'upcoming'
        text = `En ${diff}d · ${formatShort(dueDate)}`
    } else {
        tone = 'future'
        text = formatShort(dueDate)
    }

    const toneClass = {
        overdue: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40',
        today: 'bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/50 animate-pulse',
        soon: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
        upcoming: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
        future: 'bg-muted/60 text-muted-foreground border-border/60',
    }[tone]

    return (
        <span className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
            toneClass,
            className,
        )}>
            <Icon className="size-3" />
            {text}
        </span>
    )
}
