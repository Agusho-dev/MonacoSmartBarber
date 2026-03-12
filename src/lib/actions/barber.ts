'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { StaffStatus } from '@/lib/types/database'

export async function toggleBarberStatus(staffId: string) {
  return { error: 'El estado de los barberos ahora se gestiona mediante el sistema de descansos.' }
}

export async function deactivateBarber(staffId: string) {
  const supabase = createAdminClient()

  const { error: updateError } = await supabase
    .from('staff')
    .update({ is_active: false })
    .eq('id', staffId)

  if (updateError) {
    return { error: 'Error al desactivar barbero: ' + updateError.message }
  }

  const { data: waitingEntries, error: queueError } = await supabase
    .from('queue_entries')
    .select('id')
    .eq('barber_id', staffId)
    .eq('status', 'waiting')
    .eq('is_break', false)

  if (queueError) {
    return { error: 'Barbero desactivado, pero error al reasignar clientes: ' + queueError.message }
  }

  const reassignedCount = waitingEntries?.length ?? 0

  if (reassignedCount > 0) {
    const ids = waitingEntries!.map((e) => e.id)
    const { error: reassignError } = await supabase
      .from('queue_entries')
      .update({ barber_id: null, is_dynamic: true })
      .in('id', ids)

    if (reassignError) {
      return { error: 'Barbero desactivado, pero error al reasignar clientes: ' + reassignError.message }
    }
  }

  // Cancel any break-related ghost entries for the deactivated barber
  await supabase
    .from('queue_entries')
    .update({ status: 'cancelled' })
    .eq('barber_id', staffId)
    .eq('is_break', true)
    .in('status', ['waiting', 'in_progress'])

  revalidatePath('/barbero/cola')
  revalidatePath('/dashboard/cola')
  revalidatePath('/dashboard/barberos')
  revalidatePath('/checkin')
  return { success: true, reassignedCount }
}

export async function activateBarber(staffId: string) {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('staff')
    .update({ is_active: true })
    .eq('id', staffId)

  if (error) {
    return { error: 'Error al activar barbero: ' + error.message }
  }

  revalidatePath('/barbero/cola')
  revalidatePath('/dashboard/cola')
  revalidatePath('/dashboard/barberos')
  revalidatePath('/checkin')
  return { success: true }
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

export async function manageStaffAccess(
  staffId: string,
  email: string,
  password?: string
) {
  const supabase = createAdminClient()

  // 1. Get the current staff to check if they already have an auth_user_id
  const { data: staff, error: fetchError } = await supabase
    .from('staff')
    .select('auth_user_id')
    .eq('id', staffId)
    .single()

  if (fetchError || !staff) {
    return { error: 'Error al buscar el barbero/staff' }
  }

  // 2. We need to check if we are creating a new user or updating an existing one
  if (staff.auth_user_id) {
    // UPDATING EXISTING USER
    const updatePayload: { email: string; password?: string } = { email }
    if (password) {
      updatePayload.password = password
    }

    const { error: updateAuthError } = await supabase.auth.admin.updateUserById(
      staff.auth_user_id,
      updatePayload
    )

    if (updateAuthError) {
      if (updateAuthError.message.includes('already registered')) {
        return { error: 'El email ya está en uso por otra cuenta.' }
      }
      return { error: `Error al actualizar acceso: ${updateAuthError.message}` }
    }

    // Also update the email in the staff table just in case it differs
    await supabase.from('staff').update({ email }).eq('id', staffId)

  } else {
    // CREATING NEW USER
    if (!password) {
      return { error: 'La contraseña es obligatoria para crear un nuevo usuario.' }
    }

    const { data: newUser, error: createAuthError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (createAuthError) {
      if (createAuthError.message.includes('already registered')) {
        return { error: 'El email ya está en uso por otra cuenta.' }
      }
      return { error: `Error al crear acceso: ${createAuthError.message}` }
    }

    if (newUser?.user?.id) {
      // Link the new auth user to the staff profile
      const { error: linkError } = await supabase
        .from('staff')
        .update({
          auth_user_id: newUser.user.id,
          email: email // explicitly update email in staff table too
        })
        .eq('id', staffId)

      if (linkError) {
        // Rollback auth user creation if we couldn't link it
        await supabase.auth.admin.deleteUser(newUser.user.id)
        return { error: 'Error al vincular el acceso con el perfil del staff.' }
      }
    }
  }

  revalidatePath('/dashboard/equipo')

  return { success: true }
}
