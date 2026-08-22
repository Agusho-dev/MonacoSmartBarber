'use server'

// =============================================================================
// src/lib/actions/push-notifications.ts
// Server actions de /dashboard/notificaciones: campañas push a la app de
// clientes, notificaciones automáticas (push_settings) y dispositivos.
//
// Todo corre con la service role (`createAdminClient`), así que el scope por
// organización se impone acá, a mano, en cada query (`getCurrentOrgId`), y los
// permisos se chequean con `currentUserCan` (`notifications.view` para leer,
// `notifications.manage` para tocar). Un export de un archivo `'use server'`
// es un endpoint HTTP: nada de lo que llega por argumento se confía sin validar
// (Zod) y ninguna bandera de confianza viaja como parámetro.
//
// El envío real NO ocurre acá: estas acciones encolan filas en `push_outbox` y
// el cron `trigger_send_push` (cada minuto) + la edge function `send-push` las
// despachan por FCM. Programar una campaña = encolarla ya con `scheduled_for`
// futuro; cancelarla = pasar sus pendientes a `cancelled`.
// =============================================================================

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { currentUserCan } from './permissions-gate'
import { getFilteredClientIds, type AudienceFilters } from './client-segments'
import { getOrgLocaleContext } from '@/lib/i18n'
import { getTzOffsetISO } from '@/lib/time-utils'
import { isValidUUID } from '@/lib/validation'
import {
  PUSH_TITLE_MAX,
  PUSH_BODY_MAX,
  PUSH_NAME_MAX,
  PUSH_REMINDER_MAX_HOURS,
  PUSH_REMINDER_MAX_ITEMS,
  PUSH_SETTINGS_DEFAULTS,
  esDeepLinkValido,
  branchIdDeDeepLink,
  type PushCampaignStatus,
} from '@/lib/push/constants'

// La pantalla vive como pestaña de App Móvil; la ruta vieja redirige ahí.
const RUTA = '/dashboard/app-movil'
const CHUNK = 500

// ─── Tipos que consume la pantalla ───────────────────────────────────────────

export interface PushCampaignRow {
  id: string
  name: string
  title: string
  body: string
  image_url: string | null
  deep_link: string | null
  audience_filters: AudienceFilters
  status: PushCampaignStatus
  scheduled_for: string | null
  started_at: string | null
  completed_at: string | null
  audience_count: number | null
  sent_count: number
  failed_count: number
  no_token_count: number
  created_at: string
}

export interface PushDeviceRow {
  client_id: string
  client_name: string
  platform: 'ios' | 'android' | string
  app_version: string | null
  last_seen_at: string | null
  created_at: string
  is_active: boolean
}

export interface PushOverview {
  /** Clientes distintos con al menos un token activo. */
  clientsWithApp: number
  activeTokens: number
  ios: number
  android: number
  /** Últimos registros (sin el token en claro). */
  recent: PushDeviceRow[]
  campaigns: { total: number; sent: number; scheduled: number; pushSent: number }
  /** Pendientes en la cola de salida (de cualquier tipo). */
  outboxPending: number
  error?: string
}

export interface PushSettingsData {
  reminders_enabled: boolean
  reminder_hours: number[]
  reminder_title: string
  reminder_body_24h: string
  reminder_body_2h: string
  appointment_cancelled_enabled: boolean
  appointment_cancelled_body: string
  rewards_enabled: boolean
  reward_body: string
  updated_at: string | null
  /** false = la org todavía no guardó nada y se muestran los defaults. */
  existe: boolean
}

export interface PushAudiencePreview {
  /** Clientes que matchean los filtros. */
  total: number
  /** De esos, con la app instalada (token activo). */
  conApp: number
  /** De los que tienen la app, cuántos apagaron las campañas. */
  optOut: number
  /** Los que de verdad van a recibir: con app y con campañas activas. */
  alcanzables: number
  error?: string
}

export interface PushEnvioResultado {
  encolados: number
  audiencia: number
  sinApp: number
  estado: PushCampaignStatus
}

// ─── Guards ──────────────────────────────────────────────────────────────────

type Guard = { orgId: string } | { error: string }

async function requireView(): Promise<Guard> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Sesión expirada. Recargá la página e intentá de nuevo.' }
  if (!(await currentUserCan('notifications.view'))) return { error: 'No tenés permiso para ver las notificaciones.' }
  return { orgId }
}

async function requireManage(): Promise<Guard> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Sesión expirada. Recargá la página e intentá de nuevo.' }
  if (!(await currentUserCan('notifications.manage'))) return { error: 'No tenés permiso para gestionar notificaciones.' }
  return { orgId }
}

/**
 * Mensaje humano para los errores de PostgREST más probables en esta pantalla.
 * Mientras la migración 193 no corrió, PostgREST no contesta 42P01 sino
 * `PGRST205` ("Could not find the table 'public.push_campaigns' in the schema
 * cache") y, para las columnas nuevas de `client_device_tokens`, `PGRST204` /
 * `42703`. Todos significan lo mismo para el dueño: falta aplicar la migración.
 */
