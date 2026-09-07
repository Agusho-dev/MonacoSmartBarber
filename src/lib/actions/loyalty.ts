'use server'

// =============================================================================
// src/lib/actions/loyalty.ts
// Server actions de /dashboard/fidelizacion (programa de categorías, puntos,
// premios, referidos y notificaciones — migraciones 196/197).
//
// Las tablas loyalty_* no tienen policies para staff: TODO corre con la
// service role (`createAdminClient`), así que el scope por organización se
// impone acá, a mano, en cada query, y los permisos con `currentUserCan`
// (`rewards.view` para leer, `rewards.manage` para tocar). Un export de un
// archivo 'use server' es un endpoint HTTP: nada que llegue por argumento se
// confía sin validar (Zod) y todo id se verifica contra la org antes de usarlo.
//
// Contrato: las lecturas devuelven `{ data }` | `{ error }`; las mutaciones
// `{ success: true, … }` | `{ error }`. Nunca se lanza hacia la UI.
// =============================================================================

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { getCurrentOrgId } from './org'
import { currentUserCan } from './permissions-gate'
import { isValidUUID } from '@/lib/validation'
import type {
  LoyaltyClientSummary,
  LoyaltyDistribution,
  LoyaltyMaintenanceResult,
  LoyaltyNotificationRule,
  LoyaltyNotificationRuleInput,
  LoyaltyOverview,
  LoyaltyReward,
  LoyaltyRewardInput,
  LoyaltyService,
  LoyaltySettings,
  LoyaltySettingsInput,
  LoyaltyTier,
  LoyaltyTierInput,
  Referral,
} from '@/lib/types/loyalty'
import { LOYALTY_TIER_CODES } from '@/lib/types/loyalty'

const RUTA = '/dashboard/fidelizacion'

type Ok<T = object> = { success: true } & T
type Err = { error: string }
type Read<T> = { data: T } | Err

// ─── Guards ──────────────────────────────────────────────────────────────────

async function requireView(): Promise<{ orgId: string } | Err> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Sesión vencida. Volvé a iniciar sesión.' }
  if (!(await currentUserCan('rewards.view'))) return { error: 'No tenés permiso para ver el programa de fidelización.' }
  return { orgId }
}

async function requireManage(): Promise<{ orgId: string } | Err> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Sesión vencida. Volvé a iniciar sesión.' }
  if (!(await currentUserCan('rewards.manage'))) return { error: 'No tenés permiso para modificar el programa de fidelización.' }
  return { orgId }
}

/** Si la org todavía no tiene fila en loyalty_settings, la crea con sus 4 categorías y 12 reglas. */
async function asegurarSeed(orgId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('loyalty_settings').select('organization_id').eq('organization_id', orgId).maybeSingle()
  if (data) return null
  const { error } = await supabase.rpc('loyalty_seed_org', { p_org: orgId })
  if (error) {
    console.error('[loyalty] loyalty_seed_org:', error.message)
    return 'No pudimos inicializar el programa: ' + error.message
  }
  return null
}

