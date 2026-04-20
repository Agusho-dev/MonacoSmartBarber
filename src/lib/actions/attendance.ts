'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { checkTardiness } from './disciplinary'
import { revalidatePath } from 'next/cache'

/**
 * Valida que el staffId pertenece al branchId indicado, que ambos existen,
 * y que pertenecen a la misma organización. Devuelve el timezone de la
 * organización (para cálculos de "inicio del día local" al validar asistencia).
 * El panel barbero usa PIN auth (sin sesión Supabase), por lo que no se puede
 * usar el cliente SSR para estas operaciones.
 */
async function validateStaffBelongsToBranch(
  staffId: string,
  branchId: string
): Promise<{ valid: boolean; orgId: string | null; timezone: string }> {
  const supabase = createAdminClient()
  const [{ data: staff }, { data: branch }] = await Promise.all([
    supabase
      .from('staff')
      .select('id, organization_id')
      .eq('id', staffId)
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('branches')
      .select('organization_id, timezone')
      .eq('id', branchId)
      .eq('is_active', true)
      .maybeSingle(),
  ])
  if (!staff?.organization_id || !branch?.organization_id) {
    return { valid: false, orgId: null, timezone: 'America/Argentina/Buenos_Aires' }
  }
  if (staff.organization_id !== branch.organization_id) {
    return { valid: false, orgId: null, timezone: 'America/Argentina/Buenos_Aires' }
  }
  return {
    valid: true,
    orgId: branch.organization_id,
    timezone: branch.timezone || 'America/Argentina/Buenos_Aires',
  }
}

/**
 * Devuelve el ISO timestamp del inicio del día (00:00:00) en el timezone dado.
 * Se usa para buscar el último log de asistencia del staff "hoy" (hora local).
 */
function startOfLocalDayIso(timezone: string, now: Date = new Date()): string {
  // Formato: "YYYY-MM-DD, HH:mm:ss" en la zona dada → parseamos la fecha local
  // y construimos un Date real en UTC.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  const y = get('year')
  const m = get('month')
  const d = get('day')
  const hh = Number(get('hour'))
  const mm = Number(get('minute'))
  const ss = Number(get('second'))
  // Diferencia entre "ahora en UTC" y "ahora local en tz" → offset de la tz
  const nowUtcMs = now.getTime()
  const localAsUtcMs = Date.UTC(Number(y), Number(m) - 1, Number(d), hh, mm, ss)
  const tzOffsetMs = localAsUtcMs - nowUtcMs
  // Medianoche local en UTC = medianoche local como "UTC" menos el offset
  const midnightLocalAsUtc = Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0)
  return new Date(midnightLocalAsUtc - tzOffsetMs).toISOString()
}

/**
 * Devuelve el último attendance_log del staff desde el inicio del día local.
 */
async function getLastTodayLog(staffId: string, timezone: string) {
  const supabase = createAdminClient()
  const since = startOfLocalDayIso(timezone)
  const { data } = await supabase
    .from('attendance_logs')
    .select('action_type, recorded_at')
    .eq('staff_id', staffId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

export async function registerBarberClockIn(staffId: string, branchId: string, faceVerified: boolean) {
    // Validar que el barbero pertenece a la sucursal antes de registrar asistencia
    const { valid, timezone } = await validateStaffBelongsToBranch(staffId, branchId)
    if (!valid) {
        return { error: 'Barbero no encontrado en esta sucursal' }
    }

    // Impedir dos clock_in seguidos sin clock_out en el medio.
    const lastLog = await getLastTodayLog(staffId, timezone)
    if (lastLog?.action_type === 'clock_in') {
        return { error: 'Ya marcaste entrada. Marcá salida antes de volver a entrar.' }
    }

    const supabase = createAdminClient()

    const { error: logError } = await supabase.from('attendance_logs').insert({
        staff_id: staffId,
        branch_id: branchId,
        action_type: 'clock_in',
        face_verified: faceVerified,
    })

    if (logError) {
        return { error: 'Error al registrar entrada: ' + logError.message }
    }

    // Verificar tardanza en background (toda la lógica vive en disciplinary.ts)
    checkTardiness(staffId, branchId).catch((err) => {
        console.error('Error al verificar tardanza:', err)
    })

    revalidatePath('/checkin')
    return { success: true }
}

export async function registerBarberClockOut(staffId: string, branchId: string, faceVerified: boolean) {
    // Validar que el barbero pertenece a la sucursal antes de registrar asistencia
    const { valid, timezone } = await validateStaffBelongsToBranch(staffId, branchId)
    if (!valid) {
        return { error: 'Barbero no encontrado en esta sucursal' }
    }

    // Sólo permite clock_out si hay un clock_in abierto el día de hoy.
    const lastLog = await getLastTodayLog(staffId, timezone)
    if (!lastLog || lastLog.action_type !== 'clock_in') {
        return { error: 'No marcaste entrada hoy. No se puede registrar salida.' }
    }

    const supabase = createAdminClient()

    const { error: logError } = await supabase.from('attendance_logs').insert({
        staff_id: staffId,
        branch_id: branchId,
        action_type: 'clock_out',
        face_verified: faceVerified,
    })

    if (logError) {
        return { error: 'Error al registrar salida: ' + logError.message }
    }

    revalidatePath('/checkin')
    return { success: true }
}
