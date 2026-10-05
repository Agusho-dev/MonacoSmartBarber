'use server'

/**
 * Menor espera por WhatsApp — configuración y tablero (migraciones 218 y 222).
 *
 * Todo export de este archivo es un endpoint HTTP, así que cada uno gatea por
 * permiso (`settings.view` / `settings.manage`) y por organización, y ningún id
 * que llegue del browser se usa sin validar. Las RPC de la 218/222 son SECURITY
 * DEFINER con EXECUTE sólo para service_role: `p_organization_id` lo pone
 * `getCurrentOrgId()`, nunca el cliente.
 *
 * Lo que decide quién recibe el aviso vive en SQL (`menor_espera_ofertas_tick`,
 * pg_cron cada minuto). Acá sólo se configura, se mide y se prueba.
 */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { currentUserCan } from './permissions-gate'
import { assertBranchAccess, getAllowedBranchIds, getScopedBranchIds } from './branch-access'
import { isValidUUID } from '@/lib/validation'
import {
  categoriaPlantillaParaBase,
  componentesParaMeta,
  estadoPlantillaParaBase,
  PLANTILLA_MENOR_ESPERA_NOMBRE,
  PLANTILLA_POR_DEFECTO,
} from '@/lib/menor-espera/plantilla'
import { motivoNoListo } from '@/lib/menor-espera/estado'
import type {
  BajaPanel,
  ConteoFirmas,
  EstadoOferta,
  LatidoPanel,
  MetricasPanel,
  OfertaPanel,
  PanelMenorEspera,
  PlantillaPanel,
  SucursalPanel,
  WebhookPanel,
} from '@/lib/menor-espera/tipos'

const META_API_VERSION = 'v22.0'

// ═══════════════════════════════════════════════════════════════════════════
// Gates
// ═══════════════════════════════════════════════════════════════════════════

type Gate = { orgId: string } | { error: string }

async function requireView(): Promise<Gate> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Sesión vencida. Recargá la página e iniciá sesión de nuevo.' }
  if (!(await currentUserCan('settings.view'))) return { error: 'No tenés permiso para ver la configuración.' }
  return { orgId }
}

async function requireManage(): Promise<Gate> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Sesión vencida. Recargá la página e iniciá sesión de nuevo.' }
  if (!(await currentUserCan('settings.manage'))) return { error: 'No tenés permiso para cambiar la configuración.' }
  return { orgId }
}

/**
 * Un error de PostgREST/Postgres, traducido. La 218 se aplica fuera de horario
 * y el código puede llegar antes: sin las funciones, la card lo dice con
 * palabras en vez de mostrar «Could not find the function…».
 */
function traducirError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return 'Error desconocido'
  if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01' || error.code === '42703') {
    return 'Esta función todavía no está instalada en la base de datos (falta aplicar la migración 218 o la 222).'
  }
  return error.message || 'Error desconocido'
}

/**
 * MERGE de columnas propias de app_settings (no pasa por updateAppSettings, que
 * reescribe la fila entera). `undefined` no viaja: sólo se tocan las que vienen.
 */
async function escribirAjustes(
  orgId: string,
  cambios: { menor_espera_minutos?: number; menor_espera_acepta_marketing?: boolean },
): Promise<string | null> {
  const supabase = createAdminClient()
  const { data: fila, error: selErr } = await supabase
    .from('app_settings')
    .select('id')
    .eq('organization_id', orgId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (selErr) return `No pudimos leer la configuración: ${selErr.message}`

  const { error: wErr } = fila
    ? await supabase.from('app_settings').update(cambios).eq('id', fila.id)
    : await supabase.from('app_settings').insert({ organization_id: orgId, ...cambios })
  return wErr ? traducirError(wErr) : null
}

// ═══════════════════════════════════════════════════════════════════════════
// Panel
// ═══════════════════════════════════════════════════════════════════════════

interface PanelRpc {
  ahora: string
  config: { minutos: number; plantilla: string; acepta_marketing?: boolean }
  transporte: { baileys: boolean; whatsapp: boolean }
  plantilla: PlantillaPanel
  latido: LatidoPanel | null
  metricas: Partial<MetricasPanel> | null
  /** Mig 222. Sin la 222 no viene: la card no deja prender. */
  webhook?: unknown
  bajas: number
  pruebas_hoy: number
  pruebas_intentos_hoy?: number
}

type Embebido<T> = T | T[] | null | undefined

/** PostgREST devuelve objeto en un many-to-one; por las dudas se acepta array. */
function uno<T>(v: Embebido<T>): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

function conteoFirmas(v: unknown): ConteoFirmas {
  const c = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    validas: Number(c.validas ?? 0),
    invalidas: Number(c.invalidas ?? 0),
    sin_firma: Number(c.sin_firma ?? 0),
    sin_secreto: Number(c.sin_secreto ?? 0),
  }
}