const uuid = z.string().refine(isValidUUID, 'Identificador inválido')
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido (usá #RRGGBB)')
const tierCode = z.enum(['bronce', 'plata', 'oro', 'platinum'])

// ─── Mensajes de validación en castellano ────────────────────────────────────
// Los mensajes por defecto de Zod ("Number must be greater than or equal to 1")
// llegaban tal cual al toast. El errorMap se pasa POR LLAMADA y no con
// `z.setErrorMap`: ese es global al proceso y cambiaría el texto de los errores
// de otras server actions según qué módulo se importó primero en la instancia.
// Los mensajes propios escritos inline (`.min(1, '…')`) tienen prioridad.

const ETIQUETAS: Record<string, string> = {
  name: 'El nombre', description: 'La descripción', points_cost: 'Los puntos necesarios',
  discount_pct: 'El descuento', stock: 'El stock', validity_days: 'La vigencia (días)',
  sort_order: 'El orden', image_url: 'La imagen', benefits: 'Los beneficios',
  multiplier_pct: 'El multiplicador', min_visits: 'El mínimo de visitas', max_visits: 'El máximo de visitas',
  window_weeks: 'La ventana (semanas)', grace_days: 'Los días de gracia', base_points: 'Los puntos base',
  points_expiry_days: 'El vencimiento de puntos', welcome_bonus_points: 'El bono de bienvenida',
  reward_validity_days: 'La vigencia del beneficio', expiring_soon_days: 'La ventana de por vencer',
  referral_new_client_discount_pct: 'El descuento del referido', referral_new_client_points: 'Los puntos del referido',
  referral_referrer_points: 'Los puntos del que recomienda', referral_max_per_referrer: 'El límite por cliente',
  referral_valid_from: 'La fecha de inicio', referral_valid_until: 'La fecha de fin',
  valid_from: 'La fecha de inicio', valid_until: 'La fecha de fin', allowed_tiers: 'Las categorías habilitadas',
  days_before: 'Los días de anticipación', title: 'El título', body: 'El texto', reason: 'El motivo', points: 'Los puntos',
  code: 'El código de categoría', kind: 'El tipo', category: 'La categoría en la app',
  color_primary: 'El color de inicio', color_secondary: 'El color de fin', text_color: 'El color del texto',
}

const errorMapEs: z.ZodErrorMap = (issue, ctx) => {
  const campo = ETIQUETAS[String(issue.path[0] ?? '')] ?? 'El valor'
  switch (issue.code) {
    case 'too_small':
      return { message: issue.type === 'string'
        ? `${campo} tiene que tener al menos ${issue.minimum} caracteres`
        : issue.type === 'array' ? `${campo}: faltan elementos (mínimo ${issue.minimum})`
        : `${campo} tiene que ser como mínimo ${issue.minimum}` }
    case 'too_big':
      return { message: issue.type === 'string'
        ? `${campo} tiene un máximo de ${issue.maximum} caracteres`
        : issue.type === 'array' ? `${campo}: hasta ${issue.maximum} elementos`
        : `${campo} tiene que ser como máximo ${issue.maximum}` }
    case 'invalid_string':
      return { message: issue.validation === 'url' ? `${campo} no es una URL válida`
        : issue.validation === 'datetime' ? `${campo} no es una fecha válida` : `${campo} no es válido` }
    case 'invalid_type':
      return { message: issue.received === 'undefined' || issue.received === 'null' ? `${campo} es obligatorio`
        : issue.expected === 'integer' ? `${campo} tiene que ser un número entero` : `${campo} no es válido` }
    case 'invalid_enum_value':
      return { message: `${campo} tiene un valor desconocido` }
    default:
      return { message: ctx.defaultError }
  }
}

function primerError(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Datos inválidos'
}

/**
 * Quién está operando, para la auditoría de los ajustes de puntos, las
 * cancelaciones de beneficios y las reversiones. Resuelve el usuario de
 * Supabase Auth y su fila de `staff` en la org; un owner que sólo vive en
 * `organization_members` no tiene staff y queda sólo con `userId`.
 *
 * NUNCA meter el email ni el nombre del actor en `reason`/`description`: ese
 * texto llega al teléfono del cliente (`get_client_point_history`, historial
 * de la app). La atribución viaja por `p_staff_id` / `p_actor_user_id`.
 */
async function actorActual(orgId: string): Promise<{ staffId: string | null; userId: string | null }> {
  try {
    const auth = await createClient()
    const { data: { user } } = await auth.auth.getUser()
    if (!user) return { staffId: null, userId: null }
    const { data: st } = await createAdminClient()
      .from('staff').select('id').eq('auth_user_id', user.id).eq('organization_id', orgId).maybeSingle()
    return { staffId: st?.id ?? null, userId: user.id }
  } catch {
    return { staffId: null, userId: null }
  }
}

// ─── Resumen ─────────────────────────────────────────────────────────────────

export async function getLoyaltyOverview(): Promise<Read<LoyaltyOverview>> {
  const g = await requireView()
  if ('error' in g) return g
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('loyalty_dashboard_overview', { p_org: g.orgId })
  if (error) {
    console.error('[loyalty] loyalty_dashboard_overview:', error.message)
    return { error: 'No pudimos leer el resumen del programa: ' + error.message }
  }
  const raw = data as Partial<LoyaltyOverview> | null
  // La RPC arma `settings` con to_jsonb sobre un %ROWTYPE: si la org no tiene
  // fila, no viene NULL sino un objeto con las 18 claves en null. Se detecta
  // por `organization_id`, que en una fila real nunca es null.
  const settings = raw?.settings?.organization_id ? raw.settings : null
  return {
    data: {
      settings,
      tiers: raw?.tiers ?? [],
      points: raw?.points ?? { issued_30d: 0, redeemed_30d: 0, expired_30d: 0, live_balance: 0, expiring_30d: 0, clients_with_points: 0 },
      rewards: raw?.rewards ?? { available: 0, used_30d: 0, expired_30d: 0 },
      referrals: raw?.referrals ?? { completed_30d: 0, completed_total: 0, pending: 0 },
      events: raw?.events ?? [],
      in_grace: raw?.in_grace ?? 0,
      distribution_preview: raw?.distribution_preview ?? null,
      errors_7d: raw?.errors_7d ?? 0,
    },
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getLoyaltySettings(): Promise<Read<LoyaltySettings>> {
  const g = await requireView()
  if ('error' in g) return g
  const seedErr = await asegurarSeed(g.orgId)
  if (seedErr) return { error: seedErr }
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('loyalty_settings').select('*').eq('organization_id', g.orgId).maybeSingle()
  if (error || !data) return { error: 'No pudimos leer la configuración: ' + (error?.message ?? 'sin fila') }
  return { data: data as LoyaltySettings }
}

const settingsSchema = z.object({
  window_weeks: z.number().int().min(1).max(104),
  grace_days: z.number().int().min(0).max(365),
  base_points: z.number().int().min(0).max(100000),
  points_expiry_days: z.number().int().min(1).max(3650),
  welcome_bonus_points: z.number().int().min(0).max(100000),
  reward_validity_days: z.number().int().min(1).max(365),
  expiring_soon_days: z.number().int().min(1).max(90),
  referral_enabled: z.boolean(),
  referral_new_client_discount_pct: z.number().int().min(0).max(100),
  referral_new_client_points: z.number().int().min(0).max(100000),
  referral_referrer_points: z.number().int().min(0).max(100000),
  referral_valid_from: z.string().datetime({ offset: true }).nullable(),
  referral_valid_until: z.string().datetime({ offset: true }).nullable(),
  referral_max_per_referrer: z.number().int().positive().nullable(),
}).partial()

/** Merge: sólo escribe las claves que llegaron definidas. */
export async function saveLoyaltySettings(input: LoyaltySettingsInput): Promise<Ok<{ data: LoyaltySettings }> | Err> {
  const g = await requireManage()
  if ('error' in g) return g
  const parsed = settingsSchema.safeParse(input, { errorMap: errorMapEs })
  if (!parsed.success) return { error: primerError(parsed.error) }

  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))
  if (patch.referral_valid_from && patch.referral_valid_until
      && new Date(patch.referral_valid_from as string) > new Date(patch.referral_valid_until as string)) {
    return { error: 'La vigencia de referidos termina antes de empezar.' }
  }

  const seedErr = await asegurarSeed(g.orgId)
  if (seedErr) return { error: seedErr }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('loyalty_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('organization_id', g.orgId)
    .select('*')
    .single()
  if (error) {
    console.error('[loyalty] saveLoyaltySettings:', error.message)
    return { error: 'No pudimos guardar la configuración: ' + error.message }
  }
  revalidatePath(RUTA)
  return { success: true, data: data as LoyaltySettings }
}

export async function setLoyaltyProgramEnabled(enabled: boolean): Promise<Ok<{ enrolled: number }> | Err> {
  const g = await requireManage()
  if ('error' in g) return g
  if (typeof enabled !== 'boolean') return { error: 'Valor inválido' }
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('loyalty_set_program_enabled', { p_org: g.orgId, p_enabled: enabled })
  if (error) {
    console.error('[loyalty] loyalty_set_program_enabled:', error.message)
    return { error: (enabled ? 'No pudimos activar el programa: ' : 'No pudimos apagar el programa: ') + error.message }
  }
  revalidatePath(RUTA)
  revalidatePath('/dashboard/app-movil')
  return { success: true, enrolled: Number((data as { enrolled?: number } | null)?.enrolled ?? 0) }
}

// ─── Categorías ──────────────────────────────────────────────────────────────

export async function getLoyaltyTiers(): Promise<Read<LoyaltyTier[]>> {
  const g = await requireView()
  if ('error' in g) return g
  const seedErr = await asegurarSeed(g.orgId)
  if (seedErr) return { error: seedErr }
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('loyalty_tiers').select('*').eq('organization_id', g.orgId).order('sort_order')
  if (error) return { error: 'No pudimos leer las categorías: ' + error.message }
  return { data: (data ?? []) as LoyaltyTier[] }
}

const tierSchema = z.object({
  code: tierCode,
  name: z.string().trim().min(1, 'Cada categoría necesita un nombre').max(40, 'Nombre demasiado largo'),
  min_visits: z.number().int().min(0).max(999),
  max_visits: z.number().int().min(0).max(999).nullable(),
  multiplier_pct: z.number().int().min(100, 'El multiplicador mínimo es 100 %').max(500, 'El multiplicador máximo es 500 %'),
  color_primary: hex,
  color_secondary: hex,
  text_color: hex,
  benefits: z.array(z.string().trim().min(1).max(90)).max(8, 'Hasta 8 beneficios por categoría'),
})

/**
 * Reescribe las 4 categorías juntas. Valida que los rangos sean contiguos y
 * ascendentes: bronce arranca en 0, cada mínimo es el máximo anterior + 1 y
 * platinum no tiene tope. Es la única forma de razonar sobre el conjunto.
 */
export async function saveLoyaltyTiers(tiers: LoyaltyTierInput[]): Promise<Ok | Err> {
  const g = await requireManage()
  if ('error' in g) return g
  const parsed = z.array(tierSchema).length(4, 'Tienen que ser exactamente 4 categorías').safeParse(tiers, { errorMap: errorMapEs })
  if (!parsed.success) return { error: primerError(parsed.error) }

  const porCodigo = new Map(parsed.data.map(t => [t.code, t]))
  if (porCodigo.size !== 4) return { error: 'Falta alguna categoría (bronce, plata, oro, platinum).' }
  const ordenadas = LOYALTY_TIER_CODES.map(c => porCodigo.get(c)!)

  if (ordenadas[0].min_visits !== 0) return { error: 'Bronce tiene que empezar en 0 visitas.' }
  if (ordenadas[3].max_visits !== null) return { error: 'Platinum no puede tener tope de visitas.' }
  for (let i = 0; i < 3; i++) {
    const t = ordenadas[i]
    const sig = ordenadas[i + 1]
    if (t.max_visits === null) return { error: `${t.name} necesita un máximo de visitas.` }
    if (t.max_visits < t.min_visits) return { error: `${t.name}: el máximo no puede ser menor al mínimo.` }
    if (sig.min_visits !== t.max_visits + 1) {
      return { error: `Los rangos tienen que ser contiguos: ${sig.name} debería empezar en ${t.max_visits + 1} visitas.` }
    }
  }

  const seedErr = await asegurarSeed(g.orgId)
  if (seedErr) return { error: seedErr }

  const supabase = createAdminClient()
  const now = new Date().toISOString()
  // Una sola sentencia (INSERT … ON CONFLICT): las 4 categorías se escriben
  // juntas o no se escribe ninguna, que es lo único que hace valer la
  // validación de contigüidad de arriba. Cuatro UPDATEs sueltos dejaban
  // rangos solapados si el tercero fallaba. El seed mapea bronce=1 … platinum=4,
  // igual que el índice de LOYALTY_TIER_CODES, así que `sort_order` no choca
  // con UNIQUE (organization_id, sort_order); `id` e `is_active` quedan intactos.
  const filas = ordenadas.map((t, i) => ({
    organization_id: g.orgId, code: t.code, sort_order: i + 1,
    name: t.name, min_visits: t.min_visits, max_visits: t.max_visits, multiplier_pct: t.multiplier_pct,
    color_primary: t.color_primary, color_secondary: t.color_secondary, text_color: t.text_color,
    benefits: t.benefits, updated_at: now,
  }))
  const { error } = await supabase.from('loyalty_tiers').upsert(filas, { onConflict: 'organization_id,code' })
  if (error) {
    console.error('[loyalty] saveLoyaltyTiers:', error.message)
    return { error: 'No pudimos guardar las categorías: ' + error.message }
  }
  revalidatePath(RUTA)
  return { success: true }
}

export async function previewLoyaltyDistribution(windowWeeks: number, thresholds: [number, number, number]): Promise<Read<LoyaltyDistribution>> {
  const g = await requireView()
  if ('error' in g) return g
  const parsed = z.object({
    windowWeeks: z.number().int().min(1).max(104),
    thresholds: z.tuple([z.number().int().min(1), z.number().int().min(2), z.number().int().min(3)]),
  }).safeParse({ windowWeeks, thresholds })
  if (!parsed.success) return { error: 'Umbrales inválidos' }
  const [a, b, c] = parsed.data.thresholds
  if (!(a < b && b < c)) return { error: 'Los umbrales tienen que ser crecientes' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('loyalty_preview_distribution', {
    p_org: g.orgId, p_window_weeks: parsed.data.windowWeeks, p_thresholds: [a, b, c],
  })
  if (error) return { error: 'No pudimos simular la distribución: ' + error.message }
  return { data: data as LoyaltyDistribution }
}

// ─── Premios ─────────────────────────────────────────────────────────────────

const REWARD_SELECT = '*, service:service_id(name)'

export async function listRewards(): Promise<Read<LoyaltyReward[]>> {
  const g = await requireView()
  if ('error' in g) return g
  const supabase = createAdminClient()
  const [{ data, error }, usos] = await Promise.all([
    supabase.from('reward_catalog').select(REWARD_SELECT).eq('organization_id', g.orgId)
      .order('sort_order').order('points_cost').order('created_at', { ascending: false }),
    // PostgREST corta en 1000 filas sin avisar: un SELECT pelado subcontaba
    // los canjes en silencio pasado ese tope. `fetchAll` pagina; el `.order('id')`
    // es necesario para que `.range()` sea estable entre páginas.
    fetchAll<{ reward_id: string | null }>((from, to) =>
      supabase.from('client_rewards').select('reward_id').eq('organization_id', g.orgId).not('reward_id', 'is', null).order('id').range(from, to)),
  ])
  if (error) return { error: 'No pudimos leer los premios: ' + error.message }
  const conteo = new Map<string, number>()
  for (const u of usos) if (u.reward_id) conteo.set(u.reward_id, (conteo.get(u.reward_id) ?? 0) + 1)
  const rewards = ((data ?? []) as LoyaltyReward[]).map(r => ({ ...r, redemptions_count: conteo.get(r.id) ?? 0 }))
  return { data: rewards }
}

const rewardSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, 'El premio necesita un nombre').max(80),
  description: z.string().trim().max(400).nullable(),
  kind: z.enum(['descuento', 'merch', 'especial']),
  points_cost: z.number().int().min(1, 'Los puntos tienen que ser mayores a 0').max(1000000),
  discount_pct: z.number().int().min(1, 'El descuento tiene que ser entre 1 y 100 %').max(100, 'El descuento tiene que ser entre 1 y 100 %').nullable(),
  service_id: uuid.nullable(),
  stock: z.number().int().min(0).max(100000).nullable(),
  validity_days: z.number().int().min(1).max(365).nullable(),
  allowed_tiers: z.array(tierCode).min(1).nullable(),
  allow_stacking: z.boolean(),
  valid_from: z.string().datetime({ offset: true }).nullable(),
  valid_until: z.string().datetime({ offset: true }).nullable(),
  is_active: z.boolean(),
  is_featured: z.boolean(),
  category: z.enum(['cortes', 'merch']).nullable(),
  image_url: z.string().url().max(600).nullable(),
  sort_order: z.number().int().min(0).max(9999),
})

