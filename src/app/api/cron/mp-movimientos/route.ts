/**
 * /api/cron/mp-movimientos — trae los créditos de las cuentas de Mercado Pago
 * conectadas para la conciliación (cada 15 min, pg_cron: mig pendiente 228b).
 *
 * Recorre las cuentas conectadas de TODAS las orgs, las más atrasadas primero
 * (last_sync_at asc, nunca leídas al principio), y lee las que tienen más de
 * 10 minutos. Presupuesto total 240 s y 30 s por cuenta: lo que no entra queda
 * para la corrida siguiente, y una lectura cortada igual guarda hasta dónde
 * llegó (src/lib/conciliacion-mp/sync.ts).
 *
 * Con lo que sobra de tiempo, vuelve a probar (una vez por día cada una) las
 * cuentas de OAuth que quedaron 'revocada': si el permiso en realidad sigue
 * vivo (un 401 suelto, un refresh que se renovó en otra lectura), vuelven a
 * 'conectada' solas en vez de esperar a que el titular autorice de nuevo.
 *
 * SIN `CRON_SECRET`: es la convención del repo (los crons los dispara pg_cron
 * pegándole a /api/cron/*; ver mp-conciliar). Lo que la protege es ser
 * IDEMPOTENTE —leer dos veces sólo re-escribe las mismas filas, y el candado
 * por cuenta impide dos lecturas simultáneas—, un rate limit global para que
 * pegarle a mano no martille a Mercado Pago, y no devolver nada: la respuesta
 * son contadores pelados, sin ids, sin alias y sin organizaciones.
 */
import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { paginarTodo } from '@/lib/conciliacion-mp/paginar'
import { sincronizarCuenta } from '@/lib/conciliacion-mp/sync'
import { CONCILIACION } from '@/lib/conciliacion-mp/contrato'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PRESUPUESTO_TOTAL_MS = 240_000
const PRESUPUESTO_CUENTA_MS = 30_000
/** Con menos que esto no se empieza otra cuenta. */
const MINIMO_POR_CUENTA_MS = 10_000
/** Una cuenta revocada se vuelve a probar a lo sumo una vez por día… */
const REINTENTO_REVOCADA_MS = 24 * 60 * 60 * 1000
/** …y no más de unas pocas por corrida: lo primero son las que andan. */
const MAX_REVOCADAS_POR_CORRIDA = 3

async function correr(): Promise<NextResponse> {
  const gate = await rateLimit('cron_mp_movimientos', 'global', { limit: 6, window: 300 })
  if (!gate.allowed) return NextResponse.json({ ok: false, motivo: 'limite' }, { status: 429 })

  const inicio = Date.now()
  const c = {
    cuentas: 0,
    leidas: 0,
    omitidas: 0,
    errores: 0,
    sinTiempo: 0,
    nuevos: 0,
    actualizados: 0,
    revocadasProbadas: 0,
    revocadasRecuperadas: 0,
  }
  try {
    const supabase = createAdminClient()
    // Sólo las cuentas vinculadas a alguna cuenta de cobro que no es de banco:
    // una que el dueño rechazó (desvinculada) o marcó como banco no se lee.
    const vinculos = await paginarTodo<{ mp_cuenta_id: string }>(
      (d, h) =>
        supabase
          .from('payment_accounts')
          .select('mp_cuenta_id')
          .not('mp_cuenta_id', 'is', null)
          .eq('fuente_conciliacion', 'mercadopago')
          .order('id')
          .range(d, h),
      'las cuentas vinculadas',
    )
    const vinculadas = new Set(vinculos.map((v) => v.mp_cuenta_id))
    const cuentas = await paginarTodo<{ id: string; last_sync_at: string | null }>(
      (d, h) =>
        supabase
          .from('mp_cuentas')
          .select('id, last_sync_at')
          .in('status', ['conectada', 'error'])
          .not('access_token_cifrado', 'is', null)
          .order('last_sync_at', { ascending: true, nullsFirst: true })
          .order('id', { ascending: true })
          .range(d, h),
      'las cuentas de Mercado Pago',
    )
    const umbral = Date.now() - CONCILIACION.autoSyncMin * 60_000
    const atrasadas = cuentas.filter((x) => vinculadas.has(x.id) && (!x.last_sync_at || new Date(x.last_sync_at).getTime() < umbral))
    c.cuentas = atrasadas.length

    for (let i = 0; i < atrasadas.length; i++) {
      const restante = PRESUPUESTO_TOTAL_MS - (Date.now() - inicio)
      if (restante < MINIMO_POR_CUENTA_MS) {
        c.sinTiempo = atrasadas.length - i
        break
      }
      const r = await sincronizarCuenta(atrasadas[i].id, {
        origen: 'cron',
        presupuestoMs: Math.min(PRESUPUESTO_CUENTA_MS, restante - 2_000),
      })
      if (r.omitida) c.omitidas++
      else if (r.ok) c.leidas++
      else c.errores++
      c.nuevos += r.nuevos
      c.actualizados += r.actualizados
    }

    // Las revocadas de OAuth, con lo que sobre de tiempo (una vez por día cada una).
    if (!c.sinTiempo) {
      const hace24h = Date.now() - REINTENTO_REVOCADA_MS
      const revocadas = await paginarTodo<{ id: string; last_check_at: string | null }>(
        (d, h) =>
          supabase
            .from('mp_cuentas')
            .select('id, last_check_at')
            .eq('status', 'revocada')
            .eq('connection_mode', 'oauth')
            .not('access_token_cifrado', 'is', null)
            .not('refresh_token_cifrado', 'is', null)
            .order('last_check_at', { ascending: true, nullsFirst: true })
            .order('id', { ascending: true })
            .range(d, h),
        'las cuentas revocadas',
      )
      const aProbar = revocadas.filter(
        (r) => vinculadas.has(r.id) && (!r.last_check_at || new Date(r.last_check_at).getTime() < hace24h),
      )
      for (const x of aProbar.slice(0, MAX_REVOCADAS_POR_CORRIDA)) {
        const restante = PRESUPUESTO_TOTAL_MS - (Date.now() - inicio)
        if (restante < MINIMO_POR_CUENTA_MS) break
        const r = await sincronizarCuenta(x.id, {
          origen: 'cron',
          presupuestoMs: Math.min(PRESUPUESTO_CUENTA_MS, restante - 2_000),
          reintentarRevocada: true,
        })
        c.revocadasProbadas++
        if (r.ok && !r.omitida) c.revocadasRecuperadas++
        c.nuevos += r.nuevos
        c.actualizados += r.actualizados
      }
    }
    return NextResponse.json({ ok: true, ...c, ms: Date.now() - inicio })
  } catch (e) {
    console.error('[cron mp-movimientos]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, ...c, ms: Date.now() - inicio }, { status: 500 })
  }
}

export async function GET() {
  return correr()
}

export async function POST() {
  return correr()
}
