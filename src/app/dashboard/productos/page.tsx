import { createClient } from '@/lib/supabase/server'
import { ProductosClient } from './productos-client'

export default async function ProductosPage() {
    const supabase = await createClient()

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const [{ data: products }, { data: branches }, { data: sales }, { data: barbers }] =
        await Promise.all([
            supabase.from('products').select('*').order('name'),
            supabase
                .from('branches')
                .select('*')
                .eq('is_active', true)
                .order('name'),
            supabase
                .from('product_sales')
                .select('*, product:product_id(name), barber:barber_id(full_name)')
                .gte('sold_at', startOfMonth)
                .order('sold_at', { ascending: false }),
            supabase
                .from('staff')
                .select('id, full_name, branch_id')
                .eq('role', 'barber')
                .eq('is_active', true)
                .order('full_name'),
        ])

    return (
        <ProductosClient
            products={products ?? []}
            branches={branches ?? []}
            sales={sales ?? []}
            barbers={barbers ?? []}
        />
    )
}