export async function saveReward(input: LoyaltyRewardInput): Promise<Ok<{ data: LoyaltyReward }> | Err> {
  const g = await requireManage()
  if ('error' in g) return g
  const parsed = rewardSchema.safeParse(input, { errorMap: errorMapEs })
  if (!parsed.success) return { error: primerError(parsed.error) }
  const r = parsed.data

  if (r.kind === 'descuento' && !r.discount_pct) return { error: 'Un descuento necesita el porcentaje (1 a 100).' }
  if (r.valid_from && r.valid_until && new Date(r.valid_from) > new Date(r.valid_until)) {
    return { error: 'La fecha de fin es anterior a la de inicio.' }
  }
  // Un allowed_tiers con las 4 categorías es lo mismo que "todas": se guarda NULL.
  const allowed = r.allowed_tiers && r.allowed_tiers.length >= 4 ? null : r.allowed_tiers

  const supabase = createAdminClient()
  if (r.service_id) {
    const err = await servicioEsDeLaOrg(r.service_id, g.orgId)
    if (err) return { error: err }
  }

  const esDescuento = r.kind === 'descuento'
  const fila = {
    organization_id: g.orgId,
    type: 'points_redemption',
    name: r.name,
    description: r.description,
    kind: r.kind,
    points_cost: r.points_cost,
    discount_pct: esDescuento ? r.discount_pct : null,
    is_free_service: esDescuento && r.discount_pct === 100,
    service_id: esDescuento ? r.service_id : null,
    stock: r.kind === 'merch' ? r.stock : (r.stock ?? null),
    validity_days: r.validity_days,
    allowed_tiers: allowed,
    allow_stacking: r.allow_stacking,
    valid_from: r.valid_from,
    valid_until: r.valid_until,
    is_active: r.is_active,
    is_featured: r.is_featured,
    category: r.category,
    image_url: r.image_url,
    sort_order: r.sort_order,
    updated_at: new Date().toISOString(),
  }

  const query = r.id
    ? supabase.from('reward_catalog').update(fila).eq('id', r.id).eq('organization_id', g.orgId).select(REWARD_SELECT).single()
    : supabase.from('reward_catalog').insert(fila).select(REWARD_SELECT).single()
  const { data, error } = await query
  if (error) {
    console.error('[loyalty] saveReward:', error.message)
    return { error: 'No pudimos guardar el premio: ' + error.message }
  }
  revalidatePath(RUTA)
  revalidatePath('/dashboard/app-movil')
  return { success: true, data: data as LoyaltyReward }
}

