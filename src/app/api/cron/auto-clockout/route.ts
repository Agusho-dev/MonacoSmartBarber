import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Ejecutado cada minuto por pg_cron (migración 095). Para cada organización
// cuya hora local esté entre las 23:58 y 23:59, cierra automáticamente con
// `clock_out` a los staff que marcaron `clock_in` hoy y aún no marcaron salida.
//
// Ventana 23:58–23:59 (dos minutos) por seguridad: si un tick del cron se
// pierde, el siguiente sigue alcanzando el cierre antes de medianoche. Se usa
// también un lock por staff+día (via unique check previo a insertar) para no
// duplicar cierres.

const CLOSE_WINDOW_START_MIN = 23 * 60 + 58 // 23:58
const CLOSE_WINDOW_END_MIN = 23 * 60 + 59   // 23:59

function localTimeOfDayMinutes(timezone: string, now: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return hh * 60 + mm
}

function startOfLocalDayIso(timezone: string, now: Date = new Date()): string {
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
  const y = Number(get('year'))
  const m = Number(get('month'))
  const d = Number(get('day'))
  const hh = Number(get('hour'))
  const mm = Number(get('minute'))
  const ss = Number(get('second'))
  const localAsUtcMs = Date.UTC(y, m - 1, d, hh, mm, ss)
  const tzOffsetMs = localAsUtcMs - now.getTime()
  const midnightLocalAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0)
  return new Date(midnightLocalAsUtc - tzOffsetMs).toISOString()
}

async function handleCron(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Traer todas las organizaciones activas con su timezone
  const { data: orgs, error: orgErr } = await admin
    .from('organizations')
    .select('id, timezone')
    .eq('is_active', true)

  if (orgErr) {
    console.error('[auto-clockout] Error leyendo organizaciones:', orgErr)
    return NextResponse.json({ error: orgErr.message }, { status: 500 })
  }

  const now = new Date()
  const summary = {
    orgsChecked: 0,
    orgsInWindow: 0,
    autoClosed: 0,
    errors: [] as string[],
  }

  for (const org of orgs ?? []) {
    summary.orgsChecked += 1
    const tz = org.timezone || 'America/Argentina/Buenos_Aires'
    const localMinutes = localTimeOfDayMinutes(tz, now)

    // Fuera de la ventana de cierre: no hacemos nada
    if (localMinutes < CLOSE_WINDOW_START_MIN || localMinutes > CLOSE_WINDOW_END_MIN) {
      continue
    }
    summary.orgsInWindow += 1

    const sinceIso = startOfLocalDayIso(tz, now)

    // Buscar staff activos de la org que tienen un clock_in hoy.
    // No limitamos por role — todos los empleados marcan asistencia.
    const { data: todayLogs, error: logsErr } = await admin
      .from('attendance_logs')
      .select('staff_id, branch_id, action_type, recorded_at')
      .gte('recorded_at', sinceIso)
      .order('recorded_at', { ascending: false })

    if (logsErr) {
      summary.errors.push(`org=${org.id}: ${logsErr.message}`)
      continue
    }

    // Filtrar logs a los staff de esta org. Buscamos una lista de staff ids
    // activos de la org para reducir el set.
    const { data: staffList } = await admin
      .from('staff')
      .select('id')
      .eq('organization_id', org.id)
      .eq('is_active', true)

    const staffIds = new Set((staffList ?? []).map((s) => s.id))
    if (staffIds.size === 0) continue

    // Para cada staff de la org, tomamos su último log de hoy: si es clock_in,
    // hay que auto-cerrar.
    const lastLogByStaff = new Map<string, { action_type: string; branch_id: string }>()
    for (const log of todayLogs ?? []) {
      if (!staffIds.has(log.staff_id)) continue
      if (!lastLogByStaff.has(log.staff_id)) {
        lastLogByStaff.set(log.staff_id, {
          action_type: log.action_type,
          branch_id: log.branch_id,
        })
      }
    }

    const toClose = Array.from(lastLogByStaff.entries())
      .filter(([, v]) => v.action_type === 'clock_in')
      .map(([staff_id, v]) => ({
        staff_id,
        branch_id: v.branch_id,
        action_type: 'clock_out' as const,
        face_verified: false,
        notes: 'Cierre automático 23:59',
      }))

    if (toClose.length === 0) continue

    const { error: insertErr } = await admin.from('attendance_logs').insert(toClose)
    if (insertErr) {
      summary.errors.push(`org=${org.id} insert: ${insertErr.message}`)
      continue
    }
    summary.autoClosed += toClose.length
  }

  return NextResponse.json(summary)
}

export const POST = handleCron
export const GET = handleCron
