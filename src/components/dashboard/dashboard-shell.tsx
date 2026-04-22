'use client'

import { useState, useTransition, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
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
  MessageSquare,
  Smartphone,
  GripVertical,
  Check,
  ChevronDown,
  Receipt,
  Handshake,
  CalendarClock,
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
import { switchOrganization } from '@/lib/actions/org'
import { EntitlementsProvider, type EntitlementsSnapshot } from '@/components/billing/entitlements-provider'
import { UpgradePromptDialog } from '@/components/billing/upgrade-prompt-dialog'
import { ComingSoonDialog } from '@/components/billing/coming-soon-dialog'
import { TrialBanner } from '@/components/billing/trial-banner'
import { Badge } from '@/components/ui/badge'
import { Lock, Clock as ClockIcon } from 'lucide-react'
import { NAV_FEATURE_MAP } from '@/lib/billing/nav-feature-map'

const navItems = [
  { href: '/dashboard/fila', label: 'Fila', icon: ListOrdered, requiredPermissions: ['queue.view'] },
  { href: '/dashboard/turnos', label: 'Turnos', icon: CalendarClock, requiredPermissions: ['appointments.view'] },
  { href: '/dashboard/sucursales', label: 'Sucursales', icon: Building2, requiredPermissions: ['branches.view'] },
  { href: '/dashboard/equipo', label: 'Equipo', icon: Scissors, requiredPermissions: ['staff.view', 'roles.manage', 'breaks.view', 'incentives.view', 'discipline.view'] },
  { href: '/dashboard/servicios', label: 'Servicios y Productos', icon: Sparkles, requiredPermissions: ['services.view'] },
  { href: '/dashboard/clientes', label: 'Clientes', icon: Users, requiredPermissions: ['clients.view'] },
  { href: '/dashboard/mensajeria', label: 'Mensajería', icon: MessageSquare, requiredPermissions: ['clients.view'] },
  { href: '/dashboard/app-movil', label: 'APP Móvil', icon: Smartphone, requiredPermissions: ['rewards.view'] },
  { href: '/dashboard/convenios', label: 'Convenios', icon: Handshake, requiredPermissions: ['agreements.view'] },
  { href: '/dashboard/estadisticas', label: 'Estadísticas', icon: BarChart3, requiredPermissions: ['stats.view'] },
  { href: '/dashboard/caja', label: 'Caja', icon: Receipt, requiredPermissions: ['finances.view_summary'] },
  { href: '/dashboard/finanzas', label: 'Finanzas', icon: DollarSign, requiredPermissions: ['finances.view', 'salary.view'] },
  { href: '/dashboard/configuracion', label: 'Configuración', icon: Settings, requiredPermissions: ['settings.view'] },
]

// Tipo para cada ítem de navegación
interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  requiredPermissions: string[]
}

type NavLockState = 'unlocked' | 'upgrade' | 'coming_soon'
type NavItemLockMeta = {
  state: NavLockState
  minPlan?: 'start' | 'pro' | 'enterprise'
  moduleId?: string | null
  moduleName?: string
  moduleTeaser?: string | null
  estimatedRelease?: string | null
}

// Props para el componente de ítem sorteable — debe estar fuera de DashboardShell
// para evitar violaciones de las reglas de hooks (hooks dentro de funciones anidadas)
interface SortableNavItemProps {
  item: NavItem
  isActive: boolean
  isEditMode: boolean
  pendingBreakCount: number
  onNavigate: () => void
  lockMeta?: NavItemLockMeta
  onLockedClick?: (item: NavItem, meta: NavItemLockMeta) => void
}

