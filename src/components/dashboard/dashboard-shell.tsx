'use client'

import { useState, useTransition, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Building2,
  Scissors,
  Sparkles,
  Users,
  BarChart3,
  DollarSign,
  Settings,
  Menu,
  LogOut,
  ListOrdered,
  Gift,
  Coffee,
  Wallet,
  CalendarDays,
  Banknote,
  Trophy,
  AlertTriangle,
  Package,
  MessageSquare,
  Smartphone,
} from 'lucide-react'
import { logout } from '@/lib/actions/auth'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BranchScopeProvider } from '@/components/dashboard/branch-scope-provider'
import { useBranchStore } from '@/stores/branch-store'
import { createClient } from '@/lib/supabase/client'

const navItems = [
  { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard, requiredPermissions: ['dashboard.home'] },
  { href: '/dashboard/cola', label: 'Cola', icon: ListOrdered, requiredPermissions: ['queue.view'] },
  { href: '/dashboard/sucursales', label: 'Sucursales', icon: Building2, requiredPermissions: ['branches.view'] },
  { href: '/dashboard/equipo', label: 'Equipo', icon: Scissors, requiredPermissions: ['staff.view', 'roles.manage', 'breaks.view', 'incentives.view', 'discipline.view'] },
  { href: '/dashboard/servicios', label: 'Servicios', icon: Sparkles, requiredPermissions: ['services.view'] },
  { href: '/dashboard/productos', label: 'Productos', icon: Package, requiredPermissions: ['services.view'] },
  { href: '/dashboard/clientes', label: 'Clientes', icon: Users, requiredPermissions: ['clients.view'] },
  { href: '/dashboard/mensajeria', label: 'Mensajería', icon: MessageSquare, requiredPermissions: ['clients.view'] },
  { href: '/dashboard/fidelizacion', label: 'Fidelización', icon: Gift, requiredPermissions: ['rewards.view'] },
  { href: '/dashboard/app-movil', label: 'APP Móvil', icon: Smartphone, requiredPermissions: ['rewards.view'] },
  { href: '/dashboard/estadisticas', label: 'Estadísticas', icon: BarChart3, requiredPermissions: ['stats.view'] },
  { href: '/dashboard/finanzas', label: 'Finanzas', icon: DollarSign, requiredPermissions: ['finances.view', 'salary.view'] },
  { href: '/dashboard/calendario', label: 'Calendario', icon: CalendarDays, requiredPermissions: ['calendar.view'] },
  { href: '/dashboard/configuracion', label: 'Configuración', icon: Settings, requiredPermissions: ['settings.view'] },
]


interface DashboardShellProps {
  user: { full_name: string; email: string | null; role: string }
  permissions: Record<string, boolean>
  allowedBranchIds: string[] | null
  children: React.ReactNode
}

export function DashboardShell({ user, permissions, allowedBranchIds, children }: DashboardShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [, startTransition] = useTransition()
  const [pendingBreakCount, setPendingBreakCount] = useState(0)
  const { selectedBranchId } = useBranchStore()
  const supabase = useMemo(() => createClient(), [])

  const handleLogout = () => startTransition(() => logout())

  const initials = user.full_name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  // Fetch pending break requests count
  const fetchPendingBreakCount = useCallback(async () => {
    if (!selectedBranchId) { setPendingBreakCount(0); return }
    const { count } = await supabase
      .from('break_requests')
      .select('id', { count: 'exact', head: true })
      .eq('branch_id', selectedBranchId)
      .eq('status', 'pending')
    setPendingBreakCount(count ?? 0)
  }, [supabase, selectedBranchId])

  useEffect(() => {
    fetchPendingBreakCount()
    const channel = supabase
      .channel('dashboard-break-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'break_requests' }, () => {
        fetchPendingBreakCount()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, fetchPendingBreakCount])

  function NavLinks() {
    return (
      <nav className="flex flex-col gap-1 px-3">
        {navItems
          .filter(item => item.requiredPermissions.some(pred => permissions[pred]))
          .map((item) => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                )}
              >
                <item.icon className="size-4 shrink-0" />
                {item.label}
                {item.href === '/dashboard/equipo' && pendingBreakCount > 0 && (
                  <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                    {pendingBreakCount}
                  </span>
                )}
              </Link>
            )
          })}
      </nav>
    )
  }

  function SidebarContent() {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center gap-2 px-6">
          <Scissors className="size-5" />
          <span className="text-lg font-bold tracking-tight">Monaco</span>
        </div>
        <Separator className="bg-sidebar-border" />
        <ScrollArea className="flex-1 py-4">
          <NavLinks />
        </ScrollArea>
        <Separator className="bg-sidebar-border" />
        <div className="p-4">
          <p className="text-xs text-sidebar-foreground/50">
            {user.role === 'owner' ? 'Propietario' : 'Administrador'}
          </p>
          <p className="truncate text-sm font-medium">{user.full_name}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <SidebarContent />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-64 p-0 bg-sidebar text-sidebar-foreground"
          showCloseButton={false}
        >
          <SheetTitle className="sr-only">Menú de navegación</SheetTitle>
          <SidebarContent />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </Button>

          <div className="flex items-center gap-2 lg:hidden">
            <Scissors className="size-4" />
            <span className="font-semibold">Monaco</span>
          </div>

          <div className="flex-1" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <Avatar>
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="text-sm font-medium">{user.full_name}</p>
                {user.email && (
                  <p className="text-xs font-normal text-muted-foreground">
                    {user.email}
                  </p>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="size-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <BranchScopeProvider allowedBranchIds={allowedBranchIds}>
            {children}
          </BranchScopeProvider>
        </main>
      </div>
    </div>
  )
}
