'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { StaffStatus } from '@/lib/types/database'

export async function toggleBarberStatus(staffId: string) {
  const supabase = createAdminClient()

  const { data: staff } = await supabase
    .from('staff')
    .select('status')
    .eq('id', staffId)
    .single()

  if (!staff) return { error: 'Barbero no encontrado' }

  const newStatus: StaffStatus = staff.status === 'available' ? 'paused' : 'available'

  const { error } = await supabase
    .from('staff')
    .update({ status: newStatus })
    .eq('id', staffId)

  if (error) return { error: 'Error al cambiar estado' }

  revalidatePath('/barbero/cola')
  return { success: true, status: newStatus }
}

export async function fetchBarberDayStats(staffId: string, branchId: string) {
  const supabase = await createClient()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayISO = today.toISOString()

  const { data: visits } = await supabase
    .from('visits')
    .select('amount')
    .eq('barber_id', staffId)
    .eq('branch_id', branchId)
    .gte('completed_at', todayISO)

  const servicesCount = visits?.length ?? 0
  const revenue = visits?.reduce((sum, v) => sum + Number(v.amount), 0) ?? 0

  return { servicesCount, revenue }
}
