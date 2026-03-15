import { createClient } from '@/lib/supabase/server'
import { OverviewClient } from './overview-client'
import { redirect } from 'next/navigation'
import { getLocalDayBounds, getLocalNow } from '@/lib/time-utils'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()

  if (!authUser) redirect('/login')

  const { data: staff } = await supabase
    .from('staff')
    .select('role, role_id')
    .eq('auth_user_id', authUser.id)
    .single()

  const isOwnerOrAdmin = ['owner', 'admin'].includes(staff?.role || '')
  let roleData = null
  if (staff?.role_id) {
    const { data: role } = await supabase
      .from('roles')
      .select('permissions')
      .eq('id', staff.role_id)
      .single()
    roleData = role
  }

  const { getEffectivePermissions, PERMISSION_CATEGORIES } = await import('@/lib/permissions')
  const permissions = getEffectivePermissions(
    roleData?.permissions as Record<string, boolean> | undefined,
    isOwnerOrAdmin
  )

  if (!permissions['dashboard.home']) {
    // Find the first available section they CAN access to redirect them
    const navItems = [
      { href: '/dashboard/cola', requiredPermissions: ['queue.view'] },
      { href: '/dashboard/sucursales', requiredPermissions: ['branches.view'] },
      { href: '/dashboard/equipo', requiredPermissions: ['staff.view', 'roles.manage', 'breaks.view', 'incentives.view', 'discipline.view'] },
      { href: '/dashboard/servicios', requiredPermissions: ['services.view'] },
      { href: '/dashboard/clientes', requiredPermissions: ['clients.view'] },
      { href: '/dashboard/fidelizacion', requiredPermissions: ['rewards.view'] },
      { href: '/dashboard/estadisticas', requiredPermissions: ['stats.view'] },
      { href: '/dashboard/finanzas', requiredPermissions: ['finances.view', 'salary.view'] },
      { href: '/dashboard/calendario', requiredPermissions: ['calendar.view'] },
      { href: '/dashboard/configuracion', requiredPermissions: ['settings.view'] },
    ]

    const firstAvailable = navItems.find(item =>
      item.requiredPermissions.some(pred => permissions[pred])
    )

    if (firstAvailable) {
      redirect(firstAvailable.href)
    } else {
      // If they have literally no permissions (not even home), back to login
      redirect('/login')
    }
  }

  const { start: todayStart, end: todayEnd } = getLocalDayBounds()
  const localNow = getLocalNow()
  const monthStartStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-01`

  const [
    { data: todayVisits },
    { data: occupancy },
    { count: newClientsCount },
    { data: recentVisits },
    { data: clientVisitData },
  ] = await Promise.all([
    supabase
      .from('visits')
      .select('*, client:clients(*), barber:staff(*), service:services(*)')
      .gte('completed_at', todayStart)
      .lte('completed_at', todayEnd)
      .order('completed_at', { ascending: false }),
    supabase.from('branch_occupancy').select('*'),
    supabase
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', monthStartStr),
    supabase
      .from('visits')
      .select('*, client:clients(*), barber:staff(*), service:services(*)')
      .order('completed_at', { ascending: false })
      .limit(10),
    supabase
      .from('visits')
      .select('client_id, branch_id, completed_at')
      .gte('completed_at', new Date(localNow.getTime() - 40 * 86400000).toISOString()),
  ])

  return (
    <OverviewClient
      todayVisits={todayVisits ?? []}
      occupancy={occupancy ?? []}
      newClientsCount={newClientsCount ?? 0}
      recentVisits={recentVisits ?? []}
      clientVisitData={clientVisitData ?? []}
    />
  )
}