function traducirErrorDb(message: string | undefined, code?: string): string {
  const msg = message ?? ''
  if (
    code === '42P01' || code === 'PGRST205' || code === 'PGRST204' || code === '42703' ||
    /relation .* does not exist/i.test(msg) ||
    /Could not find the (table|'[^']+' column)/i.test(msg) ||
    /column .* does not exist/i.test(msg)
  ) {
    return 'Las tablas de notificaciones push todavía no están creadas en la base (migración 193). Avisale a quien administra el sistema; la pantalla queda lista para cuando se aplique.'
  }
  return msg || 'Error desconocido de la base de datos'
}

// ─── Helpers de fecha ────────────────────────────────────────────────────────

/**
 * Convierte fecha + hora de PARED de la organización en un instante.
 * Nunca `new Date('YYYY-MM-DDTHH:MM')`: en Vercel el proceso corre en UTC y
 * programar "a las 10:00" mandaría la campaña a las 07:00 argentinas.
 */
function instanteLocal(date: string, time: string, timezone: string): Date {
  const offset = getTzOffsetISO(new Date(`${date}T12:00:00Z`), timezone)
  return new Date(`${date}T${time}:00${offset}`)
}

// ─── Alcance de una audiencia ────────────────────────────────────────────────

/**
 * Dado un conjunto de client_ids, separa quiénes tienen la app (token activo)
 * y quiénes la tienen pero apagaron las campañas. Una query por cada 500 ids
 * y por tabla: la vista previa en vivo no puede tardar.
 */
async function resolverAlcance(
  supabase: ReturnType<typeof createAdminClient>,
  clientIds: string[],
): Promise<{ conToken: Set<string>; optOut: Set<string> } | { error: string }> {
  const conToken = new Set<string>()
  const optOut = new Set<string>()

  for (let i = 0; i < clientIds.length; i += CHUNK) {
    const chunk = clientIds.slice(i, i + CHUNK)

    const { data: tokens, error: tokErr } = await supabase
      .from('client_device_tokens')
      .select('client_id')
      .eq('is_active', true)
      .in('client_id', chunk)
    if (tokErr) return { error: traducirErrorDb(tokErr.message, tokErr.code) }
    for (const t of tokens ?? []) conToken.add(t.client_id as string)

    const { data: prefs, error: prefErr } = await supabase
      .from('client_notification_preferences')
      .select('client_id')
      .eq('campaigns', false)
      .in('client_id', chunk)
    if (prefErr) return { error: traducirErrorDb(prefErr.message, prefErr.code) }
    for (const p of prefs ?? []) optOut.add(p.client_id as string)
  }

  return { conToken, optOut }
}

// ─── Lectura ─────────────────────────────────────────────────────────────────

export async function getPushOverview(): Promise<PushOverview> {
  const vacio: PushOverview = {
    clientsWithApp: 0, activeTokens: 0, ios: 0, android: 0, recent: [],
    campaigns: { total: 0, sent: 0, scheduled: 0, pushSent: 0 }, outboxPending: 0,
  }
  const g = await requireView()
  if ('error' in g) return { ...vacio, error: g.error }
  const supabase = createAdminClient()

  // Tokens activos de la org. Un cliente suele tener 1–2 dispositivos, así que
  // traer `client_id, platform` y contar en memoria alcanza; el tope de 10.000
  // existe para que un día una org enorme no serialice la tabla entera.
  const { data: activos, error: tokErr } = await supabase
    .from('client_device_tokens')
    .select('client_id, platform, client:clients!inner(organization_id)')
    .eq('is_active', true)
    .eq('client.organization_id', g.orgId)
    .limit(10000)
  if (tokErr) {
    // Si la migración todavía no corrió, las columnas base existen igual; un
    // 42P01 acá sólo puede venir de otra cosa, pero lo tratamos igual.
    return { ...vacio, error: traducirErrorDb(tokErr.message, tokErr.code) }
  }

  const clientes = new Set<string>()
  let ios = 0
  let android = 0
  for (const t of activos ?? []) {
    clientes.add(t.client_id as string)
    if (t.platform === 'ios') ios++
    else if (t.platform === 'android') android++
  }

  const { data: recientes, error: recErr } = await supabase
    .from('client_device_tokens')
    .select('client_id, platform, app_version, last_seen_at, created_at, is_active, client:clients!inner(name, organization_id)')
    .eq('client.organization_id', g.orgId)
    .order('created_at', { ascending: false })
    .limit(15)
  // `app_version` / `last_seen_at` las agrega la migración 193: si todavía no
  // corrió, esta query falla con 42703 y lo decimos en vez de mostrar una tabla
  // vacía como si no hubiera dispositivos (Known Risk #13).
  let error: string | undefined = recErr
    ? `No pudimos leer los últimos registros: ${traducirErrorDb(recErr.message, recErr.code)}`
    : undefined

  const recent: PushDeviceRow[] = (recientes ?? []).map(r => {
    const c = r.client as unknown as { name: string } | { name: string }[] | null
    const nombre = Array.isArray(c) ? c[0]?.name : c?.name
    return {
      client_id: r.client_id as string,
      client_name: nombre ?? 'Cliente',
      platform: (r.platform as string) ?? 'android',
      app_version: (r.app_version as string | null) ?? null,
      last_seen_at: (r.last_seen_at as string | null) ?? null,
      created_at: r.created_at as string,
      is_active: !!r.is_active,
    }
  })

  // Resumen de campañas. Si la tabla no existe todavía, lo decimos en `error`
  // pero devolvemos los dispositivos igual: esa parte sí funciona.
  let campaigns = vacio.campaigns
  let outboxPending = 0
  const { data: camps, error: campErr } = await supabase
    .from('push_campaigns')
    .select('status, sent_count')
    .eq('organization_id', g.orgId)
    .limit(1000)
  if (campErr) {
    const msg = traducirErrorDb(campErr.message, campErr.code)
    error = error && !error.includes(msg) ? `${error} · ${msg}` : msg
  } else {
    campaigns = (camps ?? []).reduce(
      (acc, c) => {
        acc.total++
        if (c.status === 'sent') acc.sent++
        if (c.status === 'scheduled') acc.scheduled++
        acc.pushSent += Number(c.sent_count ?? 0)
        return acc
      },
      { total: 0, sent: 0, scheduled: 0, pushSent: 0 },
    )
    const { count } = await supabase
      .from('push_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', g.orgId)
      .eq('status', 'pending')
    outboxPending = count ?? 0
  }

  return {
    clientsWithApp: clientes.size,
    activeTokens: activos?.length ?? 0,
    ios, android, recent, campaigns, outboxPending, error,
  }
}

