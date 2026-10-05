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
 * Barra inferior del panel.
 *
 * `extremo` es un control que no es una pantalla (hoy, "Pantalla": girar 180° y
 * pantalla completa). En md+ la barra es una grilla 1fr · auto · 1fr: los cinco
 * ítems quedan centrados en la columna del medio, como siempre, y el extremo va
 * en la derecha SIN pisarlos —con la tablet en vertical a 768–800 px, un control
 * anclado con absolute tapaba "Caja"—. Debajo de md las columnas se disuelven
 * (display: contents) y el extremo es un ítem más del reparto.
 */
export function BarberNav({ extremo }: { extremo?: React.ReactNode }) {
    const pathname = usePathname()

    // Nav bar is persistent across all barber routes

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-area-pb">
            <div className="flex items-center justify-around px-2 py-2 md:grid md:grid-cols-[1fr_auto_1fr] md:py-3">
                <div aria-hidden className="hidden md:block" />
                <div className="contents md:flex md:items-center md:justify-center md:gap-8">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                aria-current={isActive ? 'page' : undefined}
                                className={cn(
                                    'flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-colors min-w-[4rem] hover:bg-muted/50',
                                    // Con el ítem extra, en celulares angostos los seis tienen que entrar.
                                    extremo && 'max-[400px]:min-w-0 max-[400px]:px-1.5',
                                    isActive
                                        ? 'text-primary'
                                        : 'text-muted-foreground hover:text-foreground'
                                )}
                            >
                                <item.icon
                                    className={cn('size-5 transition-all', isActive && 'scale-110')}
                                />
                                <span className="leading-none">{item.label}</span>
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
