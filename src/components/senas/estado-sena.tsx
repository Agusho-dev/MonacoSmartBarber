'use client'

// =============================================================================
// El vocabulario visual de la seña: cómo se nombra y se pinta cada estado.
//
// Vive en un solo archivo porque los mismos nueve estados los muestran el
// listado, la agenda y la tarjeta de configuración. Escritos tres veces, el día
// que alguien renombre "sin_cupo" quedan dos pantallas diciendo otra cosa sobre
// la misma plata.
//
// Las etiquetas NO son el nombre técnico del estado. "consumida" no significa
// nada para el dueño; "Usada en el corte" sí. Es el mismo problema que tenía el
// `_typeLabel` de la app, que imprimía "spin prize" y "milestone free" en crudo.
// =============================================================================

import {
    AlertTriangle,
    Ban,
    CalendarClock,
    CircleSlash,
    Clock,
    RotateCcw,
    Scissors,
    Wallet,
    type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EstadoSena } from '@/lib/senas/contrato'

export interface DescripcionEstado {
    etiqueta: string
    /** Una línea que explica qué pasó con la plata. */
    ayuda: string
    Icono: LucideIcon
    clases: string
}

export const ESTADOS: Record<EstadoSena, DescripcionEstado> = {
    iniciada: {
        etiqueta: 'Esperando pago',
        ayuda: 'Hay un link de pago abierto. El horario todavía no está reservado.',
        Icono: Clock,
        clases: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    },
    pagada: {
        etiqueta: 'Pagada',
        ayuda: 'La plata está en la cuenta de la sucursal y el turno quedó confirmado.',
        Icono: Wallet,
        clases: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    },
    consumida: {
        etiqueta: 'Usada en el corte',
        ayuda: 'Se imputó al precio del servicio cuando el barbero cobró.',
        Icono: Scissors,
        clases: 'border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300',
    },
    perdida: {
        etiqueta: 'Quedó para el local',
        ayuda: 'Canceló tarde o no vino: la seña no se devuelve y es ingreso del negocio.',
        Icono: CircleSlash,
        clases: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    },
    devuelta: {
        etiqueta: 'Devuelta',
        ayuda: 'Se devolvió por Mercado Pago. La plata salió de la cuenta de la sucursal.',
        Icono: RotateCcw,
        clases: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    },
    sin_cupo: {
        etiqueta: 'Sin cupo · devuelta',
        ayuda: 'Pagó pero otra persona tomó el horario primero. Se devolvió automáticamente.',
        Icono: AlertTriangle,
        clases: 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400',
    },
    rechazada: {
        etiqueta: 'Rechazada',
        ayuda: 'Mercado Pago no aprobó el pago. Nunca entró plata.',
        Icono: Ban,
        clases: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
    },
    expirada: {
        etiqueta: 'Venció sin pagar',
        ayuda: 'El link se venció antes de que el cliente pagara. Nunca entró plata.',
        Icono: CalendarClock,
        clases: 'border-border bg-muted text-muted-foreground',
    },
    cancelada: {
        etiqueta: 'Abandonada',
        ayuda: 'El cliente se volvió atrás antes de pagar. Nunca entró plata.',
        Icono: CircleSlash,
        clases: 'border-border bg-muted text-muted-foreground',
    },
}

export function PastillaEstado({
    estado,
    className,
}: {
    estado: EstadoSena
    className?: string
}) {
    const e = ESTADOS[estado] ?? ESTADOS.iniciada
    const Icono = e.Icono
    return (
        <span
            title={e.ayuda}
            className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5',
                'text-[11px] font-semibold leading-5',
                e.clases,
                className,
            )}
        >
            <Icono className="size-3 shrink-0" />
            {e.etiqueta}
        </span>
    )
}