export async function listPushCampaigns(): Promise<{ data: PushCampaignRow[]; error: string | null }> {
  const g = await requireView()
  if ('error' in g) return { data: [], error: g.error }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('push_campaigns')
    .select('id, name, title, body, image_url, deep_link, audience_filters, status, scheduled_for, started_at, completed_at, audience_count, sent_count, failed_count, no_token_count, created_at')
    .eq('organization_id', g.orgId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return { data: [], error: traducirErrorDb(error.message, error.code) }
  return { data: (data ?? []) as PushCampaignRow[], error: null }
}

// ─── Audiencia ───────────────────────────────────────────────────────────────

const AudienceSchema = z.object({
  segments: z.array(z.string().max(40)).max(10).optional(),
  lastContactDays: z.number().int().min(0).max(3650).optional(),
  lastContactMin: z.number().int().min(0).max(3650).optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
  manualClientIds: z.array(z.string().uuid()).max(5000).optional(),
  hasPhone: z.boolean().optional(),
  branchIds: z.array(z.string().uuid()).max(50).optional(),
  lastVisitMaxDays: z.number().int().min(0).max(3650).optional(),
  lastVisitMinDays: z.number().int().min(0).max(3650).optional(),
  minVisits: z.number().int().min(0).max(100000).optional(),
  maxVisits: z.number().int().min(0).max(100000).optional(),
}).strict()

/** Saca los `undefined` para que el jsonb guardado quede limpio. */
function limpiarFiltros(f: AudienceFilters): AudienceFilters {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== null)) as AudienceFilters
}

export async function previewPushAudience(filters: AudienceFilters): Promise<PushAudiencePreview> {
  const vacio = { total: 0, conApp: 0, optOut: 0, alcanzables: 0 }
  const g = await requireView()
  if ('error' in g) return { ...vacio, error: g.error }

  const parsed = AudienceSchema.safeParse(filters ?? {})
  if (!parsed.success) return { ...vacio, error: 'Filtros de audiencia inválidos' }

  const { clients, error } = await getFilteredClientIds(parsed.data as AudienceFilters)
  if (error) return { ...vacio, error }
  if (clients.length === 0) return vacio

  const supabase = createAdminClient()
  const alcance = await resolverAlcance(supabase, clients.map(c => c.id))
  if ('error' in alcance) return { ...vacio, total: clients.length, error: alcance.error }

  let optOut = 0
  let alcanzables = 0
  for (const id of alcance.conToken) {
    if (alcance.optOut.has(id)) optOut++
    else alcanzables++
  }
  return { total: clients.length, conApp: alcance.conToken.size, optOut, alcanzables }
}

// ─── Campañas ────────────────────────────────────────────────────────────────

