'use server'

// =============================================================================
// src/lib/actions/tex.ts
// Server actions de Tex: historial de conversaciones, "pulso del día" y
// configuración. Las firmas son el contrato con la UI.
//
// Cada export de un archivo 'use server' es un endpoint HTTP con un action-id
// que viaja en el bundle: TODAS resuelven el contexto desde la sesión, chequean
// el permiso y filtran por organización Y por usuario. Un id que llega del
// browser (una conversación) se verifica antes de tocarlo; una conversación
// ajena responde igual que una inexistente.
// =============================================================================

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { veredictoParaPulso } from '@/lib/conciliacion-mp/servicio'
import { requireFeature } from '@/lib/actions/entitlements'
import { EntitlementError } from '@/lib/billing/types'
import { cifrarSecreto } from '@/lib/crypto/secretos'
import { rateLimit } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import { origenClaveTex, probarClaveAnthropic } from '@/lib/tex/cliente'
import { obtenerContextoTexConConfig, puedeConfigurarTex, puedeUsarTex, type TexConfigOrg } from '@/lib/tex/contexto'
import {
  TEX_DOMINIOS,
  TEX_MAX_INSTRUCCIONES,
  TEX_MAX_PERSONA,
  type TexConfigVista,
  type TexConversacion,
  type TexEsfuerzo,
  type TexPulso,
  type TexUIMessage,
} from '@/lib/tex/contrato'
import { costoEstimadoConTarifaBaseUsd } from '@/lib/tex/costo'
import { leerTodas, limitesDelDia, totalesDeVisitas } from '@/lib/tex/datos'
import { cantidad, horaEnZona, nombreDelDia, pesos, sumarDias } from '@/lib/tex/formato'
import { permitir, type TexContexto } from '@/lib/tex/herramientas/tipos'

const RUTA_TEX = '/dashboard/asistente'
const RUTA_CONFIG = '/dashboard/asistente/configuracion'

type Resuelto = { estado: 'ok'; ctx: TexContexto; config: TexConfigOrg } | { estado: 'sin_sesion' } | { estado: 'error' }

/** El contexto, distinguiendo "no hay sesión" de "no pudimos leer". */
async function resolver(): Promise<Resuelto> {
  try {
    const r = await obtenerContextoTexConConfig()
    return r ? { estado: 'ok', ...r } : { estado: 'sin_sesion' }
  } catch (err) {
    console.error('[tex] resolviendo el contexto:', err instanceof Error ? err.message : String(err))
    return { estado: 'error' }
  }
}

function mensajeDe(r: Exclude<Resuelto, { estado: 'ok' }>): string {
  return r.estado === 'sin_sesion' ? 'Tu sesión venció. Volvé a iniciar sesión.' : 'No pudimos leer tu sesión. Probá de nuevo.'
}

const SIN_ACCESO = 'Tu usuario no tiene acceso a Tex.'
const NO_ENCONTRADA = 'No encontramos esa conversación.'

// ─────────────────────────────────────────────────────────────────────────────
// Conversaciones
// ─────────────────────────────────────────────────────────────────────────────

/** Cuántas conversaciones trae el historial sin búsqueda, y cuántas una búsqueda. */
const MAX_CONVERSACIONES = 200
const MAX_CONVERSACIONES_BUSQUEDA = 50
const ERROR_LISTA = 'No pudimos leer tus conversaciones.'