function SortableNavItem({
  item,
  isActive,
  isEditMode,
  pendingBreakCount,
  onNavigate,
  lockMeta,
  onLockedClick,
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

  // Estado bloqueado (upgrade o coming_soon): reemplaza Link por botón que abre modal.
  const isLocked = lockMeta && lockMeta.state !== 'unlocked'

  if (isLocked && onLockedClick) {
    const isComing = lockMeta!.state === 'coming_soon'
    return (
      <div ref={setNodeRef} style={style}>
        <button
          type="button"
          onClick={() => onLockedClick(item, lockMeta!)}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            'text-sidebar-foreground/40 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/60',
            'cursor-pointer text-left',
          )}
          aria-label={`${item.label} — ${isComing ? 'Próximamente' : 'Requiere upgrade'}`}
        >
          <item.icon className="size-4 shrink-0 opacity-70" />
          <span className="flex-1 truncate">{item.label}</span>
          <Badge
            variant={isComing ? 'outline' : 'secondary'}
            className={cn(
              'ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-wide',
              isComing && 'border-amber-500/50 text-amber-500',
            )}
          >
            {isComing ? (
              <><ClockIcon className="mr-1 size-3" /> Pronto</>
            ) : (
              <><Lock className="mr-1 size-3" /> {lockMeta!.minPlan === 'enterprise' ? 'Enterprise' : lockMeta!.minPlan === 'start' ? 'Start' : 'Pro'}</>
            )}
          </Badge>
        </button>
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
  organizationId: string | null
  availableOrganizations: { id: string; name: string; slug: string; logo_url: string | null }[]
  orgLogoUrl: string | null
  children: React.ReactNode
}

function OrgLogo({ url }: { url: string | null }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="size-8 shrink-0 rounded-full object-cover"
      />
    )
  }
  return <Scissors className="size-5 shrink-0" />
}