/** La firma del webhook tal como la devuelve la 222; `null` sin la migración. */
function webhookDelPanel(v: unknown): WebhookPanel | null {
  if (!v || typeof v !== 'object') return null
  const w = v as Record<string, unknown>
  const fecha = (x: unknown) => (typeof x === 'string' && x ? x : null)
  return {
    tiene_app_secret: w.tiene_app_secret === true,
    ultima_valida_at: fecha(w.ultima_valida_at),
    ultima_invalida_at: fecha(w.ultima_invalida_at),
    ultima_sin_firma_at: fecha(w.ultima_sin_firma_at),
    ultimo_post_at: fecha(w.ultimo_post_at),
    ultimo_mensaje_at: fecha(w.ultimo_mensaje_at),
    hoy: conteoFirmas(w.hoy),
    semana: conteoFirmas(w.semana),
  }
}

/** Últimos 4 dígitos: alcanza para reconocerlo sin mandar el número al browser. */
function finalDelTelefono(phone: unknown): string | null {
  const d = String(phone ?? '').replace(/\D/g, '')
  return d.length >= 4 ? d.slice(-4) : null
}

async function cargarPanel(orgId: string): Promise<{ data: PanelMenorEspera | null; error: string | null }> {
  const supabase = createAdminClient()
  const [scopedIds, allowed, puedeEditar] = await Promise.all([
    getScopedBranchIds(),
    getAllowedBranchIds(),
    currentUserCan('settings.manage'),
  ])
  const scoped = new Set(scopedIds)

  const [panelRes, sucursalesRes, ofertasRes, bajasRes] = await Promise.all([
    supabase.rpc('menor_espera_panel', {
      p_organization_id: orgId,
      p_dias: 30,
      // Un encargado de una sucursal no ve métricas de las otras.
      p_branch_ids: allowed === null ? null : scopedIds,
    }),
    scopedIds.length > 0
      ? supabase
          .from('branches')
          .select('id, name, is_active, menor_espera_aviso, business_hours_open, business_hours_close')
          .eq('organization_id', orgId)
          .in('id', scopedIds)
          .order('name')
      : Promise.resolve({ data: [], error: null }),
    // Dos FKs hacia staff: los embeds van por COLUMNA (Known Risk #15/#17).
    supabase
      .from('fila_ofertas_menor_espera')
      .select(
        'id, estado, respuesta, resultado, error, es_prueba, minutos_espera, barberos_libres, creada_at, ' +
          'enviada_at, respondida_at, atendido_at, branch_id, ' +
          'cliente:client_id(name), barbero:barbero_original_id(full_name), atendio:atendido_por_id(full_name), ' +
          'sucursal:branch_id(name), envio:scheduled_message_id(status)',
      )
      .eq('organization_id', orgId)
      .order('creada_at', { ascending: false })
      .limit(15),
    // Una sola FK hacia clients: el embed por columna no es ambiguo.
    supabase
      .from('fila_menor_espera_bajas')
      .select('client_id, creada_at, mensaje, cliente:client_id(name, phone)')
      .eq('organization_id', orgId)
      .order('creada_at', { ascending: false })
      .limit(30),
  ])

  if (panelRes.error || !panelRes.data) {
    return { data: null, error: traducirError(panelRes.error) }
  }
  if (sucursalesRes.error) {
    return { data: null, error: `No pudimos leer las sucursales: ${sucursalesRes.error.message}` }
  }
  if (ofertasRes.error) {
    return { data: null, error: `No pudimos leer las últimas ofertas: ${traducirError(ofertasRes.error)}` }
  }
  if (bajasRes.error) {
    return { data: null, error: `No pudimos leer las bajas: ${traducirError(bajasRes.error)}` }
  }

  const rpc = panelRes.data as PanelRpc
  const m = rpc.metricas ?? {}

  const bajas_lista: BajaPanel[] = ((bajasRes.data ?? []) as unknown as Array<Record<string, unknown>>).map(b => {
    const cliente = uno(b.cliente as Embebido<{ name: string | null; phone: string | null }>)
    return {
      client_id: String(b.client_id),
      cliente: cliente?.name?.trim() || null,
      telefono_final: finalDelTelefono(cliente?.phone),
      creada_at: String(b.creada_at),
      mensaje: (b.mensaje as string | null) ?? null,
    }
  })

  const sucursales: SucursalPanel[] = ((sucursalesRes.data ?? []) as Array<Record<string, unknown>>).map(b => ({
    id: String(b.id),
    name: String(b.name ?? '').trim(),
    is_active: b.is_active !== false,
    menor_espera_aviso: b.menor_espera_aviso === true,
    business_hours_open: (b.business_hours_open as string | null) ?? null,
    business_hours_close: (b.business_hours_close as string | null) ?? null,
  }))

  const ofertas: OfertaPanel[] = ((ofertasRes.data ?? []) as unknown as Array<Record<string, unknown>>)
    .filter(o => !o.branch_id || scoped.has(String(o.branch_id)))
    .map(o => ({
      id: String(o.id),
      estado: o.estado as EstadoOferta,
      respuesta: (o.respuesta as 'si' | 'no' | null) ?? null,
      resultado: (o.resultado as string | null) ?? null,
      error: (o.error as string | null) ?? null,
      es_prueba: o.es_prueba === true,
      minutos_espera: Number(o.minutos_espera ?? 0),
      barberos_libres: Number(o.barberos_libres ?? 0),
      creada_at: String(o.creada_at),
      enviada_at: (o.enviada_at as string | null) ?? null,
      respondida_at: (o.respondida_at as string | null) ?? null,
      atendido_at: (o.atendido_at as string | null) ?? null,
      cliente: uno(o.cliente as Embebido<{ name: string | null }>)?.name?.trim() || null,
      barbero: uno(o.barbero as Embebido<{ full_name: string | null }>)?.full_name?.trim() || null,
      atendio: uno(o.atendio as Embebido<{ full_name: string | null }>)?.full_name?.trim() || null,
      sucursal: uno(o.sucursal as Embebido<{ name: string | null }>)?.name?.trim() || null,
      envio: uno(o.envio as Embebido<{ status: string | null }>)?.status ?? null,
    }))

  return {
    data: {
      ahora: rpc.ahora,
      config: {
        minutos: rpc.config.minutos,
        plantilla: rpc.config.plantilla,
        acepta_marketing: rpc.config.acepta_marketing === true,
      },
      transporte: rpc.transporte,
      plantilla: rpc.plantilla,
      latido: rpc.latido ?? null,
      webhook: webhookDelPanel(rpc.webhook),
      metricas: {
        enviadas: Number(m.enviadas ?? 0),
        aceptaron: Number(m.aceptaron ?? 0),
        prefirieron_esperar: Number(m.prefirieron_esperar ?? 0),
        sin_respuesta: Number(m.sin_respuesta ?? 0),
        no_salieron: Number(m.no_salieron ?? 0),
        atendidos_por_otro: Number(m.atendidos_por_otro ?? 0),
        mediana_min_hasta_atencion:
          m.mediana_min_hasta_atencion == null ? null : Number(m.mediana_min_hasta_atencion),
      },
      bajas: Number(rpc.bajas ?? 0),
      bajas_lista,
      pruebas_hoy: Number(rpc.pruebas_hoy ?? 0),
      pruebas_intentos_hoy: Number(rpc.pruebas_intentos_hoy ?? rpc.pruebas_hoy ?? 0),
      sucursales,
      ofertas,
      puedeEditar,
    },
    error: null,
  }
}

