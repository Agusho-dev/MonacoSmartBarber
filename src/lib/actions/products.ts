'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { directProductSale } from '@/lib/actions/sales'
import { getCurrentOrgId, validateBranchAccess } from './org'
import { getScopedBranchIds } from './branch-access'

const REVALIDATE_PATH = '/dashboard/servicios'

export async function getProducts(branchId?: string) {
    const supabase = createAdminClient()

    let query = supabase
        .from('products')
        .select('*')
        .order('name')

    if (branchId) {
        // Validar que el branch pertenece a la organización del usuario
        const orgId = await validateBranchAccess(branchId)
        if (!orgId) return { error: 'No autorizado' }
        query = query.eq('branch_id', branchId)
    } else {
        // Sin branchId: filtrar solo productos de branches de la org
        const orgBranchIds = await getScopedBranchIds()
        if (orgBranchIds.length === 0) return { products: [] }
        query = query.in('branch_id', orgBranchIds)
    }

    const { data, error } = await query
    if (error) return { error: error.message }
    return { products: data }
}

export async function upsertProduct(data: {
    id?: string
    branch_id: string | null
    name: string
    cost: number
    sale_price: number
    barber_commission: number
    stock: number | null
}) {
    const supabase = createAdminClient()

    // Validar que el branch_id pertenece a la organización si se proporciona
    if (data.branch_id !== null) {
        const orgId = await validateBranchAccess(data.branch_id)
        if (!orgId) return { error: 'No autorizado' }
    }

    if (data.id) {
        // Validar branch_id ORIGINAL del producto (no el del form)
        const { data: existing } = await supabase
            .from('products')
            .select('branch_id')
            .eq('id', data.id)
            .maybeSingle()

        if (!existing) return { error: 'Producto no encontrado' }

        if (existing.branch_id) {
            const originalOrgId = await validateBranchAccess(existing.branch_id)
            if (!originalOrgId) return { error: 'El producto no pertenece a esta organización' }
        }

        const { error } = await supabase
            .from('products')
            .update({
                name: data.name,
                branch_id: data.branch_id,
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

    revalidatePath(REVALIDATE_PATH)
    return { success: true }
}

export async function toggleProduct(id: string, isActive: boolean) {
    const supabase = createAdminClient()

    // Verificar que el producto pertenece a un branch de la organización
    const { data: product } = await supabase
        .from('products')
        .select('branch_id')
        .eq('id', id)
        .maybeSingle()

    if (!product) return { error: 'Producto no encontrado' }

    if (product.branch_id !== null) {
        const orgId = await validateBranchAccess(product.branch_id)
        if (!orgId) return { error: 'No autorizado' }
    } else {
        const orgId = await getCurrentOrgId()
        if (!orgId) return { error: 'No autorizado' }
    }

    const { error } = await supabase
        .from('products')
        .update({ is_active: isActive })
        .eq('id', id)

    if (error) return { error: error.message }
    revalidatePath(REVALIDATE_PATH)
    return { success: true }
}

export async function deleteProduct(id: string) {
    const supabase = createAdminClient()

    // Verificar que el producto pertenece a un branch de la organización
    const { data: product } = await supabase
        .from('products')
        .select('branch_id')
        .eq('id', id)
        .maybeSingle()

    if (!product) return { error: 'Producto no encontrado' }

    if (product.branch_id !== null) {
        const orgId = await validateBranchAccess(product.branch_id)
        if (!orgId) return { error: 'No autorizado' }
    } else {
        const orgId = await getCurrentOrgId()
        if (!orgId) return { error: 'No autorizado' }
    }

    // Verificar que no tenga ventas asociadas
    const { count } = await supabase
        .from('product_sales')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', id)

    if (count && count > 0) {
        return { error: 'No se puede eliminar el producto porque tiene ventas asociadas. Desactivalo en su lugar.' }
    }

    const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id)

    if (error) return { error: error.message }
    revalidatePath(REVALIDATE_PATH)
    return { success: true }
}

export async function getProductSales(branchId?: string, startDate?: string, endDate?: string) {
    const supabase = createAdminClient()

    let query = supabase
        .from('product_sales')
        .select('*, product:product_id(name), barber:barber_id(full_name)')
        .order('sold_at', { ascending: false })

    if (branchId) {
        // Validar que el branch pertenece a la organización del usuario
        const orgId = await validateBranchAccess(branchId)
        if (!orgId) return { error: 'No autorizado' }
        query = query.eq('branch_id', branchId)
    } else {
        // Sin branchId: filtrar solo ventas de branches de la org
        const orgBranchIds = await getScopedBranchIds()
        if (orgBranchIds.length === 0) return { sales: [] }
        query = query.in('branch_id', orgBranchIds)
    }

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

/**
 * Venta de producto desde el dashboard.
 * Usa directProductSale para crear visita phantom + salary_report + descontar stock.
 */
export async function sellProductFromDashboard(data: {
    product_id: string
    barber_id: string | null
    branch_id: string
    quantity: number
    payment_method: 'cash' | 'transfer' | 'card'
}) {
    return directProductSale(
        data.branch_id,
        data.barber_id,
        data.payment_method,
        [{ id: data.product_id, quantity: data.quantity }],
        null
    )
}

