'use server'

import { createClient } from '@/lib/supabase/server'
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
    .select('id, pin, full_name, branch_id, role')
    .eq('id', staffId)
    .eq('is_active', true)
    .single()

  if (error || !staff || staff.pin !== pin) {
    return { error: 'PIN incorrecto' }
  }

  const cookieStore = await cookies()
  const session = JSON.stringify({
    staff_id: staff.id,
    full_name: staff.full_name,
    branch_id: staff.branch_id,
    role: staff.role,
  })

  cookieStore.set('barber_session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 14, // 14 hours
    path: '/',
  })

  redirect('/barbero/cola')
}

export async function getBarberSession() {
  const cookieStore = await cookies()
  const session = cookieStore.get('barber_session')
  if (!session) return null
  try {
    return JSON.parse(session.value) as {
      staff_id: string
      full_name: string
      branch_id: string
      role: string
    }
  } catch {
    return null
  }
}

export async function logoutBarber() {
  const cookieStore = await cookies()
  cookieStore.delete('barber_session')
  redirect('/barbero/login')
}