export async function obtenerMenorEspera(): Promise<{
  data: PanelMenorEspera | null
  error: string | null
  /** Sin permiso para verla: la página no muestra la card (un «Reintentar» no arregla un permiso). */
  sinPermiso?: boolean
}> {
  const gate = await requireView()
  if ('error' in gate) return { data: null, error: gate.error, sinPermiso: true }
  return cargarPanel(gate.orgId)
}

// ═══════════════════════════════════════════════════════════════════════════
// Guardar: MERGE de sus columnas (no pasa por updateAppSettings)
// ═══════════════════════════════════════════════════════════════════════════

export interface CambiosMenorEspera {
  /** Minutos de espera a partir de los cuales se ofrece (20..120). `undefined` = no tocar. */
  minutos?: number
  /** Interruptor por sucursal. Sólo las que vienen se tocan. */
  sucursales?: Array<{ id: string; activo: boolean }>
}

export async function guardarMenorEspera(
  cambios: CambiosMenorEspera,
): Promise<{ data?: PanelMenorEspera; error?: string }> {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }
  const { orgId } = gate

  const minutos = cambios?.minutos
  if (minutos !== undefined && (!Number.isInteger(minutos) || minutos < 20 || minutos > 120)) {
    return { error: 'Los minutos tienen que ser un número entero entre 20 y 120.' }
  }
  const sucursales = Array.isArray(cambios?.sucursales) ? cambios.sucursales : []
  if (sucursales.length > 50) return { error: 'Demasiadas sucursales en un solo cambio.' }
  for (const s of sucursales) {
    if (!s || !isValidUUID(s.id) || typeof s.activo !== 'boolean') return { error: 'Sucursal inválida.' }
  }
  if (minutos === undefined && sucursales.length === 0) return { error: 'No hay nada para guardar.' }

  const supabase = createAdminClient()

  // Prender exige que el aviso PUEDA salir y que la respuesta se pueda creer:
  // plantilla aprobada, con la forma correcta y (si Meta la puso en marketing)
  // aceptada; WhatsApp conectado y sin el microservicio (que no tiene botones);
  // y una firma de Meta verificada en las últimas 24 h (mig 222). Es la misma
  // regla que muestra la card y que usa el tick. Apagar se permite siempre.
  if (sucursales.some(s => s.activo)) {
    const { data, error } = await supabase.rpc('menor_espera_panel', { p_organization_id: orgId, p_dias: 1 })
    if (error || !data) return { error: traducirError(error) }
    const rpc = data as PanelRpc
    const motivo = motivoNoListo({ ...rpc, webhook: webhookDelPanel(rpc.webhook) })
    if (motivo) return { error: motivo }
  }

  for (const s of sucursales) {
    const acceso = await assertBranchAccess(s.id)
    if (!acceso.ok || acceso.orgId !== orgId) return { error: 'No tenés acceso a esa sucursal.' }
  }

  if (minutos !== undefined) {
    const err = await escribirAjustes(orgId, { menor_espera_minutos: minutos })
    if (err) return { error: `No pudimos guardar los minutos: ${err}` }
  }

  for (const s of sucursales) {
    const { error: bErr } = await supabase
      .from('branches')
      .update({ menor_espera_aviso: s.activo })
      .eq('id', s.id)
      .eq('organization_id', orgId)
    if (bErr) return { error: `No pudimos guardar la sucursal: ${traducirError(bErr)}` }
  }

  revalidatePath('/dashboard/configuracion')
  const panel = await cargarPanel(orgId)
  if (panel.error || !panel.data) return { error: panel.error ?? 'No pudimos recargar el estado.' }
  return { data: panel.data }
}