/** Un texto para `ILIKE`: `%`, `_` y `\` son comodines o escape de LIKE y se buscan tal cual. */
function patronLike(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/**
 * Las conversaciones de la persona en la org: fijadas primero, después las más recientes.
 *
 * - Sin `buscar`: hasta 200.
 * - Con `buscar` (2 letras o más): la búsqueda por título corre EN EL SERVIDOR, sobre todas
 *   sus conversaciones (no sobre las que ya cargó la pantalla), hasta 50, mismo orden.
 *
 * TIRA (`No pudimos leer tus conversaciones.`) si no pudo leer la sesión o la base: una
 * lista vacía por un error se leía como "Todavía no hay conversaciones" y el dueño creía que
 * había perdido el historial. Sin sesión o sin acceso a Tex devuelve [].
 */
export async function listarConversacionesTex(opciones?: { buscar?: string }): Promise<TexConversacion[]> {
  const r = await resolver()
  if (r.estado === 'error') throw new Error(ERROR_LISTA)
  if (r.estado !== 'ok' || !puedeUsarTex(r.ctx)) return []
  // Viene del browser: sólo un string, recortado.
  const crudo = opciones && typeof opciones === 'object' && typeof opciones.buscar === 'string' ? opciones.buscar : ''
  const buscar = crudo.replace(/\s+/g, ' ').trim().slice(0, 100)
  const conBusqueda = buscar.length >= 2

  let consulta = createAdminClient()
    .from('assistant_conversations')
    .select('id, title, pinned, updated_at')
    .eq('organization_id', r.ctx.orgId)
    .eq('user_id', r.ctx.userId)
  if (conBusqueda) consulta = consulta.ilike('title', patronLike(buscar))
  const { data, error } = await consulta
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(conBusqueda ? MAX_CONVERSACIONES_BUSQUEDA : MAX_CONVERSACIONES)
  if (error) {
    console.error('[tex] listando conversaciones:', error.message)
    throw new Error(ERROR_LISTA)
  }
  return ((data ?? []) as { id: string; title: string | null; pinned: boolean | null; updated_at: string }[]).map((c) => ({
    id: c.id,
    titulo: c.title?.trim() || 'Conversación sin título',
    actualizada: c.updated_at,
    fijada: c.pinned === true,
  }))
}

type FilaMensaje = { id: string; role: string; content: string | null; parts: unknown; created_at: string }

function aMensajeUI(f: FilaMensaje, conversacionId: string): TexUIMessage | null {
  const role = f.role === 'user' ? 'user' : 'assistant'
  let partes = (Array.isArray(f.parts) ? f.parts : []).filter(
    (p): p is TexUIMessage['parts'][number] => typeof p === 'object' && p !== null && typeof (p as { type?: unknown }).type === 'string',
  )
  // El mensaje del usuario es sólo texto.
  if (role === 'user') partes = partes.filter((p) => p.type === 'text')
  if (partes.length === 0) {
    // Filas del asistente anterior: sólo guardaban el texto.
    const texto = (f.content ?? '').trim()
    if (!texto) return null
    partes = [{ type: 'text', text: texto, state: 'done' }]
  }
  const creadoEn = Date.parse(f.created_at)
  return {
    id: f.id,
    role,
    parts: partes,
    metadata: { conversacionId, ...(Number.isFinite(creadoEn) ? { creadoEn } : {}) },
  }
}

/**
 * Por qué no se pudo abrir: 'no_encontrada' (no existe o es de otra persona: la pantalla
 * arranca una nueva) no es lo mismo que 'error' (no se pudo LEER: puede estar intacta y
 * conviene reintentar sin perder el `?c=`).
 */
type CodigoAperturaTex = 'no_encontrada' | 'error' | 'sin_sesion' | 'sin_permiso'

/** Los mensajes de una conversación propia, con sus partes (gráficos, tablas, informes). */
export async function cargarConversacionTex(
  id: string,
): Promise<{ ok: true; mensajes: TexUIMessage[] } | { ok: false; error: string; codigo?: CodigoAperturaTex }> {
  if (!isValidUUID(id)) return { ok: false, error: NO_ENCONTRADA, codigo: 'no_encontrada' }
  const r = await resolver()
  if (r.estado !== 'ok') return { ok: false, error: mensajeDe(r), codigo: r.estado === 'sin_sesion' ? 'sin_sesion' : 'error' }
  if (!puedeUsarTex(r.ctx)) return { ok: false, error: SIN_ACCESO, codigo: 'sin_permiso' }
  const supabase = createAdminClient()
  const conv = await supabase
    .from('assistant_conversations')
    .select('id')
    .eq('id', id)
    .eq('organization_id', r.ctx.orgId)
    .eq('user_id', r.ctx.userId)
    .maybeSingle()
  if (conv.error) return { ok: false, error: 'No pudimos abrir la conversación. Probá de nuevo.', codigo: 'error' }
  if (!conv.data) return { ok: false, error: NO_ENCONTRADA, codigo: 'no_encontrada' }

  const { data, error } = await supabase
    .from('assistant_messages')
    .select('id, role, content, parts, created_at')
    .eq('conversation_id', id)
    .eq('organization_id', r.ctx.orgId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(200)
  if (error) return { ok: false, error: 'No pudimos abrir la conversación. Probá de nuevo.', codigo: 'error' }
  const mensajes = ((data ?? []) as FilaMensaje[])
    .reverse()
    .map((f) => aMensajeUI(f, id))
    .filter((m): m is TexUIMessage => m !== null)
  // Una respuesta antes de la primera pregunta (un turno cortado que se guardó después de
  // un "volver a generar" muy rápido) no tiene a qué responder: tampoco va al historial.
  const primeraPregunta = mensajes.findIndex((m) => m.role === 'user')
  return { ok: true, mensajes: primeraPregunta === -1 ? [] : mensajes.slice(primeraPregunta) }
}

/**
 * Cambia (o borra) una conversación PROPIA: el filtro por org y usuario va en el
 * mismo UPDATE/DELETE, y el `.select('id')` dice si tocó algo. Cero filas =
 * no existe o no es de la persona, y las dos cosas se contestan igual.
 */
async function cambiarConversacion(
  id: string,
  cambio: { tipo: 'borrar' } | { tipo: 'actualizar'; campos: Record<string, unknown> },
): Promise<{ ok: boolean; error?: string }> {
  if (!isValidUUID(id)) return { ok: false, error: NO_ENCONTRADA }
  const r = await resolver()
  if (r.estado !== 'ok') return { ok: false, error: mensajeDe(r) }
  const tabla = createAdminClient().from('assistant_conversations')
  // Los mensajes caen en cascada con el borrado (FK assistant_messages.conversation_id ON DELETE CASCADE).
  const consulta = cambio.tipo === 'borrar' ? tabla.delete() : tabla.update(cambio.campos)
  const { data, error } = await consulta.eq('id', id).eq('organization_id', r.ctx.orgId).eq('user_id', r.ctx.userId).select('id')
  if (error) {
    console.error('[tex] cambiando una conversación:', error.message)
    return { ok: false, error: 'No pudimos guardar el cambio. Probá de nuevo.' }
  }
  return Array.isArray(data) && data.length > 0 ? { ok: true } : { ok: false, error: NO_ENCONTRADA }
}

export async function borrarConversacionTex(id: string): Promise<{ ok: boolean; error?: string }> {
  return cambiarConversacion(id, { tipo: 'borrar' })
}

export async function renombrarConversacionTex(id: string, titulo: string): Promise<{ ok: boolean; error?: string }> {
  const limpio = (typeof titulo === 'string' ? titulo : '').replace(/\s+/g, ' ').trim()
  if (!limpio) return { ok: false, error: 'Escribí un nombre.' }
  if (limpio.length > 80) return { ok: false, error: 'El nombre puede tener hasta 80 caracteres.' }
  // Sin tocar updated_at: renombrar no es actividad y no debería subirla en la lista.
  return cambiarConversacion(id, { tipo: 'actualizar', campos: { title: limpio } })
}

export async function fijarConversacionTex(id: string, fijada: boolean): Promise<{ ok: boolean; error?: string }> {
  return cambiarConversacion(id, { tipo: 'actualizar', campos: { pinned: fijada === true } })
}

// ─────────────────────────────────────────────────────────────────────────────
// Pulso del día (sin IA)
// ─────────────────────────────────────────────────────────────────────────────

function textoCortes(n: number): string {
  if (n === 0) return 'Sin cortes'
  return n === 1 ? '1 corte' : `${cantidad(n)} cortes`
}

/** "8 % más que el martes anterior" / "igual que el martes anterior". */
function comparacionSemanal(actual: number, anterior: number, dia: string): string | null {
  if (anterior <= 0) return null
  const pct = Math.round(((actual - anterior) / anterior) * 100)
  if (pct === 0) return `igual que el ${dia} anterior`
  return `${Math.abs(pct)} % ${pct > 0 ? 'más' : 'menos'} que el ${dia} anterior`
}

/**
 * Hasta 3 cifras del estado vacío de Tex, calculadas SIN IA y con los permisos y
 * el alcance de la persona: cómo fue ayer, cómo viene hoy y la conciliación de
 * ayer. Si una no se pudo leer, no se muestra (nunca un cero falso).
 */
export async function obtenerPulsoTex(): Promise<TexPulso[]> {
  const r = await resolver()
  if (r.estado !== 'ok') return []
  const { ctx } = r
  if (!puedeUsarTex(ctx) || ctx.sucursalesIds.length === 0) return []

  const tarjetas: Promise<TexPulso | null>[] = []

  if (permitir(ctx, 'stats.view', 'estadisticas') === null) {
    const ayer = sumarDias(ctx.hoy, -1)
    const mismoDiaAnterior = sumarDias(ayer, -7)
    tarjetas.push(
      (async (): Promise<TexPulso> => {
        const [dia, referencia] = await Promise.all([
          totalesDeVisitas(ctx.sucursalesIds, limitesDelDia(ayer).desde, limitesDelDia(ayer).hasta),
          // La comparación es un extra: si falla, la tarjeta sale sin ella.
          totalesDeVisitas(ctx.sucursalesIds, limitesDelDia(mismoDiaAnterior).desde, limitesDelDia(mismoDiaAnterior).hasta).catch(() => null),
        ])
        const comparacion = referencia ? comparacionSemanal(dia.ingresos, referencia.ingresos, nombreDelDia(ayer)) : null
        return {
          id: 'ayer',
          etiqueta: `Ayer, ${nombreDelDia(ayer)}`,
          valor: pesos(dia.ingresos),
          detalle: comparacion ? `${textoCortes(dia.cortes)} · ${comparacion}` : textoCortes(dia.cortes),
          tono: 'neutro',
          pregunta: '¿Cómo nos fue ayer?',
          icono: 'estadisticas',
        }
      })(),
    )
    tarjetas.push(
      (async (): Promise<TexPulso> => {
        const ahora = new Date()
        const hoy = await totalesDeVisitas(ctx.sucursalesIds, limitesDelDia(ctx.hoy).desde, ahora.toISOString())
        return {
          id: 'hoy',
          etiqueta: 'Hoy, hasta ahora',
          valor: pesos(hoy.ingresos),
          detalle: hoy.cortes > 0 ? `${textoCortes(hoy.cortes)} hasta las ${horaEnZona(ahora)}` : 'Sin cortes todavía',
          tono: 'neutro',
          pregunta: '¿Cómo viene el día?',
          icono: 'resumen',
        }
      })(),
    )
  }

  if (permitir(ctx, 'conciliacion.view', 'conciliacion') === null) {
    tarjetas.push(
      (async (): Promise<TexPulso | null> => {
        const v = await veredictoParaPulso(ctx.orgId, ctx.sucursalesIds)
        if (!v) return null // ninguna cuenta conectada: no hay nada que decir todavía
        const tono: TexPulso['tono'] =
          v.veredicto.tipo === 'cuadra' ? 'ok' : v.veredicto.tipo === 'no_cuadra' ? 'revisar' : v.veredicto.tipo === 'error' ? 'error' : 'neutro'
        return {
          id: 'conciliacion',
          etiqueta: 'Conciliación de ayer',
          valor: v.veredicto.titular,
          ...(v.veredicto.detalle ? { detalle: v.veredicto.detalle } : {}),
          tono,
          pregunta: '¿Cuadró la plata de ayer con Mercado Pago?',
          icono: 'conciliacion',
        }
      })(),
    )
  }

  const resultados = await Promise.allSettled(tarjetas)
  return resultados.flatMap((x) => {
    if (x.status === 'rejected') {
      console.error('[tex] pulso del día:', x.reason instanceof Error ? x.reason.message : String(x.reason))
      return []
    }
    return x.value ? [x.value] : []
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las respuestas de Tex desde el 1 del mes, sus tokens y su costo.
 *
 * - Sólo filas de Tex: las que tienen `usage`. El asistente viejo (que sigue vivo para
 *   bundles viejos) guarda filas del asistente sin `usage`, y contarlas daba "Respuestas 15
 *   · US$ 0,00" sin una sola de Tex.
 * - El costo es la suma de `usage.costoUsd`, que cada turno calcula al guardarse con la
 *   tarifa de cada pedido (5× por encima de 100K tokens de prompt). Una fila sin ese campo
 *   (anterior al cálculo) se estima con la tarifa base.
 * Tira si no pudo leer: la vista lo muestra como error, nunca como cero.
 */
async function usoDelMes(orgId: string, hoy: string): Promise<TexConfigVista['usoMes']> {
  const supabase = createAdminClient()
  const desde = limitesDelDia(`${hoy.slice(0, 8)}01`).desde
  const filas = await leerTodas<{ id: string; usage: unknown }>(
    (a, b) =>
      supabase
        .from('assistant_messages')
        .select('id, usage')
        .eq('organization_id', orgId)
        .eq('role', 'assistant')
        .not('usage', 'is', null)
        .gte('created_at', desde)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b),
    { contexto: 'uso del mes', maxFilas: 200_000 },
  )
  const total = { respuestas: 0, entrada: 0, salida: 0, cacheLeido: 0, cacheEscrito: 0 }
  let costoUsd = 0
  const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  for (const f of filas) {
    if (typeof f.usage !== 'object' || f.usage === null || Array.isArray(f.usage)) continue
    const u = f.usage as Record<string, unknown>
    const fila = { entrada: numero(u.entrada), salida: numero(u.salida), cacheLeido: numero(u.cacheLeido), cacheEscrito: numero(u.cacheEscrito) }
    total.respuestas++
    total.entrada += fila.entrada
    total.salida += fila.salida
    total.cacheLeido += fila.cacheLeido
    total.cacheEscrito += fila.cacheEscrito
    const guardado = u.costoUsd
    costoUsd += typeof guardado === 'number' && Number.isFinite(guardado) && guardado >= 0 ? guardado : costoEstimadoConTarifaBaseUsd(fila)
  }
  return { ...total, costoUsd: Math.round(costoUsd * 100) / 100 }
}

/** Lo que muestra Configurar Tex (y el "Uso del mes" del menú). Nunca devuelve una clave. */
export async function obtenerConfigTex(): Promise<
  { ok: true; config: TexConfigVista; puedeEditar: boolean } | { ok: false; error: string }
> {
  const r = await resolver()
  if (r.estado !== 'ok') return { ok: false, error: mensajeDe(r) }
  const { ctx, config } = r
  if (!puedeUsarTex(ctx)) return { ok: false, error: SIN_ACCESO }

  const supabase = createAdminClient()
  const [origen, openai, uso] = await Promise.allSettled([
    origenClaveTex(ctx.orgId),
    // Sólo si existe: el valor de la clave no sale de la base.
    supabase
      .from('organization_ai_config')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', ctx.orgId)
      .not('openai_api_key', 'is', null),
    usoDelMes(ctx.orgId, ctx.hoy),
  ])
  if (origen.status === 'rejected' || openai.status === 'rejected' || openai.value.error || openai.value.count == null) {
    console.error('[tex] leyendo la configuración:', origen.status === 'rejected' ? String(origen.reason) : 'clave de OpenAI')
    return { ok: false, error: 'No pudimos leer la configuración de Tex. Probá de nuevo.' }
  }
  if (uso.status === 'rejected') console.error('[tex] uso del mes:', uso.reason instanceof Error ? uso.reason.message : String(uso.reason))

  const vista: TexConfigVista = {
    tieneClave: origen.value != null,
    origenClave: origen.value,
    esfuerzo: config.esfuerzo,
    persona: config.persona,
    instrucciones: config.instrucciones,
    accesoDatos: config.accesoDatos,
    modoPro: config.modoProGuardado,
    puedeModoPro: ctx.esDuenoOAdmin,
    tieneClaveOpenAI: openai.value.count > 0,
    // Sin poder leer el uso no se inventa un cero: la UI recibe el aviso aparte.
    usoMes: uso.status === 'fulfilled' ? uso.value : { respuestas: 0, entrada: 0, salida: 0, cacheLeido: 0, cacheEscrito: 0, costoUsd: 0 },
    ...(uso.status === 'rejected' ? { usoMesError: 'No pudimos leer el uso del mes.' } : {}),
  }
  return { ok: true, config: vista, puedeEditar: puedeConfigurarTex(ctx) }
}

const DOMINIOS_VALIDOS = new Set(TEX_DOMINIOS.map((d) => d.id))

const EsquemaConfigTex = z
  .object({
    esfuerzo: z.enum(['low', 'medium', 'high']).optional(),
    // Los mismos topes que el campo de Configurar Tex (contrato.ts).
    persona: z.string().max(TEX_MAX_PERSONA, `La personalidad puede tener hasta ${cantidad(TEX_MAX_PERSONA)} caracteres.`).nullable().optional(),
    instrucciones: z
      .string()
      .max(TEX_MAX_INSTRUCCIONES, `Las instrucciones pueden tener hasta ${cantidad(TEX_MAX_INSTRUCCIONES)} caracteres.`)
      .nullable()
      .optional(),
    accesoDatos: z.record(z.string(), z.boolean()).optional(),
    modoPro: z.boolean().optional(),
  })
  .strict()

/** Para configurar: permiso + plan. Devuelve el contexto o el error a mostrar. */
async function paraConfigurar(): Promise<{ ok: true; ctx: TexContexto; config: TexConfigOrg } | { ok: false; error: string }> {
  const r = await resolver()
  if (r.estado !== 'ok') return { ok: false, error: mensajeDe(r) }
  if (!puedeConfigurarTex(r.ctx)) return { ok: false, error: 'No tenés permiso para configurar Tex.' }
  try {
    await requireFeature('ai.enabled')
  } catch (err) {
    if (err instanceof EntitlementError) return { ok: false, error: err.kind === 'feature_locked' ? 'Tex es parte del plan Enterprise.' : err.message }
    console.error('[tex] verificando el plan:', err instanceof Error ? err.message : String(err))
    return { ok: false, error: 'No pudimos verificar tu plan. Probá de nuevo.' }
  }
  return { ok: true, ctx: r.ctx, config: r.config }
}

export async function guardarConfigTex(input: {
  esfuerzo?: TexEsfuerzo
  persona?: string | null
  instrucciones?: string | null
  accesoDatos?: Record<string, boolean>
  modoPro?: boolean
}): Promise<{ ok: boolean; error?: string }> {
  const validado = EsquemaConfigTex.safeParse(input ?? {})
  if (!validado.success) return { ok: false, error: validado.error.issues[0]?.message ?? 'Datos inválidos.' }
  const datos = validado.data
  if (datos.accesoDatos && Object.keys(datos.accesoDatos).some((k) => !DOMINIOS_VALIDOS.has(k))) {
    return { ok: false, error: 'Hay un dato desconocido en "Acceso a datos".' }
  }

  const g = await paraConfigurar()
  if (!g.ok) return g
  // El Modo Pro da SQL sobre toda la org: sólo el dueño o un admin lo prenden o apagan.
  if (datos.modoPro !== undefined && !g.ctx.esDuenoOAdmin) {
    return { ok: false, error: 'Sólo el dueño o un admin pueden cambiar el Modo Pro.' }
  }

  const payload: Record<string, unknown> = { organization_id: g.ctx.orgId, updated_at: new Date().toISOString() }
  if (datos.esfuerzo !== undefined) payload.assistant_effort = datos.esfuerzo
  if (datos.persona !== undefined) payload.assistant_persona = datos.persona?.trim() || null
  if (datos.instrucciones !== undefined) payload.assistant_system_prompt = datos.instrucciones?.trim() || null
  // Se mezcla con lo guardado: un dominio que no viene queda como estaba (ausente = encendido).
  if (datos.accesoDatos !== undefined) payload.assistant_data_access = { ...g.config.accesoDatos, ...datos.accesoDatos }
  if (datos.modoPro !== undefined) payload.assistant_pro_mode = datos.modoPro
  if (Object.keys(payload).length === 2) return { ok: true }

  const { error } = await createAdminClient().from('organization_ai_config').upsert(payload, { onConflict: 'organization_id' })
  if (error) {
    console.error('[tex] guardando la configuración:', error.message)
    return { ok: false, error: 'No pudimos guardar la configuración. Probá de nuevo.' }
  }
  revalidatePath(RUTA_TEX)
  revalidatePath(RUTA_CONFIG)
  return { ok: true }
}

/** Valida la clave contra Anthropic (sin gastar tokens) y la guarda CIFRADA. Nunca se loguea. */
export async function guardarClaveTex(clave: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const limpia = (typeof clave === 'string' ? clave : '').trim()
  if (!/^sk-ant-[A-Za-z0-9_-]{20,400}$/.test(limpia)) {
    return { ok: false, error: 'Esa no parece una clave de Anthropic: empieza con sk-ant-.' }
  }
  const g = await paraConfigurar()
  if (!g.ok) return g
  const ritmo = await rateLimit('tex_clave', g.ctx.userId, { limit: 10, window: 600 })
  if (!ritmo.allowed) return { ok: false, error: 'Probaste muchas claves seguidas. Esperá unos minutos.' }

  const prueba = await probarClaveAnthropic(limpia)
  if (!prueba.ok) return prueba
  let cifrada: string
  try {
    cifrada = await cifrarSecreto(limpia)
  } catch (err) {
    console.error('[tex] cifrando la clave:', err instanceof Error ? err.message : 'error')
    return { ok: false, error: 'No pudimos guardar la clave. Probá de nuevo.' }
  }
  const { error } = await createAdminClient()
    .from('organization_ai_config')
    .upsert(
      { organization_id: g.ctx.orgId, anthropic_api_key_cifrada: cifrada, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id' },
    )
  if (error) {
    console.error('[tex] guardando la clave:', error.message)
    return { ok: false, error: 'No pudimos guardar la clave. Probá de nuevo.' }
  }
  revalidatePath(RUTA_TEX)
  revalidatePath(RUTA_CONFIG)
  return { ok: true }
}

/** Quita la clave de Tex. La columna vieja (texto plano) no se toca: la usa Mensajería. */
export async function quitarClaveTex(): Promise<{ ok: boolean; error?: string }> {
  const r = await resolver()
  if (r.estado !== 'ok') return { ok: false, error: mensajeDe(r) }
  // Sin chequear el plan: quitar una clave tiene que poder hacerse aunque el plan haya vencido.
  if (!puedeConfigurarTex(r.ctx)) return { ok: false, error: 'No tenés permiso para configurar Tex.' }
  const { error } = await createAdminClient()
    .from('organization_ai_config')
    .update({ anthropic_api_key_cifrada: null, updated_at: new Date().toISOString() })
    .eq('organization_id', r.ctx.orgId)
  if (error) {
    console.error('[tex] quitando la clave:', error.message)
    return { ok: false, error: 'No pudimos quitar la clave. Probá de nuevo.' }
  }
  revalidatePath(RUTA_TEX)
  revalidatePath(RUTA_CONFIG)
  return { ok: true }
}

/**
 * La clave de OpenAI de la búsqueda semántica (embeddings). Va a la columna
 * existente `openai_api_key`, que también usan Mensajería y el cron de
 * embeddings: por eso no se cifra acá (ellos la leen en claro).
 */
export async function guardarClaveOpenAITex(clave: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const limpia = (typeof clave === 'string' ? clave : '').trim()
  if (!/^sk-[A-Za-z0-9_-]{20,400}$/.test(limpia)) {
    return { ok: false, error: 'Esa no parece una clave de OpenAI: empieza con sk-.' }
  }
  const g = await paraConfigurar()
  if (!g.ok) return g
  const { error } = await createAdminClient()
    .from('organization_ai_config')
    .upsert({ organization_id: g.ctx.orgId, openai_api_key: limpia, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
  if (error) {
    console.error('[tex] guardando la clave de OpenAI:', error.message)
    return { ok: false, error: 'No pudimos guardar la clave. Probá de nuevo.' }
  }
  revalidatePath(RUTA_CONFIG)
  return { ok: true }
}
