/**
 * /api/cron/avisos-mensajeria — los avisos push de «Por responder» (6/nov/2026).
 *
 * pg_cron le pega cada minuto (mig 237b, que va DESPUÉS del deploy). Mira lo
 * que espera en cada org que tiene algún dispositivo con los avisos prendidos
 * (la misma RPC y las mismas pilas que la bandeja: src/lib/mensajeria/
 * por-responder.ts) y avisa:
 *   - una reseña baja: apenas el cliente cuenta qué pasó, o a los 90 s si no
 *     escribió nada (así el aviso trae el motivo). Una por reseña; más de dos
 *     juntas (a la mañana) van en un solo aviso.
 *   - las consultas: a los 10 minutos sin respuesta, agrupadas en un aviso.
 *   - un recordatorio cada 2 horas mientras haya consultas de más de una hora.
 * De 23 a 9 (hora de Córdoba) no avisa nada: lo que se juntó de noche sale
 * en un aviso a las 9.
 *
 * SIN `CRON_SECRET`, como las demás rutas de cron del repo. Es idempotente:
 * cada aviso se RECLAMA en `mensajeria_avisos` (clave única) antes de mandarse,
 * así que pegarle a mano, o dos corridas superpuestas, no repiten ninguno. La
 * respuesta son contadores, sin nombres ni ids.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { leerPendientes } from '@/lib/mensajeria/pendientes-servidor'
import {
  armarPilas, haceCuanto, minutosEsperando, textoNota, ultimaFraseDelCliente, type Pendiente,
} from '@/lib/mensajeria/por-responder'
import { mandarAviso, suscripcionesPara, type AvisoPush } from '@/lib/push/avisar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ZONA = 'America/Argentina/Cordoba'
const HORA_DESDE = 9
const HORA_HASTA = 23
const ESPERA_RESENA_MS = 90_000
const MINUTOS_CONSULTA = 10
const MINUTOS_RECORDATORIO = 60
const BLOQUE_RECORDATORIO_MS = 2 * 3600_000

type Supabase = ReturnType<typeof createAdminClient>

function horaLocal(ms: number): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: ZONA, hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms)))
}

/** El aviso es de esta corrida si la clave no estaba: el insert es el candado. */
async function reclamar(supabase: Supabase, clave: string, orgId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('mensajeria_avisos')
    .upsert({ clave, organization_id: orgId }, { onConflict: 'clave', ignoreDuplicates: true })
    .select('clave')
  if (error) throw new Error(`[avisos] mensajeria_avisos: ${error.message}`)
  return (data ?? []).length > 0
}

async function yaAvisada(supabase: Supabase, clave: string): Promise<boolean> {
  const { data, error } = await supabase.from('mensajeria_avisos').select('clave').eq('clave', clave).maybeSingle()
  if (error) throw new Error(`[avisos] mensajeria_avisos: ${error.message}`)
  return !!data
}

/** Los canales de la org: org-wide o de alguna de sus sucursales (Known Risk de canales org-scope). */
async function canalesDeLaOrg(supabase: Supabase, orgId: string): Promise<string[]> {
  const { data: sucursales, error: e1 } = await supabase.from('branches').select('id').eq('organization_id', orgId)
  if (e1) throw new Error(`[avisos] branches: ${e1.message}`)
  const ids = ((sucursales ?? []) as { id: string }[]).map((b) => b.id)
  const filtros = [`organization_id.eq.${orgId}`]
  if (ids.length > 0) filtros.push(`branch_id.in.(${ids.join(',')})`)
  const { data, error } = await supabase.from('social_channels').select('id').or(filtros.join(','))
  if (error) throw new Error(`[avisos] social_channels: ${error.message}`)
  return ((data ?? []) as { id: string }[]).map((c) => c.id)
}

function quien(p: Pendiente): string {
  return p.nombrePila ?? p.nombre
}

function entreComillas(texto: string, max = 110): string {
  const t = texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto
  return `«${t}»`
}

function avisoDeResena(p: Pendiente, pendientes: number): AvisoPush {
  // La nota que la trajo (si al segundo tocó otra, se aclara: suele ser un error del dedo).
  const nota = p.nota ?? p.notaFinal
  const corrigio = p.nota !== null && p.notaFinal !== null && p.notaFinal !== p.nota
  const frase = ultimaFraseDelCliente(p)
  const donde = [p.visita?.servicio, p.visita?.barbero ? `con ${p.visita.barbero}` : null, p.visita?.sucursal ? `en ${p.visita.sucursal}` : null]
    .filter(Boolean)
    .join(' ')
  return {
    titulo: nota ? `Reseña de ${textoNota(nota)} · ${quien(p)}` : `Reseña baja · ${quien(p)}`,
    cuerpo: corrigio
      ? `Enseguida tocó ${p.notaFinal}: puede haber sido sin querer.${frase ? ` ${entreComillas(frase, 80)}` : ''}`
      : frase ? entreComillas(frase) : `${donde || 'Después de su visita'}. Todavía no contó qué pasó.`,
    url: `/dashboard/mensajeria?responder=1&conv=${p.id}`,
    tag: `resena-${p.id}`,
    pendientes,
  }
}