const CampaignSchema = z.object({
  name: z.string().trim().min(2, 'El nombre interno necesita al menos 2 caracteres').max(PUSH_NAME_MAX),
  title: z.string().trim().min(1, 'El título es obligatorio').max(PUSH_TITLE_MAX, `El título no puede superar ${PUSH_TITLE_MAX} caracteres`),
  body: z.string().trim().min(1, 'El cuerpo es obligatorio').max(PUSH_BODY_MAX, `El cuerpo no puede superar ${PUSH_BODY_MAX} caracteres`),
  imageUrl: z.string().trim().url().max(600).startsWith('https://', 'La imagen tiene que ser una URL https').nullable().optional(),
  deepLink: z.string().trim().max(120).nullable().optional(),
  audienceFilters: AudienceSchema.default({}),
  mode: z.enum(['draft', 'now', 'schedule']),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
})

export interface CreatePushCampaignInput {
  name: string
  title: string
  body: string
  imageUrl?: string | null
  deepLink?: string | null
  audienceFilters: AudienceFilters
  /** `draft` guarda; `now` encola ya; `schedule` encola con `scheduled_for` futuro. */
  mode: 'draft' | 'now' | 'schedule'
  /** Fecha y hora de PARED de la organización (sólo `schedule`). */
  scheduledDate?: string
  scheduledTime?: string
}

export async function createPushCampaign(input: CreatePushCampaignInput): Promise<
  | { data: PushCampaignRow; envio: PushEnvioResultado | null; error: null }
  /** Si la campaña se creó pero no se pudo encolar, `data` trae el borrador que quedó guardado. */
  | { error: string; data?: PushCampaignRow }
> {
  const g = await requireManage()
  if ('error' in g) return { error: g.error }

  const parsed = CampaignSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  const v = parsed.data

  // Destino: una de las rutas internas o /branch/<uuid> de una sucursal PROPIA.
  const deepLink = v.deepLink?.trim() || null
  if (deepLink && !esDeepLinkValido(deepLink)) return { error: 'El destino elegido no es válido' }
  const supabase = createAdminClient()
  const branchId = branchIdDeDeepLink(deepLink)
  if (branchId) {
    const { data: br } = await supabase
      .from('branches').select('id').eq('id', branchId).eq('organization_id', g.orgId).maybeSingle()
    if (!br) return { error: 'La sucursal del destino no pertenece a tu organización' }
  }

  // Programación en hora de pared de la org.
  let scheduledFor: string | null = null
  if (v.mode === 'schedule') {
    if (!v.scheduledDate || !v.scheduledTime) return { error: 'Elegí fecha y hora para programar la campaña' }
    const { timezone } = await getOrgLocaleContext()
    const instante = instanteLocal(v.scheduledDate, v.scheduledTime, timezone)
    if (Number.isNaN(instante.getTime())) return { error: 'La fecha programada no es válida' }
    if (instante.getTime() < Date.now() + 60_000) return { error: 'La fecha programada tiene que ser al menos un minuto en el futuro' }
    scheduledFor = instante.toISOString()
  }

  // Quién la creó, para la auditoría. Si no hay staff (owner sólo en
  // organization_members) queda NULL: no es motivo para frenar la campaña.
  let createdBy: string | null = null
  try {
    const auth = await createClient()
    const { data: { user } } = await auth.auth.getUser()
    if (user) {
      const { data: st } = await supabase
        .from('staff').select('id').eq('auth_user_id', user.id).eq('organization_id', g.orgId).maybeSingle()
      createdBy = st?.id ?? null
    }
  } catch {
    createdBy = null
  }

  const filtros = limpiarFiltros(v.audienceFilters as AudienceFilters)
  const { data, error } = await supabase
    .from('push_campaigns')
    .insert({
      organization_id: g.orgId,
      name: v.name,
      title: v.title,
      body: v.body,
      image_url: v.imageUrl ?? null,
      deep_link: deepLink,
      data: deepLink ? { type: 'campaign', deep_link: deepLink } : { type: 'campaign' },
      audience_filters: filtros,
      status: 'draft',
      scheduled_for: scheduledFor,
      created_by: createdBy,
    })
    .select('id, name, title, body, image_url, deep_link, audience_filters, status, scheduled_for, started_at, completed_at, audience_count, sent_count, failed_count, no_token_count, created_at')
    .single()
  if (error || !data) return { error: traducirErrorDb(error?.message, error?.code) }

  let campaign = data as PushCampaignRow
  let envio: PushEnvioResultado | null = null

  if (v.mode !== 'draft') {
    const r = await encolarCampania(supabase, g.orgId, campaign)
    if ('error' in r) {
      // La campaña quedó guardada (como borrador, o `failed` si la cola se
      // cortó a medias): la devolvemos junto con el motivo para que la pantalla
      // la muestre en la lista y el dueño no cree otra igual al reintentar.
      const { data: actual } = await supabase
        .from('push_campaigns')
        .select('id, name, title, body, image_url, deep_link, audience_filters, status, scheduled_for, started_at, completed_at, audience_count, sent_count, failed_count, no_token_count, created_at')
        .eq('id', campaign.id).eq('organization_id', g.orgId)
        .maybeSingle()
      revalidatePath(RUTA)
      return { error: r.error, data: (actual as PushCampaignRow | null) ?? { ...campaign, status: 'draft' } }
    }
    envio = r
    campaign = { ...campaign, status: r.estado, audience_count: r.audiencia, no_token_count: r.sinApp }
  }

  revalidatePath(RUTA)
  return { data: campaign, envio, error: null }
}

