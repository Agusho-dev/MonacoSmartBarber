'use client'

import { useState, useTransition, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
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
  CalendarDays,
  Package,
  MessageSquare,
  Smartphone,
  GripVertical,
  Check,
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import { MobileBottomNav } from '@/components/dashboard/mobile-bottom-nav'
import { useBranchStore } from '@/stores/branch-store'
import { createClient } from '@/lib/supabase/client'

const navItems = [
  { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard, requiredPermissions: ['dashboard.home'] },
  { href: '/dashboard/fila', label: 'Fila', icon: ListOrdered, requiredPermissions: ['queue.view'] },
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

// Tipo para cada ítem de navegación
interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  requiredPermissions: string[]
}

// Props para el componente de ítem sorteable — debe estar fuera de DashboardShell
// para evitar violaciones de las reglas de hooks (hooks dentro de funciones anidadas)
interface SortableNavItemProps {
  item: NavItem
  isActive: boolean
  isEditMode: boolean
  pendingBreakCount: number
  onNavigate: () => void
}

function SortableNavItem({
  item,
  isActive,
  isEditMode,
  pendingBreakCount,
  onNavigate,
}: SortableNavItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.href })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  if (isEditMode) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
          'bg-sidebar-accent/30 text-sidebar-foreground/60 select-none',
          isDragging && 'opacity-50 shadow-lg z-50 relative'
        )}
      >
        {/* Manejador de arrastre — objetivo táctil mínimo 44x44px */}
        <button
          {...attributes}
          {...listeners}
          className="touch-none flex items-center justify-center min-w-[44px] min-h-[44px] -ml-2 -my-2 text-muted-foreground hover:text-sidebar-foreground cursor-grab active:cursor-grabbing"
          aria-label={`Arrastrar para reordenar ${item.label}`}
        >
          <GripVertical className="size-4 shrink-0" />
        </button>
        <item.icon className="size-4 shrink-0 text-muted-foreground" />
        <span>{item.label}</span>
        {item.href === '/dashboard/equipo' && pendingBreakCount > 0 && (
          <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
            {pendingBreakCount}
          </span>
        )}
      </div>
    )
  }

  // Modo normal — comportamiento de link igual al original
  return (
    <div ref={setNodeRef} style={style}>
      <Link
        href={item.href}
        onClick={onNavigate}
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
    </div>
  )
}

// FIX 1 — SidebarContent extraído a módulo para evitar remount por nueva referencia en cada render
interface SidebarContentProps {
  isEditMode: boolean
  onToggleEditMode: () => void
  userRole: string
  userFullName: string
  children: React.ReactNode
}

function SidebarContent({ isEditMode, onToggleEditMode, userRole, userFullName, children }: SidebarContentProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-6">
        <Scissors className="size-5" />
        <span className="text-lg font-bold tracking-tight">Monaco</span>
      </div>
      <Separator className="bg-sidebar-border" />
      <ScrollArea className="flex-1 py-4">
        {children}
        {/* Botón para activar/desactivar modo edición de orden */}
        <div className="px-3 pb-2 pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs text-sidebar-foreground/40 hover:text-sidebar-foreground/70"
            onClick={onToggleEditMode}
          >
            {isEditMode ? <Check className="size-3 shrink-0" /> : <GripVertical className="size-3 shrink-0" />}
            {isEditMode ? 'Listo' : 'Personalizar orden'}
          </Button>
        </div>
      </ScrollArea>
      <Separator className="bg-sidebar-border" />
      <div className="p-4">
        <p className="text-xs text-sidebar-foreground/50">
          {userRole === 'owner' ? 'Propietario' : 'Administrador'}
        </p>
        <p className="truncate text-sm font-medium">{userFullName}</p>
      </div>
    </div>
  )
}

interface DashboardShellProps {
  user: { full_name: string; email: string | null; role: string }
  permissions: Record<string, boolean>
  allowedBranchIds: string[] | null
  children: React.ReactNode
}