async function avisarOrg(supabase: Supabase, orgId: string, ahora: number, contacto: string) {
  const resultado = { resenas: 0, consultas: 0, recordatorios: 0, enviados: 0 }
  const canales = await canalesDeLaOrg(supabase, orgId)
  const pilas = armarPilas(await leerPendientes(supabase, orgId, canales), ahora)
  const total = pilas.paraResponder.length
  const inicioDelDia = (() => {
    // Las 9 de hoy en Córdoba (UTC−3 todo el año): lo de antes «llegó de noche».
    const d = new Date(ahora - 3 * 3600_000)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), HORA_DESDE + 3)
  })()

  // ── Reseñas ───────────────────────────────────────────────────────────────
  const resenasNuevas: Pendiente[] = []
  for (const p of pilas.paraResponder) {
    if (p.tipo !== 'resena') continue
    const alerta = p.alertaIds[0]
    if (!alerta) continue
    const edad = ahora - Date.parse(p.esperandoDesde)
    if (p.loQueEspera.length === 0 && edad < ESPERA_RESENA_MS) continue
    if (await reclamar(supabase, `resena:${alerta}`, orgId)) resenasNuevas.push(p)
  }
  if (resenasNuevas.length > 0) {
    resultado.resenas = resenasNuevas.length
    if (resenasNuevas.length <= 2) {
      for (const p of resenasNuevas) {
        const subs = await suscripcionesPara(supabase, orgId, { tipo: 'resena', sucursalId: p.visita?.sucursalId ?? null })
        const r = await mandarAviso(supabase, subs, avisoDeResena(p, total), {
          contacto, ttl: 12 * 3600, urgencia: 'high', topic: `r${p.id.replace(/-/g, '').slice(0, 24)}`,
        })
        resultado.enviados += r.enviados
      }
    } else {
      const subs = await suscripcionesPara(supabase, orgId, { tipo: 'resena' })
      const r = await mandarAviso(supabase, subs, {
        titulo: `${resenasNuevas.length} reseñas bajas para responder`,
        cuerpo: resenasNuevas.slice(0, 3).map((p) => `${quien(p)} (${p.nota ?? p.notaFinal ?? '?'})`).join(', ') + (resenasNuevas.length > 3 ? '…' : ''),
        url: '/dashboard/mensajeria?responder=1',
        tag: 'resenas',
        pendientes: total,
      }, { contacto, ttl: 12 * 3600, urgencia: 'high', topic: 'resenas' })
      resultado.enviados += r.enviados
    }
  }

  // ── Consultas nuevas ──────────────────────────────────────────────────────
  const consultas = pilas.paraResponder.filter((p) => p.tipo === 'consulta')
  const nuevas: Pendiente[] = []
  for (const p of consultas) {
    if (minutosEsperando(p, ahora) < MINUTOS_CONSULTA) continue
    if (await reclamar(supabase, `consulta:${p.id}:${Date.parse(p.esperandoDesde)}`, orgId)) nuevas.push(p)
  }
  if (nuevas.length > 0) {
    resultado.consultas = nuevas.length
    const deNoche = nuevas.some((p) => Date.parse(p.esperandoDesde) < inicioDelDia)
    const masVieja = nuevas.reduce((a, b) => (Date.parse(a.esperandoDesde) <= Date.parse(b.esperandoDesde) ? a : b))
    const aviso: AvisoPush =
      nuevas.length === 1
        ? {
            titulo: `${quien(nuevas[0])} espera respuesta`,
            cuerpo: `${ultimaFraseDelCliente(nuevas[0]) ? entreComillas(ultimaFraseDelCliente(nuevas[0]) as string) : 'Te escribió'} · ${haceCuanto(nuevas[0].esperandoDesde, ahora)}`,
            url: `/dashboard/mensajeria?responder=1&conv=${nuevas[0].id}`,
            tag: 'consultas',
            pendientes: total,
          }
        : {
            titulo: `${deNoche ? 'Mientras no estabas: ' : ''}${nuevas.length} consultas sin responder`,
            cuerpo: `${nuevas.slice(0, 3).map(quien).join(', ')}${nuevas.length > 3 ? ' y más' : ''} · la más vieja, ${haceCuanto(masVieja.esperandoDesde, ahora)}`,
            url: '/dashboard/mensajeria?responder=1',
            tag: 'consultas',
            pendientes: total,
          }
    const subs = await suscripcionesPara(supabase, orgId, { tipo: 'consulta' })
    const r = await mandarAviso(supabase, subs, aviso, { contacto, ttl: 3 * 3600, urgencia: 'normal', topic: 'consultas' })
    resultado.enviados += r.enviados
  } else {
    // ── Recordatorio ──────────────────────────────────────────────────────
    const viejas = consultas.filter((p) => minutosEsperando(p, ahora) >= MINUTOS_RECORDATORIO)
    if (viejas.length > 0) {
      const bloque = Math.floor(ahora / BLOQUE_RECORDATORIO_MS)
      const clave = `recordatorio:${orgId}:${bloque}`
      // Sin un aviso de consultas en la última hora (si no, al cambiar de bloque salían dos seguidos).
      const { data: reciente, error } = await supabase
        .from('mensajeria_avisos')
        .select('clave')
        .eq('organization_id', orgId)
        .or('clave.like.consulta:*,clave.like.recordatorio:*')
        .gte('enviado_at', new Date(ahora - 3600_000).toISOString())
        .limit(1)
      if (error) throw new Error(`[avisos] mensajeria_avisos: ${error.message}`)
      if ((reciente ?? []).length === 0 && !(await yaAvisada(supabase, clave)) && (await reclamar(supabase, clave, orgId))) {
        resultado.recordatorios = 1
        const masVieja = viejas.reduce((a, b) => (Date.parse(a.esperandoDesde) <= Date.parse(b.esperandoDesde) ? a : b))
        const subs = await suscripcionesPara(supabase, orgId, { tipo: 'consulta' })
        const r = await mandarAviso(supabase, subs, {
          titulo: viejas.length === 1 ? `${quien(viejas[0])} sigue esperando` : `Siguen ${viejas.length} consultas sin responder`,
          cuerpo: viejas.length === 1
            ? `${ultimaFraseDelCliente(viejas[0]) ? entreComillas(ultimaFraseDelCliente(viejas[0]) as string) : 'Te escribió'} · ${haceCuanto(viejas[0].esperandoDesde, ahora)}`
            : `La más vieja es de ${quien(masVieja)}, ${haceCuanto(masVieja.esperandoDesde, ahora)}. Se responden en un minuto.`,
          url: viejas.length === 1 ? `/dashboard/mensajeria?responder=1&conv=${viejas[0].id}` : '/dashboard/mensajeria?responder=1',
          tag: 'consultas',
          pendientes: total,
        }, { contacto, ttl: 2 * 3600, urgencia: 'normal', topic: 'consultas' })
        resultado.enviados += r.enviados
      }
    }
  }
  return resultado
}