/**
 * Meta aprobó la plantilla como MARKETING (mig 222): el dueño decide si la acepta
 * así. Sin aceptarla no se manda ni se puede prender; con `false` se revoca y el
 * tick deja de mandar (las sucursales prendidas quedan con el motivo a la vista).
 */
export async function aceptarMarketingMenorEspera(
  acepta: boolean,
): Promise<{ data?: PanelMenorEspera; error?: string }> {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }
  if (typeof acepta !== 'boolean') return { error: 'Valor inválido.' }

  const err = await escribirAjustes(gate.orgId, { menor_espera_acepta_marketing: acepta })
  if (err) return { error: `No pudimos guardar la decisión: ${err}` }

  revalidatePath('/dashboard/configuracion')
  const panel = await cargarPanel(gate.orgId)
  if (panel.error || !panel.data) return { error: panel.error ?? 'No pudimos recargar el estado.' }
  return { data: panel.data }
}

// ═══════════════════════════════════════════════════════════════════════════
// Bajas a mano (mig 222)
// ═══════════════════════════════════════════════════════════════════════════

const ERRORES_BAJA: Record<string, string> = {
  telefono_invalido: 'Escribí un WhatsApp argentino de 10 dígitos, con característica (por ejemplo, 351 555 1234).',
  cliente_no_encontrado: 'Ese número no es de ningún cliente de la barbería: no hay a quién dejar de escribirle.',
  invalido: 'Pedido inválido.',
}

