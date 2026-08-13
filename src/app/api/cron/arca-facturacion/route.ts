// =============================================================================
// /api/cron/arca-facturacion
//
// Corre el cupo de las políticas con emisión automática y reconcilia los
// comprobantes que quedaron en duda.
//
// Se dispara desde pg_cron (ver migración 087 para el patrón). Sin CRON_SECRET:
// las rutas nuevas de este proyecto no lo llevan — la protección real es que la
// ruta sea IDEMPOTENTE, o sea segura de correr de más y segura de que alguien
// la toque a mano.
//
// La idempotencia acá tiene dos candados, y hacen falta los dos:
//   1. `last_auto_run_at` — una corrida por política por día local.
//   2. El índice único de `arca_invoices` por visita — aunque el candado 1
//      fallara, la misma venta no se puede facturar dos veces.
// =============================================================================

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
// Se importa el motor directamente y NO la server action: la bandera `desdeCron`
// saltea permisos y aislamiento de organización, así que no puede vivir en un
// archivo 'use server' — sería un endpoint HTTP al que cualquiera podría
// mandarle `{"desdeCron": true}`.
import { correrPolitica } from '@/lib/arca/motor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Hora y fecha de pared en la zona horaria pedida. */
function localAhora(tz: string): { hora: number; fecha: string } {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
    }).formatToParts(new Date())
    const get = (t: string) => partes.find((p) => p.type === t)?.value ?? '00'
    return {
        hora: Number(get('hour')),
        fecha: `${get('year')}-${get('month')}-${get('day')}`,
    }
}

export async function GET() {
    const supabase = createAdminClient()
    // La respuesta es deliberadamente ANÓNIMA: sólo contadores. La ruta no
    // tiene autenticación (convención del repo), así que devolver ids de
    // políticas o mensajes de error por organización sería publicarle a
    // cualquiera el mapa de tenants y su estado fiscal. El detalle va a los
    // logs del servidor, que sí son privados.
    const resumen: { politicas: number; ejecutadas: number; emitidos: number; fallidos: number } = {
        politicas: 0,
        ejecutadas: 0,
        emitidos: 0,
        fallidos: 0,
    }

    const { data: politicas, error } = await supabase
        .from('arca_billing_policies')
        .select('id, organization_id, branch_id, auto_emit_hour, last_auto_run_at, mode, prioridad')
        .eq('is_enabled', true)
        .eq('auto_emit', true)
        .neq('mode', 'manual')
        // El ORDEN importa: una venta se factura una sola vez. Primero corren
        // los cupos "propios" (prioridad 100) y cada barbero se lleva lo suyo;
        // después los del pool (200), que absorben lo que quedó sin facturar.
        // Al revés, los dueños se quedarían con los cortes de los barberos.
        .order('prioridad', { ascending: true })
        .order('created_at', { ascending: true })

    if (error) {
        console.error('[cron/arca-facturacion] lectura de políticas', error.message)
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    resumen.politicas = politicas?.length ?? 0
    if (!politicas?.length) return NextResponse.json({ ok: true, ...resumen })

    // Zonas horarias: la de la sucursal si la política es de una sucursal, si
    // no la de la organización. Nunca la del proceso (Vercel corre en UTC y a
    // las 22:00 de Argentina allá ya es el día siguiente).
    const branchIds = politicas.map((p) => p.branch_id).filter(Boolean) as string[]
    const orgIds = Array.from(new Set(politicas.map((p) => p.organization_id)))

    const [{ data: sucursales }, { data: orgs }] = await Promise.all([
        branchIds.length
            ? supabase.from('branches').select('id, timezone').in('id', branchIds)
            : Promise.resolve({ data: [] as { id: string; timezone: string }[] }),
        supabase.from('organizations').select('id, timezone').in('id', orgIds),
    ])

    const tzSucursal = new Map(((sucursales ?? []) as any[]).map((s) => [s.id, s.timezone]))
    const tzOrg = new Map(((orgs ?? []) as any[]).map((o) => [o.id, o.timezone]))

    for (const p of politicas as any[]) {
        const tz =
            (p.branch_id ? tzSucursal.get(p.branch_id) : null) ??
            tzOrg.get(p.organization_id) ??
            'America/Argentina/Buenos_Aires'
        const { hora, fecha } = localAhora(tz)

        // Todavía no es la hora configurada.
        if (hora < Number(p.auto_emit_hour)) continue

        // Ya corrió hoy (comparando el día LOCAL, no el UTC).
        if (p.last_auto_run_at) {
            const ultimaLocal = new Intl.DateTimeFormat('en-CA', {
                timeZone: tz,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(new Date(p.last_auto_run_at))
            if (ultimaLocal === fecha) continue
        }

        try {
            const r = await correrPolitica(p.id, {
                desdeCron: true,
                orgIdEsperado: null, // el cron corre para todas las organizaciones
                branchIdsPermitidos: null,
                staffId: null,
            })
            resumen.ejecutadas++
            if ('error' in r) {
                console.error('[cron/arca-facturacion]', p.id, r.error)
            } else {
                resumen.emitidos += r.emitidos.length
                resumen.fallidos += r.fallidos.length
                if (r.fallidos.length) {
                    console.error('[cron/arca-facturacion] fallidos', p.id, r.fallidos[0]?.motivo)
                }
            }
        } catch (e) {
            // Que una organización falle no puede dejar sin facturar a las otras.
            console.error('[cron/arca-facturacion] excepción', p.id, e)
        }
    }

    return NextResponse.json({ ok: true, ...resumen })
}
