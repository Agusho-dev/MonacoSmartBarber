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

export async function sellProduct(data: {
    product_id: string
    barber_id?: string          // optional: defaults to logged-in staff
    branch_id: string
    quantity: number
    unit_price: number
    commission_amount: number
}) {
    const supabase = await createClient()

    // Resolve seller: use passed barber_id or fall back to current user's staff record
    let sellerId = data.barber_id
    if (!sellerId) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return { error: 'Usuario no autenticado' }
        const { data: staffRow } = await supabase
            .from('staff')
            .select('id')
            .eq('auth_user_id', user.id)
            .maybeSingle()
        if (!staffRow) return { error: 'No se encontró el perfil de staff del usuario actual' }
        sellerId = staffRow.id
    }

    const { error } = await supabase.from('product_sales').insert([{
        product_id: data.product_id,
        barber_id: sellerId,
        branch_id: data.branch_id,
        quantity: data.quantity,
        unit_price: data.unit_price,
        commission_amount: data.commission_amount,
    }])

    if (error) return { error: error.message }

    // Decrement stock if not null
    const { data: product } = await supabase
        .from('products')
        .select('stock')
        .eq('id', data.product_id)
        .single()

    if (product?.stock !== null && product?.stock !== undefined) {
        await supabase
            .from('products')
            .update({ stock: Math.max(0, product.stock - data.quantity) })
            .eq('id', data.product_id)
    }

    revalidatePath('/dashboard/productos')
    return { success: true }
}

