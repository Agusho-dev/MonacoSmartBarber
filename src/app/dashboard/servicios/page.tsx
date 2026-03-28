import { createAdminClient } from '@/lib/supabase/server'
import { ServiciosClient } from './servicios-client'

export default async function ServiciosPage() {
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
    supabase.from('services').select('*, branch:branches(*)').order('name'),
    supabase
      .from('branches')
      .select('*')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('staff')
      .select('id, full_name, branch_id, is_active')
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('staff_service_commissions')
      .select('*'),
    supabase.from('products').select('*').order('name'),
    supabase
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