function SidebarContent({ isEditMode, onToggleEditMode, userRole, userFullName, organizationId, availableOrganizations, orgLogoUrl, children }: SidebarContentProps) {
  const currentOrg = availableOrganizations.find(o => o.id === organizationId)
  
  const handleSwitchOrg = async (orgId: string) => {
    if (orgId === organizationId) return
    const res = await switchOrganization(orgId)
    if (res.success) {
      window.location.reload()
    } else {
      console.error(res.error)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-6">
        {availableOrganizations.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-2 px-0 hover:bg-transparent">
                <OrgLogo url={orgLogoUrl} />
                <span className="truncate text-lg font-bold tracking-tight">
                  {currentOrg?.name || 'BarberOS'}
                </span>
                <ChevronDown className="ml-auto size-4 opacity-50 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-full min-w-[200px]" align="start">
              <DropdownMenuLabel>Organización activa</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableOrganizations.map((org) => (
                <DropdownMenuItem 
                  key={org.id} 
                  onClick={() => handleSwitchOrg(org.id)}
                  className="justify-between cursor-pointer"
                >
                  <span className="truncate pr-4">{org.name}</span>
                  {org.id === organizationId && <Check className="size-4 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <>
            <OrgLogo url={orgLogoUrl} />
            <span className="text-lg font-bold tracking-tight truncate flex-1">
              {currentOrg?.name || 'BarberOS'}
            </span>
          </>
        )}
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
  organizationId: string | null
  availableOrganizations: { id: string; name: string; slug: string; logo_url: string | null }[]
  orgLogoUrl: string | null
  entitlements: EntitlementsSnapshot | null
  visibleModulesMeta?: { moduleId: string; name: string; teaser: string | null; estimatedRelease: string | null; status: 'active'|'beta'|'coming_soon' }[]
  children: React.ReactNode
}

export function DashboardShell({ user, permissions, allowedBranchIds, organizationId, availableOrganizations, orgLogoUrl, entitlements, visibleModulesMeta, children }: DashboardShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isFocusMode =
    pathname.startsWith('/dashboard/mensajeria') && searchParams.get('foco') === '1'
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchStartTime = useRef(0)
  const mainRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const swipeDirectionRef = useRef<'left' | 'right' | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [swipeTargetItem, setSwipeTargetItem] = useState<NavItem | null>(null)
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

  // Mapa de metadatos de módulo por moduleId para el estado coming_soon
  const moduleMetaById = useMemo(() => {
    const map = new Map<string, { name: string; teaser: string | null; estimatedRelease: string | null; status: 'active'|'beta'|'coming_soon' }>()
    for (const m of visibleModulesMeta ?? []) {
      map.set(m.moduleId, { name: m.name, teaser: m.teaser, estimatedRelease: m.estimatedRelease, status: m.status })
    }
    return map
  }, [visibleModulesMeta])

  // Estado de bloqueo por href (basado en entitlements + plan gating)
  const lockStateByHref = useMemo(() => {
    const map = new Map<string, NavItemLockMeta>()
    if (!entitlements) {
      // Sin entitlements: asumimos todo desbloqueado (fallback seguro).
      for (const item of navItems) map.set(item.href, { state: 'unlocked' })
      return map
    }
    for (const item of navItems) {
      const meta = NAV_FEATURE_MAP[item.href]
      if (!meta || !meta.featureKey) {
        map.set(item.href, { state: 'unlocked' })
        continue
      }
      const moduleMeta = meta.moduleId ? moduleMetaById.get(meta.moduleId) : undefined
      if (moduleMeta?.status === 'coming_soon') {
        map.set(item.href, {
          state: 'coming_soon',
          moduleId: meta.moduleId ?? null,
          moduleName: moduleMeta.name,
          moduleTeaser: moduleMeta.teaser,
          estimatedRelease: moduleMeta.estimatedRelease,
        })
        continue
      }
      if (entitlements.features[meta.featureKey] === true) {
        map.set(item.href, { state: 'unlocked' })
      } else {
        map.set(item.href, { state: 'upgrade', minPlan: meta.minPlan ?? 'pro', moduleId: meta.moduleId ?? null })
      }
    }
    return map
  }, [entitlements, moduleMetaById])

  // Ítems filtrados por permisos y ordenados según preferencia del usuario.
  // NO filtramos por entitlements: los items bloqueados se renderizan con lock/badge
  // para incentivar upgrade en lugar de ocultarlos.
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

  // Estado de los modales de upgrade / coming_soon
  const [upgradeModal, setUpgradeModal] = useState<{ open: boolean; featureName: string; minPlan: 'start'|'pro'|'enterprise' }>(
    { open: false, featureName: '', minPlan: 'pro' },
  )
  const [comingSoonModal, setComingSoonModal] = useState<{ open: boolean; moduleId: string; name: string; teaser: string | null; estimatedRelease: string | null }>(
    { open: false, moduleId: '', name: '', teaser: null, estimatedRelease: null },
  )

  const handleLockedClick = useCallback((item: NavItem, meta: NavItemLockMeta) => {
    if (meta.state === 'coming_soon' && meta.moduleId) {
      setComingSoonModal({
        open: true,
        moduleId: meta.moduleId,
        name: meta.moduleName ?? item.label,
        teaser: meta.moduleTeaser ?? null,
        estimatedRelease: meta.estimatedRelease ?? null,
      })
      return
    }
    setUpgradeModal({
      open: true,
      featureName: item.label,
      minPlan: meta.minPlan ?? 'pro',
    })
  }, [])

  const currentNavIndex = useMemo(() => {
    return orderedItems.findIndex(item => pathname.startsWith(item.href))
  }, [orderedItems, pathname])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchStartTime.current = Date.now()
  }, [])

  // Listener nativo para touchmove — necesario para llamar preventDefault()
  // y evitar el scroll vertical mientras se desliza horizontalmente
  useEffect(() => {
    const el = mainRef.current
    if (!el) return

    // Detecta si el elemento tocado (o algún ancestro hasta main) tiene scroll horizontal propio.
    // Esto permite que tab bars y tablas con overflow-x-auto funcionen sin conflicto con el swipe.
    function isHorizontallyScrollable(target: EventTarget | null): boolean {
      let node = target as Element | null
      while (node && node !== el) {
        const ox = window.getComputedStyle(node).overflowX
        if ((ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth) {
          return true
        }
        node = node.parentElement
      }
      return false
    }

    const onMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - touchStartX.current
      const dy = e.touches[0].clientY - touchStartY.current

      // Ignorar gestos verticales y movimientos mínimos
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.5) return

      // No interceptar si el toque proviene de un elemento con scroll horizontal propio
      // (tab bars, tablas, etc.) — dejar que el browser lo maneje
      if (isHorizontallyScrollable(e.target)) return

      const isLeft = dx < 0
      const canGo =
        (isLeft && currentNavIndex < orderedItems.length - 1) ||
        (!isLeft && currentNavIndex > 0)

      if (!canGo) return

      e.preventDefault()

      const W = window.innerWidth

      // Página actual — parallax sutil (25% de la velocidad del dedo)
      if (mainRef.current) {
        mainRef.current.style.transform = `translateX(${dx * 0.25}px)`
      }

      // Panel entrante — se superpone deslizándose desde el borde a velocidad completa
      if (panelRef.current) {
        const rawOffset = isLeft ? W + dx : -W + dx
        const clamped = isLeft ? Math.max(0, rawOffset) : Math.min(0, rawOffset)
        panelRef.current.style.transform = `translateX(${clamped}px)`
        panelRef.current.style.visibility = 'visible'
        panelRef.current.style.boxShadow = isLeft
          ? '-16px 0 48px rgba(0,0,0,0.13)'
          : '16px 0 48px rgba(0,0,0,0.13)'
      }

      // Establecer ítem destino una sola vez por gesto (evita re-renders continuos)
      if (swipeDirectionRef.current === null) {
        swipeDirectionRef.current = isLeft ? 'left' : 'right'
        const target = isLeft
          ? orderedItems[currentNavIndex + 1]
          : orderedItems[currentNavIndex - 1]
        setSwipeTargetItem(target ?? null)
      }
    }

    el.addEventListener('touchmove', onMove, { passive: false })
    return () => el.removeEventListener('touchmove', onMove)
  }, [currentNavIndex, orderedItems])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Si no hubo un swipe horizontal activo, no hacer nada
    if (swipeDirectionRef.current === null) return

    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    const dt = Date.now() - touchStartTime.current

    const W = window.innerWidth
    const isLeft = dx < 0
    const THRESHOLD = W * 0.28                          // 28% del ancho de pantalla
    const isFlick = Math.abs(dx) > 40 && Math.abs(dx) / dt > 0.45  // gesto rápido
    const isValidSwipe =
      (Math.abs(dx) > THRESHOLD || isFlick) &&
      Math.abs(dx) > Math.abs(dy) * 1.5

    const EASE = 'transform 240ms cubic-bezier(0.4, 0, 0.2, 1)'

    if (isValidSwipe) {
      const targetHref = isLeft
        ? orderedItems[currentNavIndex + 1]?.href
        : orderedItems[currentNavIndex - 1]?.href

      // Animar panel para cubrir pantalla
      if (mainRef.current) {
        mainRef.current.style.transition = EASE
        mainRef.current.style.transform = `translateX(${isLeft ? -(W * 0.25) : W * 0.25}px)`
      }
      if (panelRef.current) {
        panelRef.current.style.transition = EASE
        panelRef.current.style.transform = 'translateX(0)'
      }

      // Navegar INMEDIATAMENTE — el panel cubre la pantalla durante la carga de la nueva página
      if (targetHref) router.push(targetHref)

      setTimeout(() => {
        if (mainRef.current) {
          mainRef.current.style.transition = ''
          mainRef.current.style.transform = ''
        }
        if (panelRef.current) {
          panelRef.current.style.visibility = 'hidden'
          panelRef.current.style.transition = ''
          panelRef.current.style.transform = 'translateX(100%)'
          panelRef.current.style.boxShadow = ''
        }
        swipeDirectionRef.current = null
        setSwipeTargetItem(null)
      }, 240)
    } else {
      // Spring-back: volver a la posición original con animación suave
      if (mainRef.current) {
        mainRef.current.style.transition = EASE
        mainRef.current.style.transform = ''
      }
      if (panelRef.current) {
        panelRef.current.style.transition = EASE
        panelRef.current.style.transform = `translateX(${isLeft ? W : -W}px)`
      }

      setTimeout(() => {
        if (mainRef.current) mainRef.current.style.transition = ''
        if (panelRef.current) {
          panelRef.current.style.visibility = 'hidden'
          panelRef.current.style.transition = ''
          panelRef.current.style.boxShadow = ''
        }
        swipeDirectionRef.current = null
        setSwipeTargetItem(null)
      }, 240)
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
              const isActive = pathname.startsWith(item.href)
              const lockMeta = lockStateByHref.get(item.href)
              return (
                <SortableNavItem
                  key={item.href}
                  item={item}
                  isActive={isActive}
                  isEditMode={isEditMode}
                  pendingBreakCount={pendingBreakCount}
                  onNavigate={handleMobileClose}
                  lockMeta={lockMeta}
                  onLockedClick={handleLockedClick}
                />
              )
            })}
          </SortableContext>
        </DndContext>
      </nav>
    )
  }

  return (
    <EntitlementsProvider value={entitlements}>
      {!isFocusMode && <TrialBanner />}
      <UpgradePromptDialog
        open={upgradeModal.open}
        onOpenChange={(open) => setUpgradeModal(p => ({ ...p, open }))}
        featureName={upgradeModal.featureName}
        minPlan={upgradeModal.minPlan}
        currentPlanName={entitlements?.planName}
      />
      <ComingSoonDialog
        open={comingSoonModal.open}
        onOpenChange={(open) => setComingSoonModal(p => ({ ...p, open }))}
        moduleId={comingSoonModal.moduleId}
        name={comingSoonModal.name}
        teaserCopy={comingSoonModal.teaser}
        estimatedRelease={comingSoonModal.estimatedRelease}
      />
    <div className="flex h-screen overflow-hidden">
      <aside
        className={cn(
          'hidden lg:flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          isFocusMode ? 'w-0' : 'w-64'
        )}
      >
        <div className="w-64 h-full shrink-0">
          <SidebarContent
            isEditMode={isEditMode}
            onToggleEditMode={() => setIsEditMode(p => !p)}
            userRole={user.role}
            userFullName={user.full_name}
            organizationId={organizationId}
            availableOrganizations={availableOrganizations}
            orgLogoUrl={orgLogoUrl}
          >
            {renderNavLinks()}
          </SidebarContent>
        </div>
      </aside>

      {!isFocusMode && (
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
              organizationId={organizationId}
              availableOrganizations={availableOrganizations}
              orgLogoUrl={orgLogoUrl}
            >
              {renderNavLinks()}
            </SidebarContent>
          </SheetContent>
        </Sheet>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <header
          className={cn(
            'flex shrink-0 items-center gap-2 lg:gap-4 border-b overflow-hidden transition-[height,opacity,padding] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
            isFocusMode
              ? 'h-0 opacity-0 px-0 border-b-0 pointer-events-none'
              : 'h-12 lg:h-14 opacity-100 px-3 lg:px-6'
          )}
          aria-hidden={isFocusMode}
        >
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden size-9"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </Button>

          <div className="flex items-center gap-2 lg:hidden min-w-0 flex-1">
            <span className="font-semibold text-sm truncate">
              {currentNavIndex >= 0 ? orderedItems[currentNavIndex]?.label : (availableOrganizations.find(o => o.id === organizationId)?.name || 'BarberOS')}
            </span>
          </div>

          <div className="flex-1 hidden lg:block" />

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

        {/* Contenedor de swipe — overflow-hidden recorta el panel entrante */}
        <div className="relative flex-1 overflow-hidden">
          <main
            ref={mainRef}
            className={cn(
              'h-full overflow-y-auto overflow-x-hidden transition-[padding] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
              !isFocusMode && 'p-3 lg:p-6 lg:pb-6'
            )}
            style={{
              paddingBottom: isFocusMode ? 0 : 'calc(4.5rem + env(safe-area-inset-bottom, 0px))',
            }}
            onTouchStart={isFocusMode ? undefined : handleTouchStart}
            onTouchEnd={isFocusMode ? undefined : handleTouchEnd}
          >
            <BranchScopeProvider allowedBranchIds={allowedBranchIds} organizationId={organizationId}>
              {children}
            </BranchScopeProvider>
          </main>

          {/* Panel de sección entrante — solo visible durante el swipe en mobile */}
          <div
            ref={panelRef}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-background lg:hidden"
            style={{ visibility: 'hidden', transform: 'translateX(100%)' }}
            aria-hidden="true"
          >
            {swipeTargetItem && (
              <>
                <div className="rounded-2xl bg-muted p-5 ring-1 ring-border/60">
                  <swipeTargetItem.icon className="size-12 text-foreground/70" />
                </div>
                <p className="text-2xl font-semibold tracking-tight text-foreground">
                  {swipeTargetItem.label}
                </p>
              </>
            )}
          </div>
        </div>
        <MobileBottomNav
          orderedItems={orderedItems}
          currentIndex={currentNavIndex < 0 ? 0 : currentNavIndex}
          hidden={isFocusMode}
        />
      </div>
    </div>
    </EntitlementsProvider>
  )
}
