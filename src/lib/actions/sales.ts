'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { recordTransfer } from '@/lib/actions/paymentAccounts'

export async function directProductSale(
  branchId: string,
  barberId: string,
  paymentMethod: 'cash' | 'card' | 'transfer',
  productsToSell: { id: string; quantity: number }[],
  paymentAccountId?: string | null
) {
  const supabase = createAdminClient()

  if (!productsToSell || productsToSell.length === 0) {
    return { error: 'No se seleccionaron productos' }
  }

  // 1. Calculate price and commission
  const productIds = productsToSell.map(p => p.id)
  const { data: dbProducts } = await supabase
    .from('products')
    .select('id, sale_price, barber_commission, stock')
    .in('id', productIds)

  if (!dbProducts || dbProducts.length === 0) {
    return { error: 'Productos no encontrados' }
  }

  let amount = 0
  let commissionAmount = 0
  const productSales = []

  for (const p of productsToSell) {
    const dbp = dbProducts.find((x: any) => x.id === p.id)
    if (!dbp) continue
    
    const qty = p.quantity
    const price = Number(dbp.sale_price)
    const comm = Number(dbp.barber_commission)
    
    amount += price * qty
    commissionAmount += comm * qty
    
    // Decrement stock if stock is not null
    if (dbp.stock !== null) {
      await supabase.from('products').update({
        stock: dbp.stock - qty
      }).eq('id', p.id)
    }
  }

  if (amount === 0) {
    return { error: 'Error calculando el monto' }
  }

  // 2. Create a phantom visit for the direct sale to track revenue
  const { data: visit, error: visitError } = await supabase
    .from('visits')
    .insert({
      branch_id: branchId,
      barber_id: barberId,
      amount,
      commission_amount: commissionAmount,
      commission_pct: 0, // It's fixed per product
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

  // 3. Create product sales
  for (const p of productsToSell) {
    const dbp = dbProducts.find((x: any) => x.id === p.id)
    if (!dbp) continue
    const qty = p.quantity
    const price = Number(dbp.sale_price)
    const comm = Number(dbp.barber_commission)

    productSales.push({
      visit_id: visit.id,
      product_id: p.id,
      barber_id: barberId,
      branch_id: branchId,
      quantity: qty,
      unit_price: price,
      commission_amount: comm * qty,
    })
  }

  if (productSales.length > 0) {
    const { error: salesError } = await supabase.from('product_sales').insert(productSales)
    if (salesError) {
      console.error('Error inserting product_sales:', salesError)
      return { error: 'Error al registrar los detalles de los productos' }
    }
  }

  // 4. Handle transfers
  if (paymentMethod === 'transfer' && paymentAccountId) {
    await recordTransfer(visit.id, paymentAccountId, amount, branchId)
  }

  revalidatePath('/barbero/cola')
  revalidatePath('/barbero/facturacion')
  revalidatePath('/barbero/rendimiento')
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/estadisticas')
  revalidatePath('/dashboard/productos')

  return { success: true, visitId: visit.id }
}
