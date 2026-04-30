'use server'

import { createAdminClient, createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convierte un nombre de organización en un slug URL-safe.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- helper futuro
function generateSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// ---------------------------------------------------------------------------
// Acción principal
// ---------------------------------------------------------------------------

/**
 * Registra una nueva organización junto con su usuario propietario.
 *
 * Pasos:
 *   1. Validar input
 *   2. Verificar que el slug no esté en uso
 *   3. Crear auth user (email confirmado automáticamente)
 *   4. Crear organización
 *   5. Crear organization_members (role: 'owner')
 *   6. Crear staff (role: 'owner')
 *   7. Vincular auth user con organization_id en app_metadata
 *   8. Crear app_settings con valores por defecto
 *   9. Iniciar sesión con el usuario recién creado
 *
 * En caso de error parcial se intenta hacer rollback de los registros creados.
 */
export async function registerOrganization(formData: FormData) {
  const orgName = (formData.get('orgName') as string)?.trim()
  const slug = (formData.get('slug') as string)?.trim()
  const ownerName = (formData.get('ownerName') as string)?.trim()
  const email = (formData.get('email') as string)?.trim()
  const password = formData.get('password') as string

  // Rate limit: 3 orgs por IP cada hora (anti-spam)
  const { RateLimits } = await import('@/lib/rate-limit')
  const gate = await RateLimits.registerOrg()
  if (!gate.allowed) {
    return { success: false, error: 'Demasiados intentos de registro. Intentá más tarde.' }
  }

  // — Validación —
  if (!orgName || orgName.length < 2) {
    return { success: false, error: 'El nombre de la organización debe tener al menos 2 caracteres.' }
  }
  if (!slug || slug.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return { success: false, error: 'El slug solo puede contener letras minúsculas, números y guiones.' }
  }
  if (!ownerName || ownerName.length < 2) {
    return { success: false, error: 'El nombre del propietario debe tener al menos 2 caracteres.' }
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: 'El email no es válido.' }
  }
  if (!password || password.length < 8) {
    return { success: false, error: 'La contraseña debe tener al menos 8 caracteres.' }
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return { success: false, error: 'La contraseña debe tener al menos una letra y un número.' }
  }

  const supabase = createAdminClient()

  // Registrar IDs creados para poder hacer rollback si algo falla
  let createdAuthUserId: string | null = null
  let createdOrgId: string | null = null

  try {
    // 1. Verificar que el slug no esté en uso
    const { data: existingOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()

    if (existingOrg) {
      return { success: false, error: 'El slug ya está en uso. Elegí uno diferente.' }
    }

    // 2. Crear auth user (email confirmado automáticamente)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {},
    })

    if (authError || !authData.user) {
      if (authError?.message.includes('already registered')) {
        return { success: false, error: 'El email ya está registrado en otra cuenta.' }
      }
      console.error('[registerOrganization] Error al crear auth user:', authError)
      return { success: false, error: 'Error al crear el usuario. Intentá de nuevo.' }
    }

    createdAuthUserId = authData.user.id

    // 3. Crear organización
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: orgName,
        slug,
        is_active: true,
        settings: {
          onboarding_completed: false,
          onboarding_step: 0,
        },
      })
      .select('id')
      .single()

    if (orgError || !org) {
      console.error('[registerOrganization] Error al crear organización:', orgError)
      throw new Error('Error al crear la organización.')
    }

    createdOrgId = org.id

    // 4. Crear organization_members (propietario)
    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: org.id,
        user_id: createdAuthUserId,
        role: 'owner',
      })

    if (memberError) {
      console.error('[registerOrganization] Error al crear organization_member:', memberError)
      throw new Error('Error al vincular el usuario con la organización.')
    }

    // 5. Crear perfil de staff (propietario)
    const { error: staffError } = await supabase
      .from('staff')
      .insert({
        organization_id: org.id,
        auth_user_id: createdAuthUserId,
        role: 'owner',
        full_name: ownerName,
        email,
        is_active: true,
      })

    if (staffError) {
      console.error('[registerOrganization] Error al crear staff:', staffError)
      throw new Error('Error al crear el perfil del propietario.')
    }

    // 6. Actualizar app_metadata del auth user con organization_id
    const { error: metaError } = await supabase.auth.admin.updateUserById(createdAuthUserId, {
      app_metadata: { organization_id: org.id },
    })

    if (metaError) {
      console.error('[registerOrganization] Error al actualizar app_metadata:', metaError)
      throw new Error('Error al configurar el contexto de la organización.')
    }

    // 7. Crear app_settings con valores por defecto
    const { error: settingsError } = await supabase
      .from('app_settings')
      .insert({
        organization_id: org.id,
        lost_client_days: 60,
        at_risk_client_days: 30,
        business_hours_open: '09:00',
        business_hours_close: '20:00',
        business_days: [1, 2, 3, 4, 5, 6],
        shift_end_margin_minutes: 35,
        next_client_alert_minutes: 5,
        dynamic_cooldown_seconds: 60,
        review_auto_send: false,
        review_delay_minutes: 30,
        checkin_bg_color: '#3f3f46',
      })

    if (settingsError) {
      console.error('[registerOrganization] Error al crear app_settings:', settingsError)
      throw new Error('Error al crear la configuración inicial.')
    }

    // 7b. Seed defaults (roles, quick_replies, appointment_settings)
    // No rompe el registro si falla — solo log
    const { error: seedError } = await supabase.rpc('seed_new_organization', { p_org_id: org.id })
    if (seedError) {
      console.error('[registerOrganization] Seed defaults falló (no-crítico):', seedError)
    }

    // 7c. Crear suscripción en trial. La org arranca con acceso Pro durante
    // 14 días. Al expirar, el cron /api/cron/expire-trials la baja a 'free'.
    const trialDays = 14
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)
    const { error: subError } = await supabase
      .from('organization_subscriptions')
      .insert({
        organization_id: org.id,
        plan_id: 'pro',
        status: 'trialing',
        billing_cycle: 'monthly',
        currency: 'ARS',
        trial_ends_at: trialEndsAt.toISOString(),
        current_period_start: new Date().toISOString(),
        current_period_end: trialEndsAt.toISOString(),
      })
    if (subError) {
      console.error('[registerOrganization] Error al crear suscripción trial:', subError)
      throw new Error('Error al activar el trial de 14 días.')
    }

    // 8. Iniciar sesión automáticamente con el usuario recién registrado
    const ssrClient = await createClient()
    const { error: signInError } = await ssrClient.auth.signInWithPassword({ email, password })

    if (signInError) {
      console.error('[registerOrganization] Error al iniciar sesión automáticamente:', signInError)
    }

    return { success: true, organizationId: org.id }

  } catch (err: unknown) {
    // — Rollback parcial —
    if (createdOrgId) {
      await supabase.from('organizations').delete().eq('id', createdOrgId)
    }
    if (createdAuthUserId) {
      await supabase.auth.admin.deleteUser(createdAuthUserId)
    }

    const message = err instanceof Error ? err.message : 'Error inesperado al registrar la organización.'
    return { success: false, error: message }
  }
}