interface RespuestaBajaManual {
  ok?: boolean
  error?: string
  resultado?: 'baja' | 'ya_estaba' | 'habilitado' | 'no_estaba'
  fichas?: number
  cliente?: string | null
}

/**
 * Da de baja de los avisos a TODAS las fichas de la org con ese número (los
 * duplicados por formato son el mismo cliente). Para cuando lo pide por otro
 * canal o con palabras que el webhook no reconoce como baja.
 */
export async function darDeBajaMenorEspera(
  telefono: string,
): Promise<{ data?: PanelMenorEspera; aviso?: string; error?: string }> {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }
  if (typeof telefono !== 'string' || telefono.length > 40) return { error: ERRORES_BAJA.telefono_invalido }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('menor_espera_baja_manual', {
    p_organization_id: gate.orgId,
    p_activa: true,
    p_telefono: telefono,
    p_client_id: null,
  })
  if (error || !data) return { error: traducirError(error) }
  const r = data as RespuestaBajaManual
  if (!r.ok) return { error: ERRORES_BAJA[r.error ?? ''] ?? `No pudimos darlo de baja (${r.error ?? 'error'}).` }

  const quien = r.cliente ?? 'Ese número'
  const aviso =
    r.resultado === 'ya_estaba'
      ? `${quien} ya no recibía estos avisos.`
      : `Listo: ${quien} no va a recibir más avisos de Menor espera${(r.fichas ?? 1) > 1 ? ` (${r.fichas} fichas con ese número)` : ''}.`

  revalidatePath('/dashboard/configuracion')
  const panel = await cargarPanel(gate.orgId)
  return { data: panel.data ?? undefined, aviso }
}

/** Vuelve a habilitar a un cliente (y a sus fichas con el mismo número). Sólo si él lo pidió. */
export async function habilitarMenorEspera(
  clientId: string,
): Promise<{ data?: PanelMenorEspera; aviso?: string; error?: string }> {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }
  if (!isValidUUID(clientId)) return { error: 'Cliente inválido.' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('menor_espera_baja_manual', {
    p_organization_id: gate.orgId,
    p_activa: false,
    p_telefono: null,
    p_client_id: clientId,
  })
  if (error || !data) return { error: traducirError(error) }
  const r = data as RespuestaBajaManual
  if (!r.ok) return { error: ERRORES_BAJA[r.error ?? ''] ?? `No pudimos habilitarlo (${r.error ?? 'error'}).` }

  const aviso =
    r.resultado === 'no_estaba'
      ? 'Ese cliente ya recibía los avisos.'
      : `Listo: ${r.cliente ?? 'el cliente'} vuelve a recibir los avisos de Menor espera.`

  revalidatePath('/dashboard/configuracion')
  const panel = await cargarPanel(gate.orgId)
  return { data: panel.data ?? undefined, aviso }
}

// ═══════════════════════════════════════════════════════════════════════════
// Plantilla
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trae de Meta el estado real de las plantillas (reusa el sync del inbox) y
 * devuelve el de la nuestra tal cual lo dice Meta. Desde la mig 222 la base
 * guarda paused/disabled/in_appeal/pending_deletion; el crudo sirve para lo que
 * Meta agregue y la base no admita (la card bloquea el interruptor con él).
 */
export async function verificarPlantillaMenorEspera(): Promise<{
  data?: PanelMenorEspera
  estadoMeta?: string | null
  error?: string
}> {
  const gate = await requireView()
  if ('error' in gate) return { error: gate.error }

  const { syncWhatsAppTemplates } = await import('./whatsapp-meta')
  const sync = await syncWhatsAppTemplates()
  if (sync.error) return { error: `Meta no respondió: ${sync.error}` }

  const panel = await cargarPanel(gate.orgId)
  if (panel.error || !panel.data) return { error: panel.error ?? 'No pudimos recargar el estado.' }

  const nombre = panel.data.config.plantilla
  const enMeta = (sync.data ?? []).find(t => t.name === nombre)
  return { data: panel.data, estadoMeta: enMeta ? enMeta.status : null }
}