/**
 * Encola una campaña en `push_outbox`. Claim atómico `draft → sending|scheduled`
 * para que un doble click no duplique filas; si no hay nadie alcanzable la
 * devuelve a `draft` con el motivo, en vez de dejarla "enviando" para siempre
 * (sin filas en la cola la edge function nunca la cerraría).
 */
async function encolarCampania(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  campaign: PushCampaignRow,
): Promise<PushEnvioResultado | { error: string }> {
  const ahora = new Date()
  const programada = !!campaign.scheduled_for && new Date(campaign.scheduled_for).getTime() > ahora.getTime()
  const estadoDestino: PushCampaignStatus = programada ? 'scheduled' : 'sending'

  const { data: claimed, error: claimErr } = await supabase
    .from('push_campaigns')
    .update({ status: estadoDestino, started_at: ahora.toISOString(), updated_at: ahora.toISOString() })
    .eq('id', campaign.id)
    .eq('organization_id', orgId)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle()
  if (claimErr) return { error: 'No se pudo iniciar la campaña: ' + traducirErrorDb(claimErr.message, claimErr.code) }
  if (!claimed) return { error: 'La campaña ya está en proceso o fue enviada' }

  const volverABorrador = async (extra: Record<string, unknown> = {}) => {
    await supabase.from('push_campaigns')
      .update({ status: 'draft', started_at: null, updated_at: new Date().toISOString(), ...extra })
      .eq('id', campaign.id).eq('organization_id', orgId)
  }

  const { clients, error: filtErr } = await getFilteredClientIds((campaign.audience_filters ?? {}) as AudienceFilters)
  if (filtErr) { await volverABorrador(); return { error: filtErr } }
  if (clients.length === 0) {
    await volverABorrador({ audience_count: 0, no_token_count: 0 })
    return { error: 'No hay clientes que coincidan con los filtros de la campaña' }
  }

  const alcance = await resolverAlcance(supabase, clients.map(c => c.id))
  if ('error' in alcance) { await volverABorrador(); return { error: alcance.error } }

  const destinatarios = clients.map(c => c.id).filter(id => alcance.conToken.has(id) && !alcance.optOut.has(id))
  // "Sin app" agrupa a los que no tienen token activo Y a los que apagaron las
  // campañas: desde el punto de vista de la campaña, ninguno la puede recibir.
  const sinApp = clients.length - destinatarios.length

  if (destinatarios.length === 0) {
    await volverABorrador({ audience_count: clients.length, no_token_count: sinApp })
    return {
      error: `Ningún cliente de la audiencia tiene la app con notificaciones activas (${clients.length} en la audiencia). La campaña quedó como borrador.`,
    }
  }

  const scheduledFor = programada ? campaign.scheduled_for! : ahora.toISOString()
  const dataBase: Record<string, string> = { type: 'campaign', value: campaign.id }
  if (campaign.deep_link) dataBase.deep_link = campaign.deep_link

  for (let i = 0; i < destinatarios.length; i += CHUNK) {
    const filas = destinatarios.slice(i, i + CHUNK).map(clientId => ({
      organization_id: orgId,
      client_id: clientId,
      kind: 'campaign',
      title: campaign.title,
      body: campaign.body,
      image_url: campaign.image_url,
      data: dataBase,
      deep_link: campaign.deep_link,
      campaign_id: campaign.id,
      scheduled_for: scheduledFor,
      status: 'pending',
    }))
    const { error: insErr } = await supabase.from('push_outbox').insert(filas)
    if (insErr) {
      // Quedó a medias: cancelamos lo encolado y marcamos la campaña con
      // errores. Dejarla "enviando" con la mitad de la cola sería mentir.
      console.error('[push-notifications] insert push_outbox:', insErr.message)
      await supabase.from('push_outbox').update({ status: 'cancelled' })
        .eq('campaign_id', campaign.id).eq('status', 'pending')
      await supabase.from('push_campaigns')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', campaign.id).eq('organization_id', orgId)
      return { error: 'No se pudo encolar la campaña: ' + traducirErrorDb(insErr.message, insErr.code) }
    }
  }

  const { error: updErr } = await supabase
    .from('push_campaigns')
    .update({ audience_count: clients.length, no_token_count: sinApp, updated_at: new Date().toISOString() })
    .eq('id', campaign.id).eq('organization_id', orgId)
  if (updErr) console.error('[push-notifications] update contadores:', updErr.message)

  return { encolados: destinatarios.length, audiencia: clients.length, sinApp, estado: estadoDestino }
}

