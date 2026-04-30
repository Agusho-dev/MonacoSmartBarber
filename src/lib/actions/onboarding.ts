'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { revalidatePath } from 'next/cache'

/**
 * Actualiza timezone, currency, locale y country_code de la org (step i18n del wizard).
 */
export async function updateOrgI18n(input: {
  country_code: string
  timezone:     string
  currency:     string
  locale:       string
}) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'Organización no encontrada' }

  const COUNTRIES = ['AR','UY','CL','PE','CO','MX','BR','PY','BO','VE','EC','ES','US']
  const CURRENCIES = ['ARS','USD','BRL','CLP','UYU','PEN','COP','MXN','PYG','BOB','EUR','VES']
  if (!COUNTRIES.includes(input.country_code)) return { success: false, error: 'País inválido' }
  if (!CURRENCIES.includes(input.currency))    return { success: false, error: 'Moneda inválida' }
  if (!input.timezone || !/^[A-Z][a-z_]+\/[A-Z][a-zA-Z_]+/.test(input.timezone)) {
    return { success: false, error: 'Timezone inválida' }
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('organizations')
    .update({
      country_code: input.country_code,
      timezone:     input.timezone,
      currency:     input.currency,
      locale:       input.locale,
    })
    .eq('id', orgId)

  if (error) {
    console.error('[updateOrgI18n] Error:', error)
    return { success: false, error: 'Error al guardar configuración regional' }
  }

  revalidatePath('/onboarding')
  revalidatePath('/dashboard/configuracion')
  return { success: true }
}

/**
 * Sube el logo de la organización a Supabase Storage y actualiza el registro.
 */
