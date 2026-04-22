'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  Building2,
  Sparkles,
  Package,
  MailQuestion,
  TrendingDown,
  Receipt,
  History,
  Shield,
  Menu,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  section?: string
}

const NAV: NavItem[] = [
  { href: '/platform/dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'General' },
  { href: '/platform/organizations', label: 'Organizaciones', icon: Building2, section: 'General' },
  { href: '/platform/plans', label: 'Planes', icon: Sparkles, section: 'Catálogo comercial' },
  { href: '/platform/modules', label: 'Módulos', icon: Package, section: 'Catálogo comercial' },
  { href: '/platform/waitlist', label: 'Waitlist', icon: MailQuestion, section: 'Catálogo comercial' },
  { href: '/platform/usage', label: 'Uso y denials', icon: TrendingDown, section: 'Insights' },
  { href: '/platform/billing-events', label: 'Eventos de pago', icon: Receipt, section: 'Insights' },
  { href: '/platform/actions', label: 'Audit log', icon: History, section: 'Insights' },
]

export function PlatformSidebar({ adminName, adminRole }: { adminName: string; adminRole: string }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const sections = Array.from(new Set(NAV.map(n => n.section ?? 'General')))

  const content = (
    <>
      <div className="flex h-14 items-center gap-3 border-b border-zinc-800 px-5">
        <div className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-purple-500">
          <Shield className="size-4" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">BarberOS</div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 leading-tight">Platform</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {sections.map(section => (
          <div key={section}>
            <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              {section}
            </div>
            <div className="space-y-0.5">
              {NAV.filter(n => (n.section ?? 'General') === section).map(item => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                      isActive
                        ? 'bg-zinc-800 text-zinc-100 font-medium'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
                    )}
                  >
                    <item.icon className={cn('size-4 shrink-0', isActive ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-zinc-300')} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-zinc-800 p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold">
            {adminName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{adminName}</div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-500">{adminRole}</div>
          </div>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-30 flex size-10 items-center justify-center rounded-md bg-zinc-900 text-zinc-300 shadow-lg lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="size-5" />
      </button>

      {/* Desktop */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-zinc-800 bg-zinc-950 lg:flex">
        {content}
      </aside>

      {/* Mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-zinc-800 bg-zinc-950">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              aria-label="Cerrar menú"
            >
              <X className="size-4" />
            </button>
            {content}
          </aside>
        </div>
      )}
    </>
  )
}
