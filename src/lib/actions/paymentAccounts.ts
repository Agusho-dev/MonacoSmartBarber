'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getPaymentAccounts(branchId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('payment_accounts')
    .select('*')
    .eq('branch_id', branchId)
    .order('name')
  if (error) return { error: error.message, data: null }
  return { data, error: null }
}

export async function upsertPaymentAccount(formData: FormData) {
  const supabase = await createClient()
  const id = formData.get('id') as string | null
  const branchId = formData.get('branch_id') as string
  const name = (formData.get('name') as string).trim()
  const aliasOrCbu = (formData.get('alias_or_cbu') as string | null)?.trim() || null

  if (!branchId || !name) return { error: 'Nombre y sucursal son obligatorios' }

  if (id) {
    const { error } = await supabase
      .from('payment_accounts')
      .update({ name, alias_or_cbu: aliasOrCbu })
      .eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('payment_accounts')
      .insert({ branch_id: branchId, name, alias_or_cbu: aliasOrCbu })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/cuentas')
  return { success: true }
}

export async function togglePaymentAccount(id: string, isActive: boolean) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('payment_accounts')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/cuentas')
  return { success: true }
}

export async function deletePaymentAccount(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('payment_accounts')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/cuentas')
  return { success: true }
}