export async function GET(req: Request): Promise<Response> {
  const ahora = Date.now()
  const hora = horaLocal(ahora)
  if (hora < HORA_DESDE || hora >= HORA_HASTA) return Response.json({ ok: true, silencio: true })

  const supabase = createAdminClient()
  const contacto = new URL(req.url).origin

  const { data, error } = await supabase.from('push_suscripciones').select('organization_id').limit(1000)
  if (error) {
    console.error('[avisos] push_suscripciones:', error.message)
    return Response.json({ ok: false }, { status: 500 })
  }
  const orgs = Array.from(new Set(((data ?? []) as { organization_id: string }[]).map((s) => s.organization_id)))
  const totales = { orgs: orgs.length, resenas: 0, consultas: 0, recordatorios: 0, enviados: 0, errores: 0 }
  for (const orgId of orgs) {
    try {
      const r = await avisarOrg(supabase, orgId, ahora, contacto)
      totales.resenas += r.resenas
      totales.consultas += r.consultas
      totales.recordatorios += r.recordatorios
      totales.enviados += r.enviados
    } catch (err) {
      totales.errores++
      console.error('[avisos] una org falló:', err instanceof Error ? err.message : err)
    }
  }

  // Lo avisado hace más de 30 días ya no sirve para no repetir: una vez por hora se limpia.
  if (new Date(ahora).getUTCMinutes() === 7) {
    const { error: e } = await supabase.from('mensajeria_avisos').delete().lt('enviado_at', new Date(ahora - 30 * 24 * 3600_000).toISOString())
    if (e) console.error('[avisos] limpiando mensajeria_avisos:', e.message)
  }

  return Response.json({ ok: totales.errores === 0, ...totales })
}
