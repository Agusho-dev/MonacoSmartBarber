'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { StaffStatus } from '@/lib/types/database'
import { getCurrentOrgId } from './org'

export async function toggleBarberStatus(staffId: string) {
  return { error: 'El estado de los barberos ahora se gestiona mediante el sistema de descansos.' }
}

export async function deactivateBarber(staffId: string) {
  const supabase = createAdminClient()

  // Verificar organización para evitar modificar staff de otra org
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  // Proteger servicio en progreso: no permitir desactivar si tiene un corte activo
  const { data: inProgressEntry } = await supabase
    .from('queue_entries')
    .select('id, client_id, branch_id')
    .eq('barber_id', staffId)
    .eq('status', 'in_progress')
    .eq('is_break', false)
    .maybeSingle()

  if (inProgressEntry) {
    // Buscar otro barbero activo en la misma sucursal para reasignar
    const { data: otherBarber } = await supabase
      .from('staff')
      .select('id')
      .eq('branch_id', inProgressEntry.branch_id)
      .eq('role', 'barber')
      .eq('is_active', true)
      .eq('organization_id', orgId)
      .neq('id', staffId)
      .limit(1)
      .maybeSingle()

    if (!otherBarber) {
      return {
        error: 'No se puede desactivar: tiene un servicio en progreso y no hay otro barbero activo para reasignarlo. Finalizá o reasigná el corte primero.',
      }
    }

    // Reasignar el servicio en progreso a otro barbero
    await supabase
      .from('queue_entries')
      .update({ barber_id: otherBarber.id })
      .eq('id', inProgressEntry.id)
  }

  const { error: updateError } = await supabase
    .from('staff')
    .update({ is_active: false })
    .eq('id', staffId)
    .eq('organization_id', orgId)

  if (updateError) {
    return { error: 'Error al desactivar barbero: ' + updateError.message }
  }

  // Reasignar clientes waiting al pool dinámico, preservando priority_order
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

  // Cancelar ghost entries de descanso del barbero desactivado
  await supabase
    .from('queue_entries')
    .update({ status: 'cancelled' })
    .eq('barber_id', staffId)
    .eq('is_break', true)
    .in('status', ['waiting', 'in_progress'])

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/barberos')
  revalidatePath('/checkin')
  return { success: true, reassignedCount }
}

export async function activateBarber(staffId: string) {
  const supabase = createAdminClient()

  // Verificar organización para evitar modificar staff de otra org
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const { error } = await supabase
    .from('staff')
    .update({ is_active: true })
    .eq('id', staffId)
    .eq('organization_id', orgId)

  if (error) {
    return { error: 'Error al activar barbero: ' + error.message }
  }

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/barberos')
  revalidatePath('/checkin')
  return { success: true }
}

export async function toggleBarberVisibility(staffId: string) {
  const supabase = createAdminClient()

  // Verificar organización para evitar modificar staff de otra org
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const { data: staff, error: fetchError } = await supabase
    .from('staff')
    .select('hidden_from_checkin')
    .eq('id', staffId)
    .eq('organization_id', orgId)
    .single()

  if (fetchError || !staff) {
    return { error: 'Error al obtener el estado del barbero.' }
  }

  const newValue = !staff.hidden_from_checkin

  const { error } = await supabase
    .from('staff')
    .update({ hidden_from_checkin: newValue })
    .eq('id', staffId)
    .eq('organization_id', orgId)

  if (error) {
    return { error: 'Error al cambiar visibilidad: ' + error.message }
  }

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  revalidatePath('/checkin')
  return { success: true, hidden: newValue }
}

export async function createStaffMember(data: {
  full_name: string
  branch_id: string | null
  pin: string | null
  role: string
  role_id: string | null
  email: string | null
  phone: string | null
}) {
  const supabase = createAdminClient()
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const { data: inserted, error } = await supabase
    .from('staff')
    .insert({ ...data, organization_id: orgId })
    .select('id')
    .single()

  if (error) {
    return { error: 'Error al crear staff: ' + error.message }
  }

  // Espejar en clients + etiquetar "Staff" (best-effort, no bloquea la creacion)
  if (inserted?.id && data.phone) {
    try {
      const { prepareStaffContact } = await import('./staff-contact')
      await prepareStaffContact(inserted.id)
    } catch (e) {
      console.warn('[createStaffMember] prepareStaffContact fallo:', e)
    }
  }

  revalidatePath('/dashboard/barberos')
  revalidatePath('/dashboard/mensajeria')
  return { success: true, data: inserted }
}

