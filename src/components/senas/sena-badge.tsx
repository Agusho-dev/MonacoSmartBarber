'use client'

// =============================================================================
// El distintivo de "este turno ya tiene seña pagada", para la agenda.
//
// Sigue la forma exacta de `TurnoBadge` —mismo tamaño, mismo peso, mismo icono
// a la izquierda— porque las dos aparecen sobre la misma tarjeta y una tercera
// forma de pastilla haría ruido. Lo que cambia es el color: el violeta de
// `TurnoBadge` significa "reservó hora" y el celeste de acá significa "ya pagó".
// Son dos hechos distintos y la agenda tiene que poder mostrarlos juntos.
//
// El monto va en el `title` y no en el texto: en la grilla comprimida la
// tarjeta mide 11px de alto por minuto y no entra "Seña $8.000" sin tapar el
// nombre del cliente, que es lo que el barbero busca primero.
// =============================================================================

import { Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'

export function SenaBadge({
    monto,
    className,
    soloIcono = false,
}: {
    monto: number
    className?: string
    /** Para la tarjeta comprimida de la grilla, donde no entra texto. */
    soloIcono?: boolean
}) {
    const titulo = `Seña pagada: ${formatCurrency(monto)}`
    return (
        <span
            title={titulo}
            aria-label={titulo}
            className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-md border border-sky-500/50 bg-sky-500/20',
                'px-1 py-px text-[10px] font-bold uppercase tracking-wider',
                'text-sky-700 dark:text-sky-200',
                className,
            )}
        >
            <Wallet className="size-3 shrink-0" />
            {!soloIcono && <span>Seña</span>}
        </span>
    )
}