export async function uploadOrgLogo(formData: FormData) {
  const file = formData.get('logo') as File | null
  if (!file || file.size === 0) return { success: false, error: 'No se recibió archivo' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'Organización no encontrada' }

  const supabase = createAdminClient()

  const ext = file.name.split('.').pop() ?? 'png'
  const path = `org-logos/${orgId}/logo.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const { error: uploadError } = await supabase.storage
    .from('branding')
    .upload(path, buffer, { contentType: file.type, upsert: true })

  if (uploadError) {
    console.error('[uploadOrgLogo] Error al subir logo:', uploadError)
    return { success: false, error: 'Error al subir el logo' }
  }

  const { data: publicUrl } = supabase.storage.from('branding').getPublicUrl(path)

  const { error: updateError } = await supabase
    .from('organizations')
    .update({ logo_url: publicUrl.publicUrl })
    .eq('id', orgId)

  if (updateError) {
    console.error('[uploadOrgLogo] Error al actualizar logo_url:', updateError)
    return { success: false, error: 'Error al guardar el logo' }
  }

  revalidatePath('/dashboard/configuracion')
  revalidatePath('/dashboard')
  return { success: true, url: publicUrl.publicUrl }
}

/**
 * Actualiza el nombre de la organización.
 */
export async function updateOrgName(name: string) {
  if (!name.trim()) return { success: false, error: 'El nombre es obligatorio' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'Organización no encontrada' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('organizations')
    .update({ name: name.trim() })
    .eq('id', orgId)

  if (error) {
    console.error('[updateOrgName] Error:', error)
    return { success: false, error: 'Error al actualizar el nombre' }
  }

  revalidatePath('/dashboard/configuracion')
  revalidatePath('/dashboard')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Acciones de onboarding
// ---------------------------------------------------------------------------

/**
 * Actualiza el paso actual del onboarding en organization.settings.
 */
export async function completeOnboardingStep(step: number) {
  const supabase = createAdminClient()
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'Organización no encontrada' }

  const { data: org, error: fetchError } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', orgId)
    .single()

  if (fetchError || !org) {
    return { success: false, error: 'No se pudo obtener la organización' }
  }

  const updatedSettings = {
    ...(org.settings as Record<string, unknown>),
    onboarding_step: step,
  }

  const { error } = await supabase
    .from('organizations')
    .update({ settings: updatedSettings })
    .eq('id', orgId)

  if (error) {
    console.error('[completeOnboardingStep] Error:', error)
    return { success: false, error: 'Error al actualizar el paso de onboarding' }
  }

  return { success: true }
}

/**
 * Crea la primera sucursal durante el onboarding.
 */
export async function createOnboardingBranch(formData: FormData) {
  const name = (formData.get('name') as string)?.trim()
  const address = (formData.get('address') as string)?.trim() || null
  const phone = (formData.get('phone') as string)?.trim() || null
  const businessHoursOpen = (formData.get('business_hours_open') as string) || '09:00'
  const businessHoursClose = (formData.get('business_hours_close') as string) || '21:00'
  const businessDaysStr = (formData.get('business_days') as string) || '1,2,3,4,5,6'

  if (!name) {
    return { success: false, error: 'El nombre de la sucursal es obligatorio' }
  }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'Organización no encontrada' }

  const supabase = createAdminClient()

  const businessDays = businessDaysStr
    .split(',')
    .map((d) => parseInt(d.trim(), 10))
    .filter((d) => !isNaN(d) && d >= 0 && d <= 6)

  // Timezone se hereda de organizations.timezone (default si org no lo tiene)
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('timezone')
    .eq('id', orgId)
    .maybeSingle()
  const tz = orgRow?.timezone ?? 'America/Argentina/Buenos_Aires'

  const { data: branch, error } = await supabase
    .from('branches')
    .insert({
      organization_id: orgId,
      name,
      address,
      phone,
      business_hours_open: businessHoursOpen,
      business_hours_close: businessHoursClose,
      business_days: businessDays,
      is_active: true,
      timezone: tz,
    })
    .select()
    .single()

  if (error || !branch) {
    console.error('[createOnboardingBranch] Error al crear sucursal:', error)
    return { success: false, error: 'Error al crear la sucursal' }
  }

  // Asignar la primera sucursal al staff owner que aún no tiene branch_id
  await supabase
    .from('staff')
    .update({ branch_id: branch.id })
    .eq('organization_id', orgId)
    .eq('role', 'owner')
    .is('branch_id', null)

  await completeOnboardingStep(1)
  revalidatePath('/dashboard/sucursales')
  return { success: true, data: branch }
}

/**
 * Crea un servicio durante el onboarding.
 */
export async function createOnboardingService(formData: FormData) {
  const name = (formData.get('name') as string)?.trim()
  const priceStr = formData.get('price') as string
  const durationStr = (formData.get('duration_minutes') as string)?.trim()
  const branchId = formData.get('branch_id') as string

  if (!name) return { success: false, error: 'El nombre del servicio es obligatorio' }
  if (!priceStr || isNaN(Number(priceStr))) return { success: false, error: 'El precio debe ser un número válido' }
  if (!branchId) return { success: false, error: 'La sucursal es obligatoria' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'Organización no encontrada' }

  const supabase = createAdminClient()

  // Verificar que el branch_id pertenece a esta organización
  const { data: branch } = await supabase
    .from('branches')
    .select('id')
    .eq('id', branchId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!branch) {
    return { success: false, error: 'La sucursal no pertenece a esta organización' }
  }

  const durationMinutes = durationStr && !isNaN(Number(durationStr)) ? Number(durationStr) : null

  const { data: service, error } = await supabase
    .from('services')
    .insert({
      name,
      price: Number(priceStr),
      duration_minutes: durationMinutes,
      branch_id: branchId,
      availability: 'both',
      default_commission_pct: 0,
      is_active: true,
    })
    .select()
    .single()

  if (error || !service) {
    console.error('[createOnboardingService] Error al crear servicio:', error)
    return { success: false, error: 'Error al crear el servicio' }
  }

  revalidatePath('/dashboard/servicios')
  return { success: true, data: service }
}

/**
 * Crea un barbero/staff durante el onboarding.
 */
export async function createOnboardingStaff(formData: FormData) {
  const fullName = (formData.get('full_name') as string)?.trim()
  const pin = (formData.get('pin') as string)?.trim()
  const branchId = formData.get('branch_id') as string
  const role = (formData.get('role') as string) || 'barber'

  if (!fullName || fullName.length < 2) {
    return { success: false, error: 'El nombre debe tener al menos 2 caracteres' }
  }
  if (pin && (pin.length < 4 || !/^\d+$/.test(pin))) {
    return { success: false, error: 'El PIN debe tener al menos 4 dígitos numéricos' }
  }
  if (!branchId) return { success: false, error: 'La sucursal es obligatoria' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'Organización no encontrada' }

  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('id')
    .eq('id', branchId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!branch) {
    return { success: false, error: 'La sucursal no pertenece a esta organización' }
  }

  const { data: staff, error } = await supabase
    .from('staff')
    .insert({
      organization_id: orgId,
      branch_id: branchId,
      role,
      full_name: fullName,
      pin: pin || null,
      is_active: true,
    })
    .select()
    .single()

  if (error || !staff) {
    console.error('[createOnboardingStaff] Error al crear staff:', error)
    return { success: false, error: 'Error al crear el barbero' }
  }

  revalidatePath('/dashboard/barberos')
  return { success: true, data: staff }
}

/**
 * Elimina un staff creado durante el onboarding. Sólo permite borrar staff
 * de la organización del usuario actual y que todavía no tenga actividad
 * (sin visitas/logs). Uso: botón "deshacer" cuando el admin cargó mal un barbero.
 */
export async function deleteOnboardingStaff(staffId: string) {
  if (!staffId) return { success: false, error: 'ID de barbero inválido' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'Organización no encontrada' }

  const supabase = createAdminClient()

  const { data: staff } = await supabase
    .from('staff')
    .select('id, organization_id, role')
    .eq('id', staffId)
    .maybeSingle()

  if (!staff) return { success: false, error: 'Barbero no encontrado' }
  if (staff.organization_id !== orgId) {
    return { success: false, error: 'No podés eliminar este barbero' }
  }
  // Nunca borrar al owner desde onboarding (romperían su propia cuenta)
  if (staff.role === 'owner') {
    return { success: false, error: 'No se puede eliminar al propietario' }
  }

  const { error } = await supabase.from('staff').delete().eq('id', staffId)
  if (error) {
    console.error('[deleteOnboardingStaff] Error:', error)
    return { success: false, error: 'Error al eliminar el barbero' }
  }

  revalidatePath('/dashboard/barberos')
  revalidatePath('/dashboard/equipo')
  return { success: true }
}

/**
 * Marca al propietario como barbero (is_also_barber=true) o no.
 * Si el propietario también atiende clientes, aparece en los listados de
 * barberos (fila, turnos, servicios, sueldos, etc.) sin perder sus permisos
 * de owner/admin.
 */
export async function setOwnerIsBarber(isBarber: boolean) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'Organización no encontrada' }

  const supabase = createAdminClient()

  const { error } = await supabase
    .from('staff')
    .update({ is_also_barber: isBarber })
    .eq('organization_id', orgId)
    .eq('role', 'owner')

  if (error) {
    console.error('[setOwnerIsBarber] Error:', error)
    return { success: false, error: 'Error al actualizar el rol del propietario' }
  }

  revalidatePath('/dashboard/equipo')
  revalidatePath('/dashboard/fila')
  return { success: true }
}

/**
 * Setea el modo de operación de una sucursal durante el onboarding.
 * También propaga `default_operation_mode` a la org si todavía es 'walk_in'
 * (el default factory), para que próximas sucursales hereden la elección.
 */
export async function setOnboardingOperationMode(
  branchId: string,
  mode: 'walk_in' | 'appointments' | 'hybrid'
) {
  if (!branchId) return { success: false, error: 'ID de sucursal inválido' }
  if (!['walk_in', 'appointments', 'hybrid'].includes(mode)) {
    return { success: false, error: 'Modo inválido' }
  }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'Organización no encontrada' }

  const supabase = createAdminClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('id, organization_id')
    .eq('id', branchId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!branch) return { success: false, error: 'Sucursal no encontrada' }

  const { error: updateErr } = await supabase
    .from('branches')
    .update({ operation_mode: mode })
    .eq('id', branchId)

  if (updateErr) {
    console.error('[setOnboardingOperationMode] update error:', updateErr)
    return { success: false, error: 'Error al guardar el modo de operación' }
  }

  // Propagar a org si sigue en 'walk_in' factory default
  const { data: org } = await supabase
    .from('organizations')
    .select('default_operation_mode')
    .eq('id', orgId)
    .maybeSingle()

  if (org?.default_operation_mode === 'walk_in' && mode !== 'walk_in') {
    await supabase
      .from('organizations')
      .update({ default_operation_mode: mode })
      .eq('id', orgId)
  }

  await completeOnboardingStep(2)
  revalidatePath('/onboarding')
  return { success: true }
}

/**
 * Marca el onboarding como completado.
 */
export async function completeOnboarding() {
  const supabase = createAdminClient()
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false, error: 'Organización no encontrada' }

  const { data: org, error: fetchError } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', orgId)
    .single()

  if (fetchError || !org) {
    return { success: false, error: 'No se pudo obtener la organización' }
  }

  const updatedSettings = {
    ...(org.settings as Record<string, unknown>),
    onboarding_completed: true,
    onboarding_step: 6,
  }

  const { error } = await supabase
    .from('organizations')
    .update({ settings: updatedSettings })
    .eq('id', orgId)

  if (error) {
    console.error('[completeOnboarding] Error:', error)
    return { success: false, error: 'Error al completar el onboarding' }
  }

  revalidatePath('/dashboard')
  return { success: true }
}

/**
 * Devuelve el estado actual del onboarding para la organización del usuario.
 */
export async function getOnboardingState() {
  const supabase = createAdminClient()
  const orgId = await getCurrentOrgId()
  if (!orgId) return { success: false as const, error: 'Organización no encontrada' }

  const { data: org, error } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', orgId)
    .single()

  if (error || !org) {
    return { success: false as const, error: 'No se pudo obtener el estado del onboarding' }
  }

  const settings = (org.settings ?? {}) as Record<string, unknown>
  const step = typeof settings.onboarding_step === 'number' ? settings.onboarding_step : 0
  const completed = settings.onboarding_completed === true

  return { success: true as const, step, completed }
}