export async function toggleReward(id: string, active: boolean): Promise<Ok | Err> {
  const g = await requireManage()
  if ('error' in g) return g
  if (!isValidUUID(id) || typeof active !== 'boolean') return { error: 'Datos inválidos' }
  const supabase = createAdminClient()
  const { error, data } = await supabase.from('reward_catalog')
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq('id', id).eq('organization_id', g.orgId).select('id')
  if (error) return { error: 'No pudimos cambiar el estado: ' + error.message }
  if (!data?.length) return { error: 'El premio no existe.' }
  revalidatePath(RUTA)
  return { success: true }
}

/** Si el premio ya fue canjeado alguna vez, se desactiva en vez de borrarse (los canjes lo referencian). */
export async function deleteReward(id: string): Promise<Ok<{ deactivated: boolean }> | Err> {
  const g = await requireManage()
  if ('error' in g) return g
  if (!isValidUUID(id)) return { error: 'Identificador inválido' }
  const supabase = createAdminClient()
  const { count } = await supabase.from('client_rewards').select('id', { count: 'exact', head: true }).eq('reward_id', id)
  if ((count ?? 0) > 0) {
    const { error } = await supabase.from('reward_catalog')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id).eq('organization_id', g.orgId)
    if (error) return { error: 'No pudimos desactivar el premio: ' + error.message }
    revalidatePath(RUTA)
    return { success: true, deactivated: true }
  }
  const { error } = await supabase.from('reward_catalog').delete().eq('id', id).eq('organization_id', g.orgId)
  if (error) return { error: 'No pudimos borrar el premio: ' + error.message }
  revalidatePath(RUTA)
  return { success: true, deactivated: false }
}