export function DashboardShell({ user, permissions, allowedBranchIds, children }: DashboardShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchStartTime = useRef(0)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [, startTransition] = useTransition()
  const [pendingBreakCount, setPendingBreakCount] = useState(0)
  const { selectedBranchId } = useBranchStore()
  const supabase = useMemo(() => createClient(), [])

  // --- Estado de ordenamiento personalizado por usuario ---
  const storageKey = `nav-order-${user.full_name}`

  // FIX 3 — Inicializar siempre con el orden por defecto para evitar mismatch de hidratación SSR/cliente.
  // El orden guardado se lee en useEffect, únicamente en el cliente.
  const [navOrder, setNavOrder] = useState<string[]>(() => navItems.map(i => i.href))

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.every((v): v is string => typeof v === 'string')) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setNavOrder(parsed)
        }
      }
    } catch {
      // localStorage no disponible (modo privado, cuota excedida)
    }
  }, [storageKey])

  const [isEditMode, setIsEditMode] = useState(false)

  // --- Sensores dnd-kit: puntero (mouse) + táctil + teclado ---
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Requiere 5px de movimiento antes de activar el arrastre,
      // para no interferir con clics normales
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      // Demora de 250ms en touch para distinguir arrastre de scroll
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Ítems filtrados por permisos y ordenados según preferencia del usuario
  const orderedItems = useMemo(() => {
    const filtered = navItems.filter(item =>
      item.requiredPermissions.some(p => permissions[p])
    )
    return [...filtered].sort((a, b) => {
      const ai = navOrder.indexOf(a.href)
      const bi = navOrder.indexOf(b.href)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }, [navOrder, permissions])

  const currentNavIndex = useMemo(() => {
    return orderedItems.findIndex(item =>
      item.href === '/dashboard'
        ? pathname === '/dashboard'
        : pathname.startsWith(item.href)
    )
  }, [orderedItems, pathname])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchStartTime.current = Date.now()
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX.current
    const deltaY = e.changedTouches[0].clientY - touchStartY.current
    const deltaTime = Date.now() - touchStartTime.current

    const MIN_SWIPE = 60
    const MAX_TIME = 400

    if (
      Math.abs(deltaX) > MIN_SWIPE &&
      Math.abs(deltaX) > Math.abs(deltaY) * 1.8 &&
      deltaTime < MAX_TIME
    ) {
      if (deltaX < 0 && currentNavIndex < orderedItems.length - 1) {
        router.push(orderedItems[currentNavIndex + 1].href)
      } else if (deltaX > 0 && currentNavIndex > 0) {
        router.push(orderedItems[currentNavIndex - 1].href)
      }
    }
  }, [currentNavIndex, orderedItems, router])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = orderedItems.findIndex(i => i.href === active.id)
      const newIndex = orderedItems.findIndex(i => i.href === over.id)
      const newOrder = arrayMove(orderedItems, oldIndex, newIndex).map(i => i.href)
      setNavOrder(newOrder)
      try {
        localStorage.setItem(storageKey, JSON.stringify(newOrder))
      } catch {
        // Ignorar errores de localStorage (modo privado, cuota excedida, etc.)
      }
    }
  }

  // FIX 5 — Callback estable para evitar nuevas closures en cada render
  const handleMobileClose = useCallback(() => setMobileOpen(false), [])

  const handleLogout = () => startTransition(() => logout())

  const initials = user.full_name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  // Obtener conteo de solicitudes de descanso pendientes
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPendingBreakCount()
    const channel = supabase
      .channel('dashboard-break-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'break_requests' }, () => {
        fetchPendingBreakCount()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, fetchPendingBreakCount])

  // FIX 2 — Renombrado a renderNavLinks (minúscula) para que React lo trate como
  // llamada de función plana y no como un componente nuevo en cada render,
  // evitando que DndContext pierda estado durante el arrastre.
  function renderNavLinks() {
    return (
      <nav className="flex flex-col gap-1 px-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedItems.map(i => i.href)} strategy={verticalListSortingStrategy}>
            {orderedItems.map((item) => {
              const isActive =
                item.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(item.href)
              return (
                <SortableNavItem
                  key={item.href}
                  item={item}
                  isActive={isActive}
                  isEditMode={isEditMode}
                  pendingBreakCount={pendingBreakCount}
                  onNavigate={handleMobileClose}
                />
              )
            })}
          </SortableContext>
        </DndContext>
      </nav>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <SidebarContent
          isEditMode={isEditMode}
          onToggleEditMode={() => setIsEditMode(p => !p)}
          userRole={user.role}
          userFullName={user.full_name}
        >
          {renderNavLinks()}
        </SidebarContent>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-64 p-0 bg-sidebar text-sidebar-foreground"
          showCloseButton={false}
        >
          <SheetTitle className="sr-only">Menú de navegación</SheetTitle>
          <SidebarContent
            isEditMode={isEditMode}
            onToggleEditMode={() => setIsEditMode(p => !p)}
            userRole={user.role}
            userFullName={user.full_name}
          >
            {renderNavLinks()}
          </SidebarContent>
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
            <Scissors className="size-4 shrink-0" />
            <span className="font-semibold truncate max-w-[160px]">
              {currentNavIndex >= 0 ? orderedItems[currentNavIndex]?.label : 'Monaco'}
            </span>
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

        <main
          className="flex-1 overflow-y-auto p-4 pb-16 lg:p-6 lg:pb-6"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <BranchScopeProvider allowedBranchIds={allowedBranchIds}>
            {children}
          </BranchScopeProvider>
        </main>
        <MobileBottomNav
          orderedItems={orderedItems}
          currentIndex={currentNavIndex < 0 ? 0 : currentNavIndex}
        />
      </div>
    </div>
  )
}
