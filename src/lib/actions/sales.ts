'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { recordTransfer } from '@/lib/actions/paymentAccounts'
import { validateBranchAccess } from './org'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Función compartida para procesar venta de productos ────────────────────

export interface ProductSaleItem {
  id: string
  quantity: number
}

export interface ProductSaleResult {
  totalAmount: number
  totalCommission: number
  salesRecords: {
    visit_id: string
    product_id: string
    barber_id: string
    branch_id: string
    quantity: number
    unit_price: number
    commission_amount: number
  }[]
}

/**
 * Procesa la venta de productos: calcula montos, comisiones, descuenta stock
 * e inserta los registros en product_sales.
 * Usada tanto desde completeService (queue.ts) como desde directProductSale.
 */
export async function processProductSales(
  supabase: SupabaseClient,
  visitId: string,
  barberId: string,
  branchId: string,
  productsToSell: ProductSaleItem[]
): Promise<ProductSaleResult | { error: string }> {
  if (!productsToSell || productsToSell.length === 0) {
    return { totalAmount: 0, totalCommission: 0, salesRecords: [] }
  }

  const productIds = productsToSell.map(p => p.id)
  const { data: dbProducts } = await supabase
    .from('products')
    .select('id, sale_price, barber_commission, stock')
    .in('id', productIds)

  if (!dbProducts || dbProducts.length === 0) {
    return { totalAmount: 0, totalCommission: 0, salesRecords: [] }
  }

  let totalAmount = 0
  let totalCommission = 0
  const salesRecords = []

  for (const p of productsToSell) {
    const dbp = dbProducts.find((x: { id: string }) => x.id === p.id)
    if (!dbp) continue

    const qty = p.quantity
    const price = Number(dbp.sale_price)
    const comm = Number(dbp.barber_commission)

    totalAmount += price * qty
    totalCommission += comm * qty

    salesRecords.push({
      visit_id: visitId,
      product_id: p.id,
      barber_id: barberId,
      branch_id: branchId,
      quantity: qty,
      unit_price: price,
      commission_amount: comm * qty,
    })

    // Descontar stock si está trackeado (proteger contra negativos)
    if (dbp.stock !== null) {
      await supabase.from('products').update({
        stock: Math.max(0, dbp.stock - qty)
      }).eq('id', p.id)
    }
  }

  if (salesRecords.length > 0) {
    const { error: salesError } = await supabase.from('product_sales').insert(salesRecords)
    if (salesError) {
      console.error('Error inserting product_sales:', salesError)
      return { error: 'Error al registrar los detalles de los productos' }
    }
  }

  return { totalAmount, totalCommission, salesRecords }
}

// ─── Venta directa de productos (sin cola/servicio) ────────────────────────

export async function directProductSale(
  branchId: string,
  barberId: string,
  paymentMethod: 'cash' | 'card' | 'transfer',
  productsToSell: ProductSaleItem[],
  paymentAccountId?: string | null
) {
  const supabase = createAdminClient()

  // Validar que el branch pertenece a la organización del usuario
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  if (!productsToSell || productsToSell.length === 0) {
    return { error: 'No se seleccionaron productos' }
  }

  // Calcular total para crear la visita fantasma primero
  const productIds = productsToSell.map(p => p.id)
  const { data: dbProducts } = await supabase
    .from('products')
    .select('id, sale_price, barber_commission')
    .in('id', productIds)

  if (!dbProducts || dbProducts.length === 0) {
    return { error: 'Productos no encontrados' }
  }

  let preAmount = 0
  let preCommission = 0
  for (const p of productsToSell) {
    const dbp = dbProducts.find((x: { id: string }) => x.id === p.id)
    if (!dbp) continue
    preAmount += Number(dbp.sale_price) * p.quantity
    preCommission += Number(dbp.barber_commission) * p.quantity
  }

  if (preAmount === 0) {
    return { error: 'Error calculando el monto' }
  }

  // Crear visita fantasma para trackear revenue
  const { data: visit, error: visitError } = await supabase
    .from('visits')
    .insert({
      branch_id: branchId,
      barber_id: barberId,
      amount: preAmount,
      commission_amount: preCommission,
      commission_pct: 0,
      payment_method: paymentMethod,
      payment_account_id: paymentAccountId || null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (visitError || !visit) {
    console.error('Error creating visit for direct sale:', visitError)
    return { error: 'Error al registrar la venta (Visit)' }
  }

  // Procesar productos con la función compartida
  const result = await processProductSales(supabase, visit.id, barberId, branchId, productsToSell)
  if ('error' in result) {
    return { error: result.error }
  }

  // Manejar transferencias
  if (paymentMethod === 'transfer' && paymentAccountId) {
    await recordTransfer(visit.id, paymentAccountId, preAmount, branchId)
  }

  // Actualizar o crear salary_report de comisión para que no se pierda
  // si la venta ocurre después del checkout del barbero
  if (preCommission > 0) {
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
    }).format(new Date())

    const { data: existing } = await supabase
      .from('salary_reports')
      .select('id, amount')
      .eq('staff_id', barberId)
      .eq('branch_id', branchId)
      .eq('type', 'commission')
      .eq('report_date', todayStr)
      .eq('status', 'pending')
      .maybeSingle()

    if (existing) {
      // Sumar la comisión del producto al reporte existente
      await supabase
        .from('salary_reports')
        .update({ amount: Number(existing.amount) + preCommission })
        .eq('id', existing.id)
    } else {
      // Crear reporte nuevo si no existe (barbero ya hizo checkout o no tiene reporte)
      await supabase
        .from('salary_reports')
        .insert({
          staff_id: barberId,
          branch_id: branchId,
          type: 'commission',
          amount: preCommission,
          report_date: todayStr,
          status: 'pending',
          notes: 'Comisión por venta directa de productos',
        })
    }
  }

  revalidatePath('/barbero/fila')
  revalidatePath('/barbero/facturacion')
  revalidatePath('/barbero/rendimiento')
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/estadisticas')
  revalidatePath('/dashboard/servicios')
  revalidatePath('/dashboard/sueldos')

  return { success: true, visitId: visit.id }
}
