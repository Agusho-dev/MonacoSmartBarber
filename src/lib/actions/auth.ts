'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function loginWithEmail(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData
) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: error.message }
  }

  return { success: true }
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const cookieStore = await cookies()
  cookieStore.delete('barber_session')
  redirect('/login')
}

export async function loginWithPin(formData: FormData) {
  const supabase = await createClient()
  const staffId = formData.get('staff_id') as string
  const pin = formData.get('pin') as string

  const { data: staff, error } = await supabase
    .from('staff')
    .select('id, pin, full_name, branch_id, role, role_id, organization_id')
    .eq('id', staffId)
    .eq('is_active', true)
    .single()

  if (error || !staff || staff.pin !== pin) {
    return { error: 'PIN incorrecto' }
  }

  const adminSupabase = createAdminClient()

  const { count: faceCount } = await adminSupabase
    .from('staff_face_descriptors')
    .select('*', { count: 'exact', head: true })
    .eq('staff_id', staff.id)

  if (faceCount === null || faceCount === 0) {
    return {
      error: 'Es tu primera vez. Registrá tu rostro en la tablet de check-in antes de ingresar.',
      needsFaceRegistration: true,
    }
  }

  const eighteenHoursAgo = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString()

  const { data: lastLog } = await adminSupabase
    .from('attendance_logs')
    .select('action_type')
    .eq('staff_id', staff.id)
    .gte('recorded_at', eighteenHoursAgo)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!lastLog || lastLog.action_type !== 'clock_in') {
    return {
      error: 'No hiciste el check-in. Registrá tu entrada en la tablet de check-in.',
      needsClockIn: true,
    }
  }

  // Fetch permissions from custom role if exists
  let permissions: Record<string, boolean> = {}
  if (staff.role_id) {
    const { data: customRole } = await supabase
      .from('roles')
      .select('permissions')
      .eq('id', staff.role_id)
      .single()
    if (customRole) {
      permissions = customRole.permissions as Record<string, boolean>
    }
  }

  // Limpiar cualquier sesión de Supabase Auth residual para evitar
  // que getCurrentOrgId() use cookies de Auth en vez de barber_session
  await supabase.auth.signOut()

  const cookieStore = await cookies()
  const session = JSON.stringify({
    staff_id: staff.id,
    full_name: staff.full_name,
    branch_id: staff.branch_id,
    organization_id: staff.organization_id,
    role: staff.role,
    role_id: staff.role_id,
    permissions,
  })

  cookieStore.set('barber_session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 14, // 14 hours
    path: '/',
  })

  redirect('/barbero/fila')
}

export async function getBarberSession() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('barber_session')
  if (!sessionCookie) return null

  let parsed: {
    staff_id: string
    full_name: string
    branch_id: string
    organization_id: string
    role: string
    role_id: string | null
    permissions: Record<string, boolean>
  }

  try {
    parsed = JSON.parse(sessionCookie.value)
  } catch {
    return null
  }

  const supabase = createAdminClient()

  const { data: staff } = await supabase
    .from('staff')
    .select('full_name, branch_id, organization_id, role, role_id, is_active')
    .eq('id', parsed.staff_id)
    .single()

  if (!staff || !staff.is_active) return null

  // Verify barber still has an active clock-in
  const eighteenHoursAgo = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString()
  const { data: lastLog } = await supabase
    .from('attendance_logs')
    .select('action_type')
    .eq('staff_id', parsed.staff_id)
    .gte('recorded_at', eighteenHoursAgo)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!lastLog || lastLog.action_type !== 'clock_in') {
    return null
  }

  let permissions: Record<string, boolean> = {}
  if (staff.role_id) {
    const { data: customRole } = await supabase
      .from('roles')
      .select('permissions')
      .eq('id', staff.role_id)
      .single()
    if (customRole) {
      permissions = customRole.permissions as Record<string, boolean>
    }
  }

  return {
    staff_id: parsed.staff_id,
    full_name: staff.full_name,
    branch_id: staff.branch_id,
    organization_id: staff.organization_id,
    role: staff.role,
    role_id: staff.role_id,
    permissions,
  }
}

export async function verifyBarberPin(staffId: string, pin: string) {
  const supabase = createAdminClient()

  const { data: staff, error } = await supabase
    .from('staff')
    .select('id, pin, full_name, branch_id, role')
    .eq('id', staffId)
    .eq('is_active', true)
    .single()

  if (error || !staff || staff.pin !== pin) {
    return { error: 'PIN incorrecto' }
  }

  return { success: true as const, staffId: staff.id, staffName: staff.full_name }
}

export async function logoutBarber() {
  const cookieStore = await cookies()
  cookieStore.delete('barber_session')
  redirect('/barbero/login')
}