const MAX_BYTES = 5 * 1024 * 1024
const MIMES_IMAGEN = ['image/jpeg', 'image/png', 'image/webp']

export async function uploadRewardImage(formData: FormData): Promise<{ url: string } | Err> {
  const g = await requireManage()
  if ('error' in g) return g
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
  const path = `rewards/${g.orgId}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await supabase.storage
    .from('branding')
    .upload(path, await file.arrayBuffer(), { contentType: tipo, cacheControl: '31536000', upsert: false })
  if (upErr) {
    console.error('[uploadRewardImage] storage:', upErr.message)
    return { error: 'No pudimos subir la imagen: ' + upErr.message }
  }
  const { data } = supabase.storage.from('branding').getPublicUrl(path)
  return { url: data.publicUrl }
}

// ─── Servicios que cuentan como visita ───────────────────────────────────────

async function branchesDeLaOrg(orgId: string): Promise<{ id: string; name: string }[]> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('branches').select('id, name').eq('organization_id', orgId).order('name')
  return (data ?? []) as { id: string; name: string }[]
}

/**
 * `services` no tiene organization_id: la org se resuelve por `branch_id`.
 * Un servicio con branch_id NULL no pertenece a ninguna org, así que un
 * endpoint no puede aceptarlo como propio: antes ese caso salteaba el chequeo
 * y cualquier org podía colgarle un premio o cambiarle `counts_as_visit`.
 * Devuelve el mensaje de error, o null si el servicio es de la org.
 */
async function servicioEsDeLaOrg(serviceId: string, orgId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data: svc } = await supabase.from('services').select('id, branch_id').eq('id', serviceId).maybeSingle()
  if (!svc) return 'El servicio elegido no existe.'
  if (!svc.branch_id) return 'Ese servicio no pertenece a ninguna sucursal de tu organización.'
  const { data: br } = await supabase.from('branches').select('id').eq('id', svc.branch_id).eq('organization_id', orgId).maybeSingle()
  if (!br) return 'Ese servicio no es de tu organización.'
  return null
}

export async function listServicesForLoyalty(): Promise<Read<LoyaltyService[]>> {
  const g = await requireView()
  if ('error' in g) return g
  const supabase = createAdminClient()
  const branches = await branchesDeLaOrg(g.orgId)
  const ids = branches.map(b => b.id)
  const nombre = new Map(branches.map(b => [b.id, b.name]))
  // services no tiene organization_id: el scope es branch_id de la org o NULL (global).
  const filtro = ids.length ? `branch_id.is.null,branch_id.in.(${ids.join(',')})` : 'branch_id.is.null'
  const { data, error } = await supabase
    .from('services')
    .select('id, name, price, branch_id, counts_as_visit, is_active')
    .or(filtro)
    .eq('is_active', true)
    .order('name')
  if (error) return { error: 'No pudimos leer los servicios: ' + error.message }
  const services = ((data ?? []) as Omit<LoyaltyService, 'branch_name'>[]).map(s => ({
    ...s, price: Number(s.price), branch_name: s.branch_id ? (nombre.get(s.branch_id) ?? null) : null,
  }))
  return { data: services }
}

export async function setServiceCountsAsVisit(serviceId: string, counts: boolean): Promise<Ok | Err> {
  const g = await requireManage()
  if ('error' in g) return g
  if (!isValidUUID(serviceId) || typeof counts !== 'boolean') return { error: 'Datos inválidos' }
  const scopeErr = await servicioEsDeLaOrg(serviceId, g.orgId)
  if (scopeErr) return { error: scopeErr }
  const supabase = createAdminClient()
  const { error } = await supabase.from('services').update({ counts_as_visit: counts, updated_at: new Date().toISOString() }).eq('id', serviceId)
  if (error) return { error: 'No pudimos guardar: ' + error.message }
  revalidatePath(RUTA)
  return { success: true }
}

// ─── Referidos ───────────────────────────────────────────────────────────────

export async function listReferrals(limit = 50): Promise<Read<Referral[]>> {
  const g = await requireView()
  if ('error' in g) return g
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const supabase = createAdminClient()
  // referrals tiene DOS FKs a clients: el embed va por columna, nunca por tabla (Known Risk #17).
  const { data, error } = await supabase
    .from('referrals')
    .select('*, referrer:referrer_client_id(name), referred:referred_client_id(name), branch:branch_id(name), service:service_id(name)')
    .eq('organization_id', g.orgId)
    .order('created_at', { ascending: false })
    .limit(n)
  if (error) return { error: 'No pudimos leer los referidos: ' + error.message }
  return { data: (data ?? []) as Referral[] }
}

// ─── Notificaciones ──────────────────────────────────────────────────────────

export async function listNotificationRules(): Promise<Read<LoyaltyNotificationRule[]>> {
  const g = await requireView()
  if ('error' in g) return g
  const seedErr = await asegurarSeed(g.orgId)
  if (seedErr) return { error: seedErr }
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('loyalty_notification_rules').select('*').eq('organization_id', g.orgId).order('sort_order')
  if (error) return { error: 'No pudimos leer las notificaciones: ' + error.message }
  return { data: (data ?? []) as LoyaltyNotificationRule[] }
}

const ruleKind = z.enum([
  'tier_up', 'tier_grace_warning', 'tier_grace_reminder', 'tier_down', 'near_tier',
  'points_earned', 'points_expiring', 'reward_unlocked', 'near_reward', 'benefit_new',
  'referral_completed_referrer', 'referral_completed_referred',
])
const ruleSchema = z.object({
  is_enabled: z.boolean().optional(),
  title: z.string().trim().min(1, 'El título no puede quedar vacío').max(65, 'El título tiene un máximo de 65 caracteres').optional(),
  body: z.string().trim().min(1, 'El texto no puede quedar vacío').max(240, 'El texto tiene un máximo de 240 caracteres').optional(),
  days_before: z.number().int().min(0).max(90).nullable().optional(),
})

export async function saveNotificationRule(kind: string, input: LoyaltyNotificationRuleInput): Promise<Ok<{ data: LoyaltyNotificationRule }> | Err> {
  const g = await requireManage()
  if ('error' in g) return g
  const k = ruleKind.safeParse(kind)
  if (!k.success) return { error: 'Tipo de notificación desconocido' }
  const parsed = ruleSchema.safeParse(input, { errorMap: errorMapEs })
  if (!parsed.success) return { error: primerError(parsed.error) }
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))
  if (!Object.keys(patch).length) return { error: 'No hay cambios para guardar' }

  const seedErr = await asegurarSeed(g.orgId)
  if (seedErr) return { error: seedErr }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('loyalty_notification_rules')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('organization_id', g.orgId)
    .eq('kind', k.data)
    .select('*')
    .maybeSingle()
  if (error) return { error: 'No pudimos guardar la notificación: ' + error.message }
  if (!data) return { error: 'La regla no existe para tu organización.' }
  revalidatePath(RUTA)
  return { success: true, data: data as LoyaltyNotificationRule }
}

// ─── Clientes ────────────────────────────────────────────────────────────────

export interface LoyaltyClientHit { id: string; name: string; phone: string }

export async function searchLoyaltyClients(q: string): Promise<Read<LoyaltyClientHit[]>> {
  const g = await requireView()
  if ('error' in g) return g
  const trimmed = (q ?? '').trim()
  if (trimmed.length < 2) return { data: [] }
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('quick_search_clients', {
    p_organization_id: g.orgId, p_query: trimmed.slice(0, 80), p_limit: 8,
  })
  if (error) return { error: 'No pudimos buscar: ' + error.message }
  return { data: (data ?? []) as LoyaltyClientHit[] }
}

async function clienteEsDeLaOrg(clientId: string, orgId: string): Promise<boolean> {
  if (!isValidUUID(clientId)) return false
  const supabase = createAdminClient()
  const { data } = await supabase.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).maybeSingle()
  return !!data
}

export async function getClientLoyaltySummary(clientId: string): Promise<Read<LoyaltyClientSummary>> {
  const g = await requireView()
  if ('error' in g) return g
  if (!(await clienteEsDeLaOrg(clientId, g.orgId))) return { error: 'El cliente no existe en tu organización.' }
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('loyalty_client_summary', { p_client_id: clientId })
  if (error) return { error: 'No pudimos leer la ficha: ' + error.message }
  if (!data) return { error: 'El cliente no existe.' }
  return { data: data as LoyaltyClientSummary }
}

export async function adjustClientPoints(clientId: string, points: number, reason: string): Promise<Ok<{ balance: number }> | Err> {
  const g = await requireManage()
  if ('error' in g) return g
  const parsed = z.object({
    points: z.number().int().refine(n => n !== 0, 'El ajuste no puede ser 0').refine(n => Math.abs(n) <= 100000, 'Máximo 100.000 puntos'),
    reason: z.string().trim().min(3, 'Escribí un motivo (mínimo 3 letras)').max(200),
  }).safeParse({ points, reason }, { errorMap: errorMapEs })
  if (!parsed.success) return { error: primerError(parsed.error) }
  if (!(await clienteEsDeLaOrg(clientId, g.orgId))) return { error: 'El cliente no existe en tu organización.' }

  // Hasta ±100.000 pts por llamada: queda registrado quién lo hizo.
  const actor = await actorActual(g.orgId)
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('loyalty_adjust_points', {
    p_client_id: clientId, p_points: parsed.data.points, p_reason: parsed.data.reason, p_staff_id: actor.staffId,
  })
  if (error) return { error: 'No pudimos ajustar los puntos: ' + error.message }
  const res = data as { success: boolean; error?: string; balance?: number; available?: number }
  if (!res?.success) {
    if (res?.error === 'insufficient_points') return { error: `El cliente sólo tiene ${res.available ?? 0} puntos disponibles.` }
    if (res?.error === 'program_disabled') return { error: 'El programa no está configurado para esta organización.' }
    return { error: 'No pudimos ajustar los puntos (' + (res?.error ?? 'desconocido') + ').' }
  }
  revalidatePath(RUTA)
  return { success: true, balance: res.balance ?? 0 }
}

export async function cancelClientReward(clientRewardId: string, reason: string, refund: boolean): Promise<Ok<{ points_restored: number }> | Err> {
  const g = await requireManage()
  if ('error' in g) return g
  const parsed = z.object({
    id: uuid, reason: z.string().trim().min(3, 'Escribí un motivo').max(200), refund: z.boolean(),
  }).safeParse({ id: clientRewardId, reason, refund }, { errorMap: errorMapEs })
  if (!parsed.success) return { error: primerError(parsed.error) }

  const supabase = createAdminClient()
  const { data: cr } = await supabase.from('client_rewards').select('id').eq('id', clientRewardId).eq('organization_id', g.orgId).maybeSingle()
  if (!cr) return { error: 'El beneficio no existe en tu organización.' }

  const actor = await actorActual(g.orgId)
  const { data, error } = await supabase.rpc('loyalty_cancel_client_reward', {
    p_client_reward_id: clientRewardId, p_reason: parsed.data.reason, p_refund: parsed.data.refund,
    p_staff_id: actor.staffId, p_actor_user_id: actor.userId,
  })
  if (error) return { error: 'No pudimos cancelar el beneficio: ' + error.message }
  const res = data as { success: boolean; error?: string; points_restored?: number }
  if (!res?.success) {
    return { error: res?.error === 'not_available' ? 'El beneficio ya no está disponible (fue usado, venció o se canceló).' : 'No pudimos cancelar el beneficio.' }
  }
  revalidatePath(RUTA)
  return { success: true, points_restored: res.points_restored ?? 0 }
}

export async function reverseVisitPoints(visitId: string, reason: string): Promise<Ok<{ points_reverted: number; points_already_spent: number; referral_cancelled: boolean }> | Err> {
  const g = await requireManage()
  if ('error' in g) return g
  const parsed = z.object({ id: uuid, reason: z.string().trim().min(3, 'Escribí un motivo').max(200) }).safeParse({ id: visitId, reason }, { errorMap: errorMapEs })
  if (!parsed.success) return { error: primerError(parsed.error) }

  const supabase = createAdminClient()
  const { data: v } = await supabase.from('visits').select('id, client_id').eq('id', visitId).eq('organization_id', g.orgId).maybeSingle()
  if (!v) return { error: 'La visita no existe en tu organización.' }

  const actor = await actorActual(g.orgId)
  const { data, error } = await supabase.rpc('loyalty_reverse_visit', {
    p_visit_id: visitId, p_reason: parsed.data.reason, p_staff_id: actor.staffId, p_actor_user_id: actor.userId,
  })
  if (error) return { error: 'No pudimos revertir los puntos: ' + error.message }
  const res = (data ?? {}) as { points_reverted?: number; points_already_spent?: number; referral_cancelled?: boolean }
  // La visita ya no cuenta para los puntos, pero sí para la categoría: recalculamos por prolijidad.
  if (v.client_id) await supabase.rpc('loyalty_recalc_tier', { p_client_id: v.client_id })
  revalidatePath(RUTA)
  return {
    success: true,
    points_reverted: res.points_reverted ?? 0,
    points_already_spent: res.points_already_spent ?? 0,
    referral_cancelled: !!res.referral_cancelled,
  }
}

export async function redeemRewardForClient(clientId: string, rewardId: string): Promise<Ok<{ reward_name: string; points_remaining: number; expires_at: string | null }> | Err> {
  const g = await requireManage()
  if ('error' in g) return g
  if (!isValidUUID(clientId) || !isValidUUID(rewardId)) return { error: 'Datos inválidos' }
  if (!(await clienteEsDeLaOrg(clientId, g.orgId))) return { error: 'El cliente no existe en tu organización.' }
  const supabase = createAdminClient()
  const { data: rw } = await supabase.from('reward_catalog').select('id').eq('id', rewardId).eq('organization_id', g.orgId).maybeSingle()
  if (!rw) return { error: 'El premio no existe en tu organización.' }

  const { data, error } = await supabase.rpc('loyalty_redeem_reward_for_client', {
    p_client_id: clientId, p_reward_id: rewardId, p_channel: 'dashboard',
  })
  if (error) return { error: 'No pudimos canjear el premio: ' + error.message }
  const res = data as {
    success: boolean; error?: string; reward_name?: string; points_remaining?: number; expires_at?: string | null
    required?: number; available?: number; tier_required?: string
  }
  if (!res?.success) {
    const msgs: Record<string, string> = {
      program_disabled: 'El programa está apagado: prendelo desde Resumen para canjear.',
      not_available: 'El premio no está disponible (inactivo o sin costo en puntos).',
      expired: 'El premio está fuera de su vigencia.',
      tier_locked: `Este premio es sólo para ${res.tier_required ?? 'otra categoría'} en adelante.`,
      out_of_stock: 'El premio está agotado.',
      insufficient_points: `Al cliente le faltan puntos: tiene ${res.available ?? 0} y necesita ${res.required ?? 0}.`,
    }
    return { error: msgs[res?.error ?? ''] ?? 'No pudimos canjear el premio.' }
  }
  revalidatePath(RUTA)
  return { success: true, reward_name: res.reward_name ?? '', points_remaining: res.points_remaining ?? 0, expires_at: res.expires_at ?? null }
}

// ─── Mantenimiento ───────────────────────────────────────────────────────────

/** Corre el mismo SQL que el cron diario (vence lotes, avisa, recalcula gracias, vence beneficios). */
export async function runLoyaltyMaintenanceNow(): Promise<Ok<{ result: LoyaltyMaintenanceResult }> | Err> {
  const g = await requireManage()
  if ('error' in g) return g
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('loyalty_daily_maintenance')
  if (error) {
    console.error('[loyalty] loyalty_daily_maintenance:', error.message)
    return { error: 'El mantenimiento falló: ' + error.message }
  }
  revalidatePath(RUTA)
  return { success: true, result: data as LoyaltyMaintenanceResult }
}
