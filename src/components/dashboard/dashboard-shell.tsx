'use client'

import { useState, useTransition, useEffect, useMemo, useCallback, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Scissors,
  Menu,
  LogOut,
  GripVertical,
  Check,
  ChevronDown,
  Lock,
  Clock as ClockIcon,
  CreditCard,
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
import { PestanasEncabezado, esClicQueNavegaAca } from '@/components/dashboard/pestanas-encabezado'
import { ICONOS_NAV } from '@/components/dashboard/iconos-nav'
import { guardarMemoriaNav, leerMemoriaNav, useMemoriaNav } from '@/components/dashboard/memoria-nav'
import { useBranchStore } from '@/stores/branch-store'
import { createClient } from '@/lib/supabase/client'
import { switchOrganization } from '@/lib/actions/org'
import { EntitlementsProvider, type EntitlementsSnapshot } from '@/components/billing/entitlements-provider'
import { UpgradePromptDialog } from '@/components/billing/upgrade-prompt-dialog'
import { ComingSoonDialog } from '@/components/billing/coming-soon-dialog'
import { TrialBanner } from '@/components/billing/trial-banner'
import { Badge } from '@/components/ui/badge'
import {
  claveOrdenGrupos,
  claveOrdenVieja,
  claveUltimasPestanas,
  coincideRuta,
  destinoDeGrupo,
  estaDesbloqueada,
  gruposVisibles,
  moverGrupo,
  ordenarGrupos,
  parsearUltimas,
  recordarUltima,
  resolverOrdenGuardado,
  secuenciaDeslizar,
  tituloFueraDeGrupo,
  ubicacionDeRuta,
  type ContextoPlan,
  type GrupoId,
  type GrupoVisible,
  type PasoDeslizar,
  type PestanaVisible,
} from '@/lib/navegacion/grupos'
import { AiFeatureAnnouncement } from './ai-feature-announcement'
import { TexBotonFlotante } from '@/components/tex/tex-boton-flotante'

// El panel de Tex (atajos ⌘K, abrirTex()) va diferido: no suma peso a la
// carga de cada pantalla. El chat en sí se baja recién al abrirlo.
const TexPanel = dynamic(() => import('@/components/tex/tex-panel').then((m) => m.TexPanel), { ssr: false })

// El menú es de GRUPOS (src/lib/navegacion/grupos.ts): cinco en el menú lateral
// y en la barra inferior del celular; las secciones de antes son las pestañas de
// cada grupo, en el encabezado (pestanas-encabezado.tsx).

// El número va oculto para el lector de pantalla: quien lo usa lo dice entero
// ("3 descansos pendientes", también con más de 99) en un sr-only.
function BadgeDescansos({ cantidad }: { cantidad: number }) {
  return (
    <span aria-hidden className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold tabular-nums text-amber-950">
      {cantidad > 99 ? '99+' : cantidad}
    </span>
  )
}

// Ítem sorteable del menú lateral — debe estar fuera de DashboardShell
// para evitar violaciones de las reglas de hooks (hooks dentro de funciones anidadas)
interface SortableGrupoProps {
  grupo: GrupoVisible
  /** Adónde lleva tocarlo (la última pestaña usada del grupo o la primera). */
  destino: PestanaVisible | null
  isActive: boolean
  isEditMode: boolean
  pendingBreakCount: number
  onNavigate: () => void
  onTocado: (grupo: GrupoId) => void
  onLockedClick: (pestana: PestanaVisible) => void
}

function SortableGrupo({
  grupo,
  destino,
  isActive,
  isEditMode,
  pendingBreakCount,
  onNavigate,
  onTocado,
  onLockedClick,
}: SortableGrupoProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: grupo.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const Icono = ICONOS_NAV[grupo.icono]
  const pendientes = grupo.id === 'equipo' ? pendingBreakCount : 0

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
          aria-label={`Arrastrar para reordenar ${grupo.etiqueta}`}
        >
          <GripVertical className="size-4 shrink-0" />
        </button>
        <Icono className="size-4 shrink-0 text-muted-foreground" />
        <span>{grupo.etiqueta}</span>
        {pendientes > 0 && <BadgeDescansos cantidad={pendientes} />}
      </div>
    )
  }

  if (!destino) return null

  // Todas las pestañas visibles del grupo están "Pronto": el grupo abre el
  // aviso del módulo, como antes lo hacía el ítem del menú.
  if (!estaDesbloqueada(destino)) {
    return (
      <div ref={setNodeRef} style={style}>
        <button
          type="button"
          onClick={() => onLockedClick(destino)}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors max-lg:min-h-11',
            'text-sidebar-foreground/40 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/60',
            'cursor-pointer text-left',
          )}
          aria-label={`${grupo.etiqueta} — Próximamente`}
        >
          <Icono className="size-4 shrink-0 opacity-70" />
          <span className="flex-1 truncate">{grupo.etiqueta}</span>
          <Badge
            variant="outline"
            className="ml-auto shrink-0 border-amber-500/50 text-[10px] font-semibold uppercase tracking-wide text-amber-500"
          >
            <ClockIcon className="mr-1 size-3" /> Pronto
          </Badge>
        </button>
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style}>
      <Link
        href={destino.href}
        onClick={(e) => {
          onNavigate()
          if (esClicQueNavegaAca(e)) onTocado(grupo.id)
        }}
        aria-current={isActive ? 'true' : undefined}
        className={cn(
          // En el menú del celular (la hoja, debajo de lg), 44 px de alto: un
          // objetivo cómodo para el dedo. En la compu queda compacto.
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors max-lg:min-h-11',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
        )}
      >
        <Icono className="size-4 shrink-0" />
        <span className="flex-1 truncate">{grupo.etiqueta}</span>
        {pendientes > 0 && (
          <>
            <BadgeDescansos cantidad={pendientes} />
            <span className="sr-only">
              , {pendientes} {pendientes === 1 ? 'descanso pendiente' : 'descansos pendientes'}
            </span>
          </>
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
      <Image
        src={url}
        alt=""
        width={32}
        height={32}
        className="size-8 shrink-0 rounded-full object-cover"
        unoptimized
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
  // Las rutas se comparan por segmento (coincideRuta): /dashboard/mensajeriax no es Mensajería.
  const isFocusMode =
    coincideRuta('/dashboard/mensajeria', pathname) && searchParams.get('foco') === '1'
  // Tex: quien tiene el módulo de IA y ve estadísticas o configuración (owner y
  // admin tienen todos los permisos). En su propia pantalla no van ni el botón
  // flotante ni el panel: la pantalla ES Tex.
  const puedeUsarTex =
    !!entitlements?.features?.['ai.enabled'] && (!!permissions['stats.view'] || !!permissions['settings.view'])
  const isTexScreen = pathname === '/dashboard/asistente'
  const mostrarPanelTex = puedeUsarTex && !coincideRuta('/dashboard/asistente', pathname)
  const [texPanelAbierto, setTexPanelAbierto] = useState(false)
  // Pantallas de alto completo (modo foco de Mensajería y Tex): sin barra
  // inferior, sin el padding que la compensa y sin swipe entre secciones (en
  // Tex se pisaría con el composer, las tablas y los gráficos). Con la hoja de
  // Tex abierta en el celular tampoco.
  const isFullHeight = isFocusMode || isTexScreen
  const hideBottomNav = isFullHeight || (mostrarPanelTex && texPanelAbierto)
  // El botón flotante de Tex no va en Tex, ni en Mensajería (abajo están su
  // composer y su barra), ni en el modo foco, ni con el panel ya abierto.
  const ocultarBotonTex =
    coincideRuta('/dashboard/asistente', pathname) ||
    coincideRuta('/dashboard/mensajeria', pathname) ||
    isFocusMode ||
    (mostrarPanelTex && texPanelAbierto)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchStartTime = useRef(0)
  const mainRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const swipeDirectionRef = useRef<'left' | 'right' | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [swipeDestino, setSwipeDestino] = useState<PasoDeslizar | null>(null)
  const [, startTransition] = useTransition()
  const [pendingBreakCount, setPendingBreakCount] = useState(0)
  const selectedBranchId = useBranchStore(s => s.selectedBranchId)
  const supabase = useMemo(() => createClient(), [])

  // --- Grupos que ve esta persona (permisos + plan), igual que el menú de antes ---
  const plan = useMemo<ContextoPlan>(
    () => ({ features: entitlements?.features ?? null, modulos: visibleModulesMeta ?? [] }),
    [entitlements, visibleModulesMeta],
  )
  const visibles = useMemo(() => gruposVisibles(permissions, plan), [permissions, plan])

  // --- Orden personalizado y última pestaña de cada grupo, por usuario ---
  // Se leen con useSyncExternalStore (memoria-nav.ts): el servidor y la
  // hidratación usan el orden por defecto y lo guardado llega enseguida.
  const claveOrden = claveOrdenGrupos(user.full_name)
  const claveUltimas = claveUltimasPestanas(user.full_name)
  const crudoOrden = useMemoriaNav(claveOrden)
  // El orden del menú de antes (16 secciones): si nunca se ordenaron los grupos,
  // sale de ahí, para que quien había reordenado no pierda su preferencia.
  const crudoOrdenViejo = useMemoriaNav(claveOrdenVieja(user.full_name))
  const crudoUltimas = useMemoriaNav(claveUltimas)
  const ordenGuardado = useMemo(() => resolverOrdenGuardado(crudoOrden, crudoOrdenViejo), [crudoOrden, crudoOrdenViejo])
  const grupos = useMemo(() => ordenarGrupos(visibles, ordenGuardado), [visibles, ordenGuardado])
  const ultimas = useMemo(() => parsearUltimas(crudoUltimas), [crudoUltimas])
  const destinos = useMemo(
    () => new Map<GrupoId, PestanaVisible | null>(grupos.map((g) => [g.id, destinoDeGrupo(g, ultimas[g.id])])),
    [grupos, ultimas],
  )

  // --- Dónde estamos: grupo y pestaña de la ruta (con los alias) ---
  const ubicacion = useMemo(() => ubicacionDeRuta(pathname), [pathname])
  const grupoActivo = ubicacion ? grupos.find((g) => g.id === ubicacion.grupo.id) ?? null : null
  const pestanaActiva = ubicacion && grupoActivo ? grupoActivo.pestanas.find((p) => p.href === ubicacion.pestana.href) ?? null : null
  const orgNombre = availableOrganizations.find(o => o.id === organizationId)?.name
  const etiquetaActiva = ubicacion?.pestana.etiqueta ?? null
  const tituloMovil = etiquetaActiva ?? tituloFueraDeGrupo(pathname) ?? (orgNombre || 'BarberOS')

  // El grupo tocado (menú lateral o barra inferior) se marca enseguida, sin
  // esperar a que cargue la pantalla; al cambiar la ruta manda otra vez la ruta.
  const [grupoTocado, setGrupoTocado] = useState<GrupoId | null>(null)
  const [rutaDelToque, setRutaDelToque] = useState(pathname)
  if (rutaDelToque !== pathname) {
    setRutaDelToque(pathname)
    setGrupoTocado(null)
  }
  const grupoMarcado = grupoTocado ?? grupoActivo?.id ?? null
  // La barra de grupos tampoco va:
  // - en Mensajería: en el celular la página tiene su propia barra abajo (Inbox,
  //   Difusiones…), que tapaba a la barra vieja y taparía a medias a esta, que es
  //   más alta. Ahí se cambia de grupo con el menú o con las pestañas de arriba;
  // - sin ningún grupo visible (un rol sin secciones): no tendría nada que mostrar.
  const barraOculta = hideBottomNav || coincideRuta('/dashboard/mensajeria', pathname) || grupos.length === 0

  // Recordar la pestaña de cada grupo: tocar el grupo después vuelve a ella.
  // Se lee lo guardado en el momento (no lo del render: al hidratar es null).
  const hrefParaRecordar = pestanaActiva && estaDesbloqueada(pestanaActiva) ? pestanaActiva.href : null
  useEffect(() => {
    if (!hrefParaRecordar) return
    const actuales = parsearUltimas(leerMemoriaNav(claveUltimas))
    const nuevas = recordarUltima(actuales, hrefParaRecordar)
    if (nuevas !== actuales) guardarMemoriaNav(claveUltimas, JSON.stringify(nuevas))
  }, [hrefParaRecordar, claveUltimas])

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

  // Estado de los modales de upgrade / coming_soon
  const [upgradeModal, setUpgradeModal] = useState<{ open: boolean; featureName: string; minPlan: 'start'|'pro'|'enterprise' }>(
    { open: false, featureName: '', minPlan: 'pro' },
  )
  const [comingSoonModal, setComingSoonModal] = useState<{ open: boolean; moduleId: string; name: string; teaser: string | null; estimatedRelease: string | null }>(
    { open: false, moduleId: '', name: '', teaser: null, estimatedRelease: null },
  )

  // Una pestaña (o un grupo entero) en "Pronto" abre el aviso del módulo.
  const handleLockedClick = useCallback((pestana: PestanaVisible) => {
    const meta = pestana.bloqueo
    if (meta.estado === 'coming_soon' && meta.moduleId) {
      setComingSoonModal({
        open: true,
        moduleId: meta.moduleId,
        name: meta.moduleName ?? pestana.etiqueta,
        teaser: meta.moduleTeaser ?? null,
        estimatedRelease: meta.estimatedRelease ?? null,
      })
      return
    }
    setUpgradeModal({
      open: true,
      featureName: pestana.etiqueta,
      minPlan: meta.minPlan ?? 'pro',
    })
  }, [])

  // --- Deslizar en el celular: recorre las pestañas, grupo por grupo ---
  const secuencia = useMemo(() => secuenciaDeslizar(grupos), [grupos])
  const indiceActual = pestanaActiva ? secuencia.findIndex((s) => s.pestana.href === pestanaActiva.href) : -1

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchStartTime.current = Date.now()
  }, [])

  // Listener nativo para touchmove — necesario para llamar preventDefault()
  // y evitar el scroll vertical mientras se desliza horizontalmente
  useEffect(() => {
    const el = mainRef.current
    // Sin el listener: sin un touchstart propio, un touchmove se mediría contra
    // el inicio de un gesto viejo.
    if (!el || hideBottomNav) return

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
      // Gráficos, tablas, carruseles y el composer de Tex se excluyen con
      // `data-sin-swipe`: deslizar sobre ellos no cambia de sección.
      if ((e.target as Element | null)?.closest?.('[data-sin-swipe]')) return

      // Arrastrando una tarjeta (la fila: un cliente hacia un barbero) el dedo
      // va para cualquier lado: no es un gesto de cambiar de sección.
      if (document.documentElement.hasAttribute('data-arrastrando')) return

      const dx = e.touches[0].clientX - touchStartX.current
      const dy = e.touches[0].clientY - touchStartY.current

      // Ignorar gestos verticales y movimientos mínimos
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.5) return

      // No interceptar si el toque proviene de un elemento con scroll horizontal propio
      // (tab bars, tablas, etc.) — dejar que el browser lo maneje
      if (isHorizontallyScrollable(e.target)) return

      // Fuera de las pestañas (Mi cuenta, la suscripción) no hay vecina a la cual ir.
      const isLeft = dx < 0
      const canGo =
        indiceActual >= 0 &&
        ((isLeft && indiceActual < secuencia.length - 1) ||
          (!isLeft && indiceActual > 0))

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

      // Establecer la pestaña destino una sola vez por gesto (evita re-renders continuos)
      if (swipeDirectionRef.current === null) {
        swipeDirectionRef.current = isLeft ? 'left' : 'right'
        setSwipeDestino(secuencia[indiceActual + (isLeft ? 1 : -1)] ?? null)
      }
    }

    el.addEventListener('touchmove', onMove, { passive: false })
    return () => el.removeEventListener('touchmove', onMove)
  }, [indiceActual, secuencia, hideBottomNav])

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
    // Si el gesto terminó siendo un arrastre (empezó a deslizar unos píxeles
    // antes de que la tarjeta se levantara), vuelve a su lugar sin navegar.
    const isValidSwipe =
      !document.documentElement.hasAttribute('data-arrastrando') &&
      (Math.abs(dx) > THRESHOLD || isFlick) &&
      Math.abs(dx) > Math.abs(dy) * 1.5

    const EASE = 'transform 240ms cubic-bezier(0.4, 0, 0.2, 1)'

    if (isValidSwipe) {
      const targetHref = indiceActual >= 0
        ? secuencia[indiceActual + (isLeft ? 1 : -1)]?.pestana.href
        : undefined

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
        setSwipeDestino(null)
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
        setSwipeDestino(null)
      }, 240)
    }
  }, [indiceActual, secuencia, router])

  // "Personalizar orden": se ordenan los GRUPOS, con su propia clave.
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const nuevo = moverGrupo(grupos.map((g) => g.id), ordenGuardado, active.id as GrupoId, over.id as GrupoId)
    guardarMemoriaNav(claveOrden, JSON.stringify(nuevo))
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
      <nav aria-label="Menú principal" className="flex flex-col gap-1 px-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={grupos.map((g) => g.id)} strategy={verticalListSortingStrategy}>
            {grupos.map((grupo) => (
              <SortableGrupo
                key={grupo.id}
                grupo={grupo}
                destino={destinos.get(grupo.id) ?? null}
                isActive={grupoMarcado === grupo.id}
                isEditMode={isEditMode}
                pendingBreakCount={pendingBreakCount}
                onNavigate={handleMobileClose}
                onTocado={setGrupoTocado}
                onLockedClick={handleLockedClick}
              />
            ))}
          </SortableContext>
        </DndContext>
      </nav>
    )
  }

  const IconoDestino = swipeDestino ? ICONOS_NAV[swipeDestino.pestana.icono] : null

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
    {/* --alto-barra-inferior: lo que ocupa la barra inferior del celular (52 px,
        su borde de 1 px y el área segura, como mínimo 4 px; ver
        mobile-bottom-nav.tsx). 0 en la compu y cuando la barra no está. El
        botón flotante de Tex lo usa para quedar arriba de ella. */}
    <div
      className={cn(
        'flex h-screen overflow-hidden',
        barraOculta
          ? '[--alto-barra-inferior:0px]'
          : '[--alto-barra-inferior:calc(3.25rem_+_1px_+_max(0.25rem,env(safe-area-inset-bottom,0px)))] lg:[--alto-barra-inferior:0px]',
      )}
    >
      <AiFeatureAnnouncement
        canUse={puedeUsarTex}
        userKey={user.email}
      />
      {mostrarPanelTex && (
        <TexPanel
          orgNombre={orgNombre || 'tu barbería'}
          puedeConfigurar={!!permissions['settings.manage']}
          puedeConciliacion={!!permissions['conciliacion.view']}
          etiquetaSeccion={etiquetaActiva}
          sinEncabezado={isFocusMode}
          onAbiertoChange={setTexPanelAbierto}
        />
      )}
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
            // Sin descripción: el título alcanza. Sin esto Radix avisa en la consola cada vez que se abre.
            aria-describedby={undefined}
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
        {/* La línea de abajo es una sombra interior y no un borde: así el
            subrayado de la pestaña activa queda justo encima de ella. */}
        <header
          className={cn(
            'flex shrink-0 items-center gap-2 lg:gap-4 overflow-hidden transition-[height,opacity,padding] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
            isFocusMode
              ? 'h-0 opacity-0 px-0 pointer-events-none'
              : 'h-12 lg:h-14 opacity-100 px-3 lg:px-6 shadow-[inset_0_-1px_0_var(--color-border)]'
          )}
          aria-hidden={isFocusMode}
          // Plegado en el modo foco: que el teclado tampoco caiga en sus pestañas.
          inert={isFocusMode}
        >
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden size-9 shrink-0"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir el menú"
          >
            <Menu className="size-5" />
          </Button>

          <PestanasEncabezado
            grupo={grupoActivo}
            activa={pestanaActiva?.href ?? null}
            tituloMovil={tituloMovil}
            onBloqueada={handleLockedClick}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 rounded-full" aria-label="Tu cuenta">
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
              <DropdownMenuItem asChild>
                <Link href="/dashboard/account">
                  <Lock className="size-4" />
                  Mi cuenta
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/billing">
                  <CreditCard className="size-4" />
                  Facturación
                </Link>
              </DropdownMenuItem>
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
              'h-full overflow-y-auto overflow-x-hidden',
              // En Tex el padding cambia de golpe: animado, mientras baja, la
              // pantalla de alto completo desbordaría el <main> y aparecería un scroll.
              !isTexScreen && 'transition-[padding] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
              !isFocusMode && 'p-3 lg:p-6 lg:pb-6'
            )}
            style={{
              // Tex no tiene barra inferior que compensar: queda el padding de
              // las clases, que su pantalla cancela con márgenes negativos.
              paddingBottom: isFocusMode ? 0 : isTexScreen ? undefined : 'calc(4.5rem + env(safe-area-inset-bottom, 0px))',
            }}
            onTouchStart={hideBottomNav ? undefined : handleTouchStart}
            onTouchEnd={hideBottomNav ? undefined : handleTouchEnd}
          >
            <BranchScopeProvider allowedBranchIds={allowedBranchIds} organizationId={organizationId}>
              {children}
            </BranchScopeProvider>
          </main>

          {/* Pestaña entrante — solo visible durante el swipe en mobile */}
          <div
            ref={panelRef}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-background lg:hidden"
            style={{ visibility: 'hidden', transform: 'translateX(100%)' }}
            aria-hidden="true"
          >
            {swipeDestino && IconoDestino && (
              <>
                <div className="rounded-2xl bg-muted p-5 ring-1 ring-border/60">
                  <IconoDestino className="size-12 text-foreground/70" />
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {swipeDestino.grupo.etiqueta}
                  </p>
                  <p className="text-2xl font-semibold tracking-tight text-foreground">
                    {swipeDestino.pestana.etiqueta}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
        <MobileBottomNav
          grupos={grupos}
          grupoMarcado={grupoMarcado}
          destinos={destinos}
          descansosPendientes={pendingBreakCount}
          hidden={barraOculta}
          onTocado={setGrupoTocado}
          onBloqueada={handleLockedClick}
        />
      </div>
      {puedeUsarTex && <TexBotonFlotante oculto={ocultarBotonTex} />}
    </div>
    </EntitlementsProvider>
  )
}
