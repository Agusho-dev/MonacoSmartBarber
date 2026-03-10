'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
    ListOrdered,
    TrendingUp,
    Target,
    ClipboardCheck,
    History,
    Receipt,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
    { href: '/barbero/cola', label: 'Cola', icon: ListOrdered },
    { href: '/barbero/rendimiento', label: 'Stats', icon: TrendingUp },
    { href: '/barbero/metas', label: 'Metas', icon: Target },
    { href: '/barbero/asistencia', label: 'Asistencia', icon: ClipboardCheck },
    { href: '/barbero/historial', label: 'Historial', icon: History },
    { href: '/barbero/facturacion', label: 'Caja', icon: Receipt },
]

export function BarberNav() {
    const pathname = usePathname()

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-area-pb">
            <div className="flex items-center justify-around px-1 py-1">
                {navItems.map((item) => {
                    const isActive = pathname === item.href
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                'flex flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors min-w-[3.5rem]',
                                isActive
                                    ? 'text-primary'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <item.icon
                                className={cn(
                                    'size-5 transition-all',
                                    isActive && 'scale-110'
                                )}
                            />
                            <span className="leading-none">{item.label}</span>
                        </Link>
                    )
                })}
            </div>
        </nav>
    )
}
