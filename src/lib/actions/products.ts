'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getProducts(branchId?: string) {
    const supabase = await createClient()

    let query = supabase
        .from('products')
        .select('*')
        .order('name')

    if (branchId) {
        query = query.eq('branch_id', branchId)
    }

    const { data, error } = await query
    if (error) return { error: error.message }
    return { products: data }
}

export async function upsertProduct(data: {
    id?: string
    branch_id: string
    name: string
    cost: number
    sale_price: number
    barber_commission: number
    stock: number | null
}) {
    const supabase = await createClient()

    if (data.id) {
        const { error } = await supabase
            .from('products')
            .update({
                name: data.name,
                cost: data.cost,
                sale_price: data.sale_price,
                barber_commission: data.barber_commission,
                stock: data.stock,
            })
            .eq('id', data.id)

        if (error) return { error: error.message }
    } else {
        const { error } = await supabase.from('products').insert([
            {
                branch_id: data.branch_id,
                name: data.name,
                cost: data.cost,
                sale_price: data.sale_price,
                barber_commission: data.barber_commission,
                stock: data.stock,
            },
        ])

        if (error) return { error: error.message }
    }

    revalidatePath('/dashboard/productos')
    return { success: true }
}

export async function toggleProduct(id: string, isActive: boolean) {
    const supabase = await createClient()
    const { error } = await supabase
        .from('products')
        .update({ is_active: isActive })
        .eq('id', id)

    if (error) return { error: error.message }
    revalidatePath('/dashboard/productos')
    return { success: true }
}

export async function deleteProduct(id: string) {
    const supabase = await createClient()

    // Verify it doesn't have sales
    const { count } = await supabase
        .from('product_sales')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', id)

    if (count && count > 0) {
        return { error: 'No se puede eliminar el producto porque tiene ventas asociadas. Desactívalo en su lugar.' }
    }

    const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id)

    if (error) return { error: error.message }
    revalidatePath('/dashboard/productos')
    return { success: true }
}

export async function getProductSales(branchId: string, startDate?: string, endDate?: string) {
    const supabase = await createClient()

    let query = supabase
        .from('product_sales')
        .select('*, product:product_id(name), barber:barber_id(full_name)')
        .eq('branch_id', branchId)
        .order('sold_at', { ascending: false })

    if (startDate) {
        query = query.gte('sold_at', startDate)
    }
    if (endDate) {
        query = query.lte('sold_at', endDate)
    }

    const { data, error } = await query
    if (error) return { error: error.message }
    return { sales: data }
}
