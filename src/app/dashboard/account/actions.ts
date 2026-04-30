'use server'

import { createClient } from '@/lib/supabase/server'

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export async function changePassword(
  input: ChangePasswordInput,
): Promise<{ ok: true } | { error: string; message: string }> {
  if (input.newPassword.length < 8) {
    return { error: 'invalid_password', message: 'La contraseña debe tener al menos 8 caracteres' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) {
    return { error: 'unauthorized', message: 'Tenés que iniciar sesión' }
  }

  // Reverificar la contraseña actual antes de cambiarla
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: input.currentPassword,
  })
  if (signInErr) {
    return { error: 'wrong_password', message: 'La contraseña actual es incorrecta' }
  }

  const { error: updErr } = await supabase.auth.updateUser({ password: input.newPassword })
  if (updErr) {
    return { error: 'update_failed', message: updErr.message }
  }

  return { ok: true }
}