/**
 * Manda una campaña. Si está en borrador la encola; si está programada, la
 * adelanta a ahora (no vuelve a encolar: las filas ya existen, sólo se les
 * corre `scheduled_for`).
 */
export async function sendPushCampaign(campaignId: string): Promise<
  | { ok: true; envio: PushEnvioResultado }
  | { error: string }
> {
  const g = await requireManage()
  if ('error' in g) return { error: g.error }
  if (!isValidUUID(campaignId)) return { error: 'Campaña inválida' }
  const supabase = createAdminClient()

  const { data: campaign, error } = await supabase
    .from('push_campaigns')
    .select('id, name, title, body, image_url, deep_link, audience_filters, status, scheduled_for, started_at, completed_at, audience_count, sent_count, failed_count, no_token_count, created_at')
    .eq('id', campaignId)
    .eq('organization_id', g.orgId)
    .maybeSingle()
  if (error) return { error: traducirErrorDb(error.message, error.code) }
  if (!campaign) return { error: 'Campaña no encontrada' }
  const c = campaign as PushCampaignRow

  if (c.status === 'draft') {
    // "Enviar" desde un borrador programado respeta la hora programada; para
    // mandarlo ya hay que borrar la programación primero (es lo que hace la UI).
    const r = await encolarCampania(supabase, g.orgId, c)
    revalidatePath(RUTA)
    if ('error' in r) return { error: r.error }
    return { ok: true, envio: r }
  }

  if (c.status === 'scheduled') {
    const ahora = new Date().toISOString()
    const { data: claimed, error: claimErr } = await supabase
      .from('push_campaigns')
      .update({ status: 'sending', scheduled_for: ahora, updated_at: ahora })
      .eq('id', c.id).eq('organization_id', g.orgId).eq('status', 'scheduled')
      .select('id').maybeSingle()
    if (claimErr) return { error: traducirErrorDb(claimErr.message, claimErr.code) }
    if (!claimed) return { error: 'La campaña ya está en proceso o fue enviada' }

    const { data: movidas, error: outErr } = await supabase
      .from('push_outbox')
      .update({ scheduled_for: ahora })
      .eq('campaign_id', c.id).eq('status', 'pending')
      .select('id')
    if (outErr) return { error: 'La campaña pasó a enviando pero no se pudo adelantar la cola: ' + outErr.message }
    revalidatePath(RUTA)
    const encolados = movidas?.length ?? 0
    return {
      ok: true,
      envio: { encolados, audiencia: c.audience_count ?? encolados, sinApp: c.no_token_count ?? 0, estado: 'sending' },
    }
  }

  return { error: `La campaña está "${c.status}" y no se puede enviar` }
}

