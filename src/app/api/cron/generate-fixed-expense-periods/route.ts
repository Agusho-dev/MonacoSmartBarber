import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Ejecutado cada hora del día 1 de cada mes por pg_cron (migración 102).
// Itera todas las organizaciones activas y, para cada una cuya TZ local esté
// en el día 1 (entre 00:00 y 01:59 local, para cubrir cualquier lag del
// cron), llama a generate_fixed_expense_periods(org_id, year, month) con
// year/month del mes corriente en la TZ de esa organización.
//
// La operación es idempotente (UNIQUE + ON CONFLICT DO NOTHING), así que
// múltiples ejecuciones en el mismo día no producen duplicados.

const WINDOW_START_HOUR = 0  // 00:00
const WINDOW_END_HOUR = 1    // 01:59

interface LocalYmd {
    year: number
    month: number
    day: number
    hour: number
}

function getLocalYmd(timezone: string, now: Date = new Date()): LocalYmd {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
    })
    const parts = fmt.formatToParts(now)
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
    return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: get('hour'),
    }
}

async function handleCron(req: NextRequest) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data: orgs, error: orgErr } = await admin
        .from('organizations')
        .select('id, timezone')
        .eq('is_active', true)

    if (orgErr) {
        console.error('[generate-fixed-expense-periods] Error leyendo orgs:', orgErr)
        return NextResponse.json({ error: orgErr.message }, { status: 500 })
    }

    const now = new Date()
    const summary = {
        orgsChecked: 0,
        orgsInWindow: 0,
        totalPeriodsCreated: 0,
        errors: [] as string[],
    }

    for (const org of orgs ?? []) {
        summary.orgsChecked += 1
        const tz = org.timezone || 'America/Argentina/Buenos_Aires'
        const local = getLocalYmd(tz, now)

        // Solo procesar si es día 1 en la TZ local Y dentro de la ventana 00:00–01:59.
        // La ventana de 2h cubre retrasos del cron y asegura idempotencia sin tocar
        // la lógica (el UNIQUE ya garantiza no-duplicados).
        if (local.day !== 1) continue
        if (local.hour < WINDOW_START_HOUR || local.hour > WINDOW_END_HOUR) continue

        summary.orgsInWindow += 1

        const { data, error } = await admin.rpc('generate_fixed_expense_periods', {
            p_org_id: org.id,
            p_year: local.year,
            p_month: local.month,
        })

        if (error) {
            summary.errors.push(`org=${org.id}: ${error.message}`)
            continue
        }

        const created = (data as { created?: number } | null)?.created ?? 0
        summary.totalPeriodsCreated += created
    }

    return NextResponse.json(summary)
}

export const POST = handleCron
export const GET = handleCron