export async function updateStaffMember(staffId: string, data: {
  full_name: string
  branch_id: string | null
  pin: string | null
  role: string
  role_id: string | null
  email: string | null
  phone: string | null
}) {
  const supabase = createAdminClient()
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const { error } = await supabase
    .from('staff')
    .update(data)
    .eq('id', staffId)
    .eq('organization_id', orgId)

  if (error) {
    return { error: 'Error al actualizar staff: ' + error.message }
  }

  // Resincronizar mirror client + etiqueta "Staff" si hay telefono (idempotente).
  if (data.phone) {
    try {
      const { prepareStaffContact } = await import('./staff-contact')
      await prepareStaffContact(staffId)
    } catch (e) {
      console.warn('[updateStaffMember] prepareStaffContact fallo:', e)
    }
  }

  revalidatePath('/dashboard/barberos')
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

export async function fetchBarberDayStats(staffId: string, branchId: string) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { servicesCount: 0, revenue: 0 }

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

export async function fetchBranchAssignmentData(branchId: string) {
  const supabase = createAdminClient()
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  const [dailyRes, lastRes] = await Promise.all([
    supabase
      .from('visits')
      .select('barber_id')
      .eq('branch_id', branchId)
      .gte('completed_at', dayStart.toISOString())
      .not('barber_id', 'is', null),
    supabase
      .from('visits')
      .select('barber_id, completed_at')
      .eq('branch_id', branchId)
      .not('barber_id', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(200),
  ])

  const dailyServiceCounts: Record<string, number> = {}
  for (const v of (dailyRes.data ?? []) as { barber_id: string }[]) {
    dailyServiceCounts[v.barber_id] = (dailyServiceCounts[v.barber_id] || 0) + 1
  }

  const lastCompletedAt: Record<string, string> = {}
  for (const v of (lastRes.data ?? []) as { barber_id: string; completed_at: string }[]) {
    if (!lastCompletedAt[v.barber_id]) {
      lastCompletedAt[v.barber_id] = v.completed_at
    }
  }

  return { dailyServiceCounts, lastCompletedAt }
}

export async function manageStaffAccess(
  staffId: string,
  email: string,
  password?: string
) {
  const supabase = createAdminClient()

  // Verificar organización para evitar modificar staff de otra org
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  // 1. Get the current staff to check if they already have an auth_user_id
  const { data: staff, error: fetchError } = await supabase
    .from('staff')
    .select('auth_user_id')
    .eq('id', staffId)
    .eq('organization_id', orgId)
    .single()

  if (fetchError || !staff) {
    return { error: 'Error al buscar el barbero/staff' }
  }

  // 2. We need to check if we are creating a new user or updating an existing one
  if (staff.auth_user_id) {
    // UPDATING EXISTING USER
    const updatePayload: { email: string; password?: string, app_metadata?: { organization_id: string } } = { 
      email,
      app_metadata: { organization_id: orgId } // sync org id
    }
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
    await supabase.from('staff').update({ email }).eq('id', staffId).eq('organization_id', orgId)

  } else {
    // CREATING NEW USER
    if (!password) {
      return { error: 'La contraseña es obligatoria para crear un nuevo usuario.' }
    }

    const { data: newUser, error: createAuthError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { organization_id: orgId } // ensure correct filtering inside JWT
    })

    if (createAuthError) {
      if (createAuthError.message.includes('already registered')) {
        return { error: 'El email ya está en uso por otra cuenta.' }
      }
      return { error: `Error al crear acceso: ${createAuthError.message}` }
    }

    if (newUser?.user?.id) {
      // Vincular el nuevo usuario de auth con el perfil de staff
      const { error: linkError } = await supabase
        .from('staff')
        .update({
          auth_user_id: newUser.user.id,
          email: email // actualizar email en staff también
        })
        .eq('id', staffId)
        .eq('organization_id', orgId)

      if (linkError) {
        // Revertir creación de auth user si no se pudo vincular
        await supabase.auth.admin.deleteUser(newUser.user.id)
        return { error: 'Error al vincular el acceso con el perfil del staff.' }
      }
    }
  }

  revalidatePath('/dashboard/equipo')

  return { success: true }
}

export async function softDeleteStaff(staffId: string) {
  const supabase = createAdminClient()

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  // Verificar que el staff pertenece a la org
  const { data: staff, error: fetchError } = await supabase
    .from('staff')
    .select('id, is_active')
    .eq('id', staffId)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .single()

  if (fetchError || !staff) {
    return { error: 'No se encontró el miembro del equipo.' }
  }

  // Reasignar clientes en cola si estaba activo
  if (staff.is_active) {
    await supabase
      .from('queue_entries')
      .update({ barber_id: null, is_dynamic: true })
      .eq('barber_id', staffId)
      .eq('status', 'waiting')
      .eq('is_break', false)

    // Cancelar entradas de descanso
    await supabase
      .from('queue_entries')
      .update({ status: 'cancelled' })
      .eq('barber_id', staffId)
      .eq('is_break', true)
      .in('status', ['waiting', 'in_progress'])
  }

  // Soft-delete: marcar como eliminado e inactivo
  const { error } = await supabase
    .from('staff')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', staffId)
    .eq('organization_id', orgId)

  if (error) {
    return { error: 'Error al eliminar: ' + error.message }
  }

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/barberos')
  revalidatePath('/checkin')
  return { success: true }
}

export async function updateBarberAvatar(staffId: string, avatarUrl: string) {
  const supabase = createAdminClient()

  // Verificar organización para evitar modificar staff de otra org
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const { error } = await supabase
    .from('staff')
    .update({ avatar_url: avatarUrl })
    .eq('id', staffId)
    .eq('organization_id', orgId)

  if (error) {
    return { error: 'Error al actualizar el avatar: ' + error.message }
  }

  revalidatePath('/dashboard/barberos')
  return { success: true }
}