/**
 * Crea la plantilla en la WABA de la org (para las que no la tienen; la de
 * Monaco ya existe). Mismo endpoint que `seedDefaultTemplates`, con pie y los
 * dos botones de respuesta. Queda en revisión: el estado real llega con
 * «Verificar estado en Meta».
 */
export async function crearPlantillaMenorEspera(): Promise<{ data?: PanelMenorEspera; aviso?: string; error?: string }> {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }
  const { orgId } = gate
  const supabase = createAdminClient()

  const [{ data: waConfig, error: cfgErr }, { data: canal, error: canalErr }, { data: ajustes, error: ajErr }] =
    await Promise.all([
      supabase
        .from('organization_whatsapp_config')
        .select('whatsapp_access_token, whatsapp_business_id')
        .eq('organization_id', orgId)
        .maybeSingle(),
      supabase
        .from('social_channels')
        .select('id')
        .eq('organization_id', orgId)
        .eq('platform', 'whatsapp')
        .eq('is_active', true)
        .is('branch_id', null)
        .limit(1)
        .maybeSingle(),
      supabase
        .from('app_settings')
        .select('menor_espera_plantilla')
        .eq('organization_id', orgId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
  if (cfgErr || canalErr || ajErr) {
    return { error: `No pudimos leer la configuración de WhatsApp: ${traducirError(cfgErr ?? canalErr ?? ajErr)}` }
  }
  if (!waConfig?.whatsapp_access_token || !waConfig?.whatsapp_business_id) {
    return { error: 'WhatsApp no está conectado. Conectalo en Mensajería → Configuración.' }
  }
  if (!canal) {
    return { error: 'No encontramos el canal de WhatsApp de la organización. Guardá la conexión de WhatsApp de nuevo.' }
  }

  const nombre = (ajustes?.menor_espera_plantilla as string | undefined) || PLANTILLA_MENOR_ESPERA_NOMBRE

  const { data: existente, error: exErr } = await supabase
    .from('message_templates')
    .select('status')
    .eq('channel_id', canal.id)
    .eq('name', nombre)
    .maybeSingle()
  if (exErr) return { error: `No pudimos revisar las plantillas: ${exErr.message}` }
  if (existente) {
    return { error: `La plantilla «${nombre}» ya existe. Usá «Verificar estado en Meta» para ver si ya está aprobada.` }
  }

  const componentes = componentesParaMeta()
  let res: Response
  try {
    res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${waConfig.whatsapp_business_id}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${waConfig.whatsapp_access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nombre,
        // 'es' y no 'es_AR': es el idioma de las plantillas vivas de Monaco y el
        // que se manda después (Known Risk #4).
        language: PLANTILLA_POR_DEFECTO.idioma,
        // Se pide UTILITY (habla de un servicio en curso), pero Meta decide: a
        // Monaco se la aprobó como MARKETING. Se guarda la que devuelve Meta.
        category: PLANTILLA_POR_DEFECTO.categoria,
        components: componentes,
      }),
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) {
    return { error: `No pudimos contactar a Meta: ${(e as Error).message}` }
  }

  const json = (await res.json().catch(() => ({}))) as {
    status?: string
    category?: string
    error?: { message?: string; error_user_msg?: string }
  }
  if (!res.ok) {
    const msg = json?.error?.error_user_msg ?? json?.error?.message ?? 'Meta rechazó la plantilla'
    if (msg.toLowerCase().includes('already exists')) {
      // Existe en Meta pero no acá: se trae con su estado real.
      const { syncWhatsAppTemplates } = await import('./whatsapp-meta')
      const sync = await syncWhatsAppTemplates()
      if (sync.error) return { error: `La plantilla ya existía en Meta, pero no pudimos traerla: ${sync.error}` }
      const panel = await cargarPanel(orgId)
      return {
        data: panel.data ?? undefined,
        aviso: `La plantilla «${nombre}» ya existía en Meta: la trajimos con su estado actual.`,
      }
    }
    return { error: msg }
  }

  // Lo que devuelve Meta, no lo que pedimos: puede recategorizarla al crearla
  // (Monaco la pidió UTILITY y quedó MARKETING) y eso decide si se puede mandar.
  const categoria = categoriaPlantillaParaBase(json.category, PLANTILLA_POR_DEFECTO.categoria)
  const { error: upErr } = await supabase.from('message_templates').upsert(
    {
      channel_id: canal.id,
      name: nombre,
      language: PLANTILLA_POR_DEFECTO.idioma,
      category: categoria,
      status: estadoPlantillaParaBase(json.status ?? 'PENDING'),
      components: componentes,
    },
    { onConflict: 'channel_id, name' },
  )
  if (upErr) {
    // Ya está en Meta: el próximo «Verificar estado» la trae igual.
    console.error('[menor-espera] plantilla creada en Meta pero no registrada:', upErr.message)
  }

  revalidatePath('/dashboard/configuracion')
  // Ya está creada en Meta: si recargar el panel falla, igual es un éxito.
  const panel = await cargarPanel(orgId)
  return {
    data: panel.data ?? undefined,
    aviso:
      categoria === 'marketing'
        ? 'La plantilla quedó en revisión de Meta, que la categorizó como MARKETING: antes de usarla vas a tener que aceptarlo.'
        : 'Listo: la plantilla quedó en revisión de Meta. Suele tardar de minutos a 24 horas.',
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Prueba
// ═══════════════════════════════════════════════════════════════════════════

const ERRORES_PRUEBA: Record<string, string> = {
  telefono_invalido: 'Escribí un WhatsApp argentino de 10 dígitos, con característica (por ejemplo, 351 555 1234).',
  baileys: 'Esta organización manda WhatsApp por el microservicio, que no admite botones.',
  sin_whatsapp: 'WhatsApp no está conectado. Conectalo en Mensajería → Configuración.',
  plantilla_inexistente: 'Primero creá la plantilla en Meta.',
  plantilla_no_aprobada: 'La plantilla todavía no está aprobada por Meta: la prueba sale cuando la aprueben.',
  plantilla_forma: 'La plantilla cambió de forma: tiene que tener 4 variables y 2 botones de respuesta.',
  plantilla_marketing:
    'Meta aprobó la plantilla como MARKETING: aceptalo en «Plantilla de WhatsApp» antes de mandar una prueba.',
  sin_sucursales: 'No hay sucursales activas para armar el ejemplo.',
  limite_diario: 'Ya salieron 3 pruebas hoy. Mañana podés mandar más (las que fallan no cuentan).',
  limite_intentos: 'Ya se intentaron 10 pruebas hoy. Revisá por qué no salen antes de seguir probando.',
  cliente_no_encontrado:
    'Ese número no es de ningún cliente de la barbería. La prueba se manda a una ficha que ya existe (no creamos fichas nuevas): usá el WhatsApp con el que te anotás en la tablet.',
  cliente_sin_nombre: 'La ficha de ese número no tiene nombre. Cargáselo en Clientes y volvé a probar.',
}

/**
 * Le manda el aviso real al teléfono del dueño, con la misma plantilla, el
 * mismo render y la misma prioridad que el tick. El cliente se busca por
 * teléfono DENTRO de la org y nunca se crea (lección de RRHH: la difusión del
 * 27/07 fabricó 134 fichas). Tres por día por organización que salgan (las que
 * fallan no cuentan, con un techo de 10 intentos: mig 222). Si el disyuntor
 * estaba abierto, una prueba que sale lo cierra. No exige la firma de Meta:
 * justamente sirve para diagnosticar el circuito.
 */
export async function enviarPruebaMenorEspera(
  telefono: string,
): Promise<{ ok?: true; data?: PanelMenorEspera; cliente?: string; error?: string }> {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }
  if (typeof telefono !== 'string' || telefono.length > 40) return { error: ERRORES_PRUEBA.telefono_invalido }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('menor_espera_crear_prueba', {
    p_organization_id: gate.orgId,
    p_telefono: telefono,
  })
  if (error || !data) return { error: traducirError(error) }

  const r = data as { ok?: boolean; error?: string; cliente?: string }
  if (!r.ok) return { error: ERRORES_PRUEBA[r.error ?? ''] ?? `No pudimos mandar la prueba (${r.error ?? 'error'})` }

  // La prueba ya quedó encolada: si recargar el panel falla, igual es un éxito
  // (la card vuelve a pedir el estado sola).
  const panel = await cargarPanel(gate.orgId)
  return { ok: true, cliente: r.cliente, data: panel.data ?? undefined }
}
