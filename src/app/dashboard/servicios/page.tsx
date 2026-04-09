import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId, getOrgBranchIds } from '@/lib/actions/org'
import { redirect } from 'next/navigation'
import { ServiciosClient } from './servicios-client'

export default async function ServiciosPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const branchIds = await getOrgBranchIds()

  const supabase = createAdminClient()

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [
    { data: services },
    { data: branches },
    { data: barbers },
    { data: commissions },
    { data: products },
    { data: productSales },
  ] = await Promise.all([
    branchIds.length > 0
      ? supabase.from('services').select('*, branch:branches(*)').or(`branch_id.in.(${branchIds.join(',')}),branch_id.is.null`).order('name')
      : supabase.from('services').select('*, branch:branches(*)').is('branch_id', null).order('name'),
    supabase
      .from('branches')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('staff')
      .select('id, full_name, branch_id, is_active')
      .eq('organization_id', orgId)
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('staff_service_commissions')
      .select('*, staff!inner(organization_id)')
      .eq('staff.organization_id', orgId),
    branchIds.length > 0
      ? supabase.from('products').select('*').in('branch_id', branchIds).order('name')
      : supabase.from('products').select('*').order('name'),
    branchIds.length > 0
      ? supabase
          .from('product_sales')
          .select('*, product:product_id(name), barber:barber_id(full_name)')
          .in('branch_id', branchIds)
          .gte('sold_at', startOfMonth)
          .order('sold_at', { ascending: false })
      : supabase
          .from('product_sales')
          .select('*, product:product_id(name), barber:barber_id(full_name)')
          .gte('sold_at', startOfMonth)
          .order('sold_at', { ascending: false }),
  ])

  return (
    <ServiciosClient
      services={services ?? []}
      branches={branches ?? []}
      barbers={barbers ?? []}
      commissions={commissions ?? []}
      products={products ?? []}
      productSales={productSales ?? []}
    />
  )
}