export async function cancelPushCampaign(campaignId: string): Promise<{ ok: true; canceladas: number } | { error: string }> {
  const g = await requireManage()
  if ('error' in g) return { error: g.error }
  if (!isValidUUID(campaignId)) return { error: 'Campaña inválida' }
  const supabase = createAdminClient()

  const { data: campaign } = await supabase
    .from('push_campaigns').select('id, status').eq('id', campaignId).eq('organization_id', g.orgId).maybeSingle()
  if (!campaign) return { error: 'Campaña no encontrada' }
  if (!['draft', 'scheduled', 'sending'].includes(campaign.status as string)) {
    return { error: 'Sólo se pueden cancelar campañas en borrador, programadas o en envío' }
  }

  const { data: canceladas, error: outErr } = await supabase
    .from('push_outbox')
    .update({ status: 'cancelled' })
    .eq('campaign_id', campaignId).eq('status', 'pending')
    .select('id')
  if (outErr) return { error: 'No se pudo cancelar la cola: ' + outErr.message }

  const { error } = await supabase
    .from('push_campaigns')
    .update({ status: 'cancelled', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', campaignId).eq('organization_id', g.orgId)
    .in('status', ['draft', 'scheduled', 'sending'])
  if (error) return { error: traducirErrorDb(error.message, error.code) }

  revalidatePath(RUTA)
  return { ok: true, canceladas: canceladas?.length ?? 0 }
}

/** Borra un borrador. Lo demás se cancela, no se borra: es historial. */
export async function deletePushCampaignDraft(campaignId: string): Promise<{ ok: true } | { error: string }> {
  const g = await requireManage()
  if ('error' in g) return { error: g.error }
  if (!isValidUUID(campaignId)) return { error: 'Campaña inválida' }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('push_campaigns')
    .delete()
    .eq('id', campaignId).eq('organization_id', g.orgId).eq('status', 'draft')
    .select('id')
  if (error) return { error: traducirErrorDb(error.message, error.code) }
  if (!data?.length) return { error: 'Sólo se pueden borrar borradores' }
  revalidatePath(RUTA)
  return { ok: true }
}

// ─── Prueba ──────────────────────────────────────────────────────────────────

const TestSchema = z.object({
  title: z.string().trim().min(1).max(PUSH_TITLE_MAX),
  body: z.string().trim().min(1).max(PUSH_BODY_MAX),
  imageUrl: z.string().trim().url().startsWith('https://').nullable().optional(),
  deepLink: z.string().trim().max(120).nullable().optional(),
})

/**
 * "Enviarme una prueba": encola la notificación al CLIENTE cuyo teléfono es el
 * del staff logueado. Así el dueño la ve en su propio celular antes de mandarla
 * a todos. Si no hay cliente con su teléfono, o lo hay pero sin la app, lo dice
 * con todas las letras en vez de encolar algo que nadie va a recibir.
 */
export async function sendTestPush(input: { title: string; body: string; imageUrl?: string | null; deepLink?: string | null }): Promise<
  | { ok: true; clientName: string; dispositivos: number }
  | { error: string }
> {
  const g = await requireManage()
  if ('error' in g) return { error: g.error }
  const parsed = TestSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Completá título y cuerpo para probar' }
  const v = parsed.data
  if (v.deepLink && !esDeepLinkValido(v.deepLink)) return { error: 'El destino elegido no es válido' }

  const supabase = createAdminClient()
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return { error: 'Sesión expirada' }

  const { data: staff } = await supabase
    .from('staff').select('id, phone, full_name')
    .eq('auth_user_id', user.id).eq('organization_id', g.orgId).maybeSingle()
  if (!staff?.phone) {
    return { error: 'Tu usuario no tiene teléfono cargado en Equipo. Cargalo para poder mandarte una prueba.' }
  }

  // Misma regla de match que el resto del sistema: últimos 10 dígitos.
  const { data: clientId, error: rpcErr } = await supabase.rpc('find_client_id_by_phone', { p_org: g.orgId, p_phone: staff.phone })
  if (rpcErr) return { error: 'No pudimos buscar tu cliente: ' + rpcErr.message }
  if (!clientId) {
    return { error: `No hay ningún cliente con tu teléfono (${staff.phone}). Registrate en la app con ese número y volvé a intentar.` }
  }

  const { data: client } = await supabase.from('clients').select('id, name').eq('id', clientId as string).maybeSingle()
  const { count, error: tokErr } = await supabase
    .from('client_device_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId as string).eq('is_active', true)
  if (tokErr) return { error: traducirErrorDb(tokErr.message, tokErr.code) }
  if (!count) {
    return { error: `Tu cliente "${client?.name ?? staff.full_name}" no tiene la app con notificaciones activas. Instalá la app con tu número y aceptá las notificaciones.` }
  }

  const data: Record<string, string> = { type: 'test' }
  if (v.deepLink) data.deep_link = v.deepLink
  const { error: insErr } = await supabase.from('push_outbox').insert({
    organization_id: g.orgId,
    client_id: clientId as string,
    kind: 'test',
    title: v.title,
    body: v.body,
    image_url: v.imageUrl ?? null,
    data,
    deep_link: v.deepLink ?? null,
    scheduled_for: new Date().toISOString(),
    status: 'pending',
  })
  if (insErr) return { error: traducirErrorDb(insErr.message, insErr.code) }

  return { ok: true, clientName: client?.name ?? staff.full_name, dispositivos: count }
}

// ─── Automáticas (push_settings) ─────────────────────────────────────────────

export async function getPushSettings(): Promise<{ data: PushSettingsData; error: string | null }> {
  const defaults: PushSettingsData = { ...PUSH_SETTINGS_DEFAULTS, updated_at: null, existe: false }
  const g = await requireView()
  if ('error' in g) return { data: defaults, error: g.error }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('push_settings')
    .select('reminders_enabled, reminder_hours, reminder_title, reminder_body_24h, reminder_body_2h, appointment_cancelled_enabled, appointment_cancelled_body, rewards_enabled, reward_body, updated_at')
    .eq('organization_id', g.orgId)
    .maybeSingle()
  if (error) return { data: defaults, error: traducirErrorDb(error.message, error.code) }
  if (!data) return { data: defaults, error: null }
  return {
    data: {
      reminders_enabled: !!data.reminders_enabled,
      reminder_hours: Array.isArray(data.reminder_hours) ? (data.reminder_hours as number[]) : PUSH_SETTINGS_DEFAULTS.reminder_hours,
      reminder_title: data.reminder_title ?? PUSH_SETTINGS_DEFAULTS.reminder_title,
      reminder_body_24h: data.reminder_body_24h ?? PUSH_SETTINGS_DEFAULTS.reminder_body_24h,
      reminder_body_2h: data.reminder_body_2h ?? PUSH_SETTINGS_DEFAULTS.reminder_body_2h,
      appointment_cancelled_enabled: !!data.appointment_cancelled_enabled,
      appointment_cancelled_body: data.appointment_cancelled_body ?? PUSH_SETTINGS_DEFAULTS.appointment_cancelled_body,
      rewards_enabled: !!data.rewards_enabled,
      reward_body: data.reward_body ?? PUSH_SETTINGS_DEFAULTS.reward_body,
      updated_at: (data.updated_at as string | null) ?? null,
      existe: true,
    },
    error: null,
  }
}

const SettingsSchema = z.object({
  reminders_enabled: z.boolean(),
  reminder_hours: z.array(z.number().int().min(1).max(PUSH_REMINDER_MAX_HOURS)).max(PUSH_REMINDER_MAX_ITEMS),
  reminder_title: z.string().trim().min(1, 'El título del recordatorio es obligatorio').max(PUSH_TITLE_MAX),
  reminder_body_24h: z.string().trim().min(1, 'El texto del recordatorio del día anterior es obligatorio').max(PUSH_BODY_MAX),
  reminder_body_2h: z.string().trim().min(1, 'El texto del recordatorio de las horas previas es obligatorio').max(PUSH_BODY_MAX),
  appointment_cancelled_enabled: z.boolean(),
  appointment_cancelled_body: z.string().trim().min(1, 'El texto de cancelación es obligatorio').max(PUSH_BODY_MAX),
  rewards_enabled: z.boolean(),
  reward_body: z.string().trim().min(1, 'El texto de premio nuevo es obligatorio').max(PUSH_BODY_MAX),
})

export interface SavePushSettingsInput {
  reminders_enabled: boolean
  reminder_hours: number[]
  reminder_title: string
  reminder_body_24h: string
  reminder_body_2h: string
  appointment_cancelled_enabled: boolean
  appointment_cancelled_body: string
  rewards_enabled: boolean
  reward_body: string
}

export async function savePushSettings(input: SavePushSettingsInput): Promise<{ data: PushSettingsData; error: null } | { error: string }> {
  const g = await requireManage()
  if ('error' in g) return { error: g.error }
  const parsed = SettingsSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  const v = parsed.data

  // Horas únicas y de mayor a menor (24 antes que 2): es el orden en que se
  // disparan y el que la pantalla muestra.
  const horas = Array.from(new Set(v.reminder_hours)).sort((a, b) => b - a)
  if (v.reminders_enabled && horas.length === 0) {
    return { error: 'Con los recordatorios activos tenés que elegir al menos una anticipación (por ejemplo 24 h).' }
  }

  const supabase = createAdminClient()
  const ahora = new Date().toISOString()
  const { error } = await supabase
    .from('push_settings')
    .upsert({
      organization_id: g.orgId,
      reminders_enabled: v.reminders_enabled,
      reminder_hours: horas,
      reminder_title: v.reminder_title,
      reminder_body_24h: v.reminder_body_24h,
      reminder_body_2h: v.reminder_body_2h,
      appointment_cancelled_enabled: v.appointment_cancelled_enabled,
      appointment_cancelled_body: v.appointment_cancelled_body,
      rewards_enabled: v.rewards_enabled,
      reward_body: v.reward_body,
      updated_at: ahora,
    }, { onConflict: 'organization_id' })
  if (error) return { error: traducirErrorDb(error.message, error.code) }

  revalidatePath(RUTA)
  return { data: { ...v, reminder_hours: horas, updated_at: ahora, existe: true }, error: null }
}

// ─── Imagen de campaña ───────────────────────────────────────────────────────

const MIMES_IMAGEN = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

/**
 * Sube la imagen de una campaña al bucket público `branding` (la notificación
 * la muestra FCM/APNs, así que tiene que ser una URL https pública). La
 * pantalla la comprime antes de mandarla; acá se valida tipo y peso igual.
 */
export async function uploadPushImage(formData: FormData): Promise<{ url: string } | { error: string }> {
  const g = await requireManage()
  if ('error' in g) return { error: g.error }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'No llegó ninguna imagen' }
  if (file.size > MAX_BYTES) return { error: 'La imagen pesa más de 5 MB. Probá con una más liviana.' }
  const tipo = (file.type || '').toLowerCase()
  if (!MIMES_IMAGEN.includes(tipo)) {
    return { error: tipo.includes('heic') || tipo.includes('heif')
      ? 'Ese formato (HEIC de iPhone) no se puede subir. Exportala como JPG.'
      : 'La imagen tiene que ser JPG, PNG o WEBP.' }
  }

  const supabase = createAdminClient()
  const ext = tipo.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
  const path = `push/${g.orgId}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await supabase.storage
    .from('branding')
    .upload(path, await file.arrayBuffer(), { contentType: tipo, cacheControl: '31536000', upsert: false })
  if (upErr) {
    console.error('[uploadPushImage] storage:', upErr.message)
    return { error: 'No pudimos subir la imagen: ' + upErr.message }
  }
  const { data } = supabase.storage.from('branding').getPublicUrl(path)
  return { url: data.publicUrl }
}
