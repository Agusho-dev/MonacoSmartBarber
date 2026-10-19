'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
    ListOrdered,
    Target,
    ClipboardCheck,
    History,
    PiggyBank,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
    { href: '/barbero/fila', label: 'Fila', icon: ListOrdered },
    { href: '/barbero/metas', label: 'Metas', icon: Target },
    { href: '/barbero/asistencia', label: 'Asistencia', icon: ClipboardCheck },
    { href: '/barbero/historial', label: 'Historial', icon: History },
    { href: '/barbero/cerrar-turno', label: 'Caja', icon: PiggyBank },
]

/**
 * Clases de un ítem de la barra. Las comparte "Pantalla" (control-pantalla.tsx),
 * que no es una sección pero vive en la misma barra y tiene que verse igual.
 * El activo es una pastilla grafito llena: se distingue desde la silla, no sólo
 * con el color del texto.
 */
export function claseItemNav(activo: boolean, conExtremo = true) {
    return cn(
        'flex h-[3.75rem] min-w-[4.25rem] flex-col items-center justify-center gap-1 rounded-2xl px-3 text-[0.8125rem] font-semibold leading-none',
        'touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        'motion-safe:transition-[background-color,color,transform] motion-safe:duration-200 motion-safe:active:scale-[0.96]',
        'max-sm:h-14 max-sm:min-w-0 max-sm:flex-1 max-sm:px-1 max-sm:text-[0.6875rem]',
        conExtremo && 'max-[400px]:px-0.5',
        activo
            ? 'bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_oklch(0.2_0.012_260/0.55)]'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )
}

/**
 * Barra inferior del panel.
 *
 * `extremo` es un control que no es una pantalla (hoy, "Pantalla": girar 180° y
 * pantalla completa). En md+ la barra es una grilla 1fr · auto · 1fr: las cinco
 * secciones quedan centradas en la columna del medio y el extremo va a la
 * derecha SIN pisarlas —con la tablet en vertical a 768–800 px, un control
 * anclado con absolute tapaba "Caja"—. Debajo de md las columnas se disuelven
 * (display: contents) y el extremo es un ítem más del reparto.
 */
export function BarberNav({ extremo }: { extremo?: React.ReactNode }) {
    const pathname = usePathname()

    return (
        <nav
            aria-label="Secciones del panel"
            className="fixed inset-x-0 bottom-0 z-50 border-t border-border/80 bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_-22px_oklch(0.2_0.012_260/0.45)]"
        >
            <div className="flex h-[var(--alto-nav)] items-center justify-around gap-1 px-2 md:grid md:grid-cols-[1fr_auto_1fr] md:px-4">
                <div aria-hidden className="hidden md:block" />
                <div className="contents md:flex md:items-center md:justify-center md:gap-2">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                aria-current={isActive ? 'page' : undefined}
                                className={claseItemNav(isActive, !!extremo)}
                            >
                                <item.icon
                                    aria-hidden
                                    strokeWidth={isActive ? 2.25 : 2}
                                    className="size-[1.375rem] max-sm:size-5"
                                />
                                <span>{item.label}</span>
                            </Link>
                        )
                    })}
                </div>
                {extremo && (
                    <div className="contents md:flex md:items-center md:justify-end">
                        {extremo}
                    </div>
                )}
            </div>
        </nav>
    )
}
