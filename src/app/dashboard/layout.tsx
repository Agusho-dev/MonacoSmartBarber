import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/dashboard/dashboard-shell'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !authUser) {
    redirect('/login')
  }

  const { data: staff, error: staffError } = await supabase
    .from('staff')
    .select('full_name, email, role')
    .eq('auth_user_id', authUser.id)
    .eq('is_active', true)
    .single()

  if (staffError || !staff || !['owner', 'admin'].includes(staff.role)) {
    console.error('Staff lookup failed:', { staffError, authUserId: authUser.id })
    redirect('/login')
  }

  const { data: branches } = await supabase
    .from('branches')
    .select('*')
    .eq('is_active', true)
    .order('name')

  return (
    <DashboardShell
      user={{ full_name: staff.full_name, email: staff.email, role: staff.role }}
      branches={branches ?? []}
    >
      {children}
    </DashboardShell>
  )
}
