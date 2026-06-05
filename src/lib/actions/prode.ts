'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { buildAppUrl } from '@/lib/app-url'
import {
  enqueueProdeReminders,
  REMINDER_TEMPLATE_NAME,
  REMINDER_TEMPLATE_LANGUAGE,
} from '@/lib/prode/reminders'

const META_API_VERSION = 'v22.0'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OkOrErr = { orgId: string } | { error: string }

/** Guard común: resuelve la org de la sesión actual o devuelve {error}. */
async function requireOrgId(): Promise<OkOrErr> {
  const orgId = await getCurrentOrgId()
  if (!orgId) {
    console.error('[Prode] getCurrentOrgId returned null — sesión expirada')
    return { error: 'Sesión expirada. Recargá la página e intentá de nuevo.' }
  }
  return { orgId }
}

/**
 * Resuelve el torneo "activo" de la org: status active → upcoming → último por
 * starts_at. Devuelve el id o null. Single source of truth para todas las
 * actions que necesitan el tournament_id.
 */
async function resolveTournamentId(orgId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('prode_tournament')
    .select('id, status, starts_at')
    .eq('organization_id', orgId)
    .order('starts_at', { ascending: false })

  if (!data || data.length === 0) return null
  const active = data.find((t) => t.status === 'active')
  if (active) return active.id
  const upcoming = data.find((t) => t.status === 'upcoming')
  if (upcoming) return upcoming.id
  return data[0].id // último por starts_at
}

// ---------------------------------------------------------------------------
// B. Resultados / Quiniela
// ---------------------------------------------------------------------------

const setResultSchema = z.object({
  matchId: z.string().uuid(),
  home: z.number().int().min(0).max(30),
  away: z.number().int().min(0).max(30),
})

export async function setResult(input: { matchId: string; home: number; away: number }) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const parsed = setResultSchema.safeParse(input)
  if (!parsed.success) return { error: 'Datos inválidos (resultado 0–30)' }
  const { matchId, home, away } = parsed.data

  const supabase = createAdminClient()

  // Actualizar marcador + estado, scoped por org+id
  const { error: updErr } = await supabase
    .from('prode_matches')
    .update({ home_score: home, away_score: away, status: 'finished' })
    .eq('id', matchId)
    .eq('organization_id', orgId)

  if (updErr) return { error: 'Error al guardar el resultado: ' + updErr.message }

  // Puntuar predicciones vía RPC
  const { data: scoreData, error: scoreErr } = await supabase.rpc('prode_score_match', {
    p_match_id: matchId,
  })
  if (scoreErr) return { error: 'Resultado guardado, pero falló el puntaje: ' + scoreErr.message }

  const row = (scoreData ?? {}) as { ok?: boolean; scored?: number; outcome?: string }
  revalidatePath('/dashboard/prode')
  return { success: true, scored: row.scored ?? 0, outcome: row.outcome ?? null }
}

const setFeaturedSchema = z.object({
  matchId: z.string().uuid(),
  featured: z.boolean(),
})

export async function setFeatured(input: { matchId: string; featured: boolean }) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const parsed = setFeaturedSchema.safeParse(input)
  if (!parsed.success) return { error: 'Datos inválidos' }
  const { matchId, featured } = parsed.data

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('prode_matches')
    .update({ is_featured: featured })
    .eq('id', matchId)
    .eq('organization_id', orgId)

  if (error) return { error: 'Error al marcar el partido: ' + error.message }
  revalidatePath('/dashboard/prode')
  return { success: true }
}

const resolveQuestionSchema = z.object({
  questionId: z.string().uuid(),
  answer: z.string().min(1).max(500),
})

export async function resolveQuestion(input: { questionId: string; answer: string }) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const parsed = resolveQuestionSchema.safeParse(input)
  if (!parsed.success) return { error: 'Ingresá una respuesta válida' }
  const { questionId, answer } = parsed.data

  const supabase = createAdminClient()

  // Verificar ownership de la pregunta antes de resolver (la RPC no recibe org)
  const { data: q } = await supabase
    .from('prode_questions')
    .select('id')
    .eq('id', questionId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!q) return { error: 'Pregunta no encontrada' }

  const { data, error } = await supabase.rpc('prode_resolve_question', {
    p_question_id: questionId,
    p_correct: answer.trim(),
  })
  if (error) return { error: 'Error al resolver la pregunta: ' + error.message }

  const row = (data ?? {}) as { ok?: boolean; scored?: number }
  revalidatePath('/dashboard/prode')
  return { success: true, scored: row.scored ?? 0 }
}

// ---------------------------------------------------------------------------
// B. Participantes y Ligas (limpieza de data de prueba)
// ---------------------------------------------------------------------------

export async function deleteParticipant(id: string) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  if (!z.string().uuid().safeParse(id).success) return { error: 'ID inválido' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('prode_participants')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: 'Error al eliminar el participante: ' + error.message }
  revalidatePath('/dashboard/prode')
  return { success: true }
}

/**
 * Resetea el PIN de un participante (login del Prode). Pone pin_hash en NULL: el
 * jugador fija un PIN nuevo en su próximo ingreso (teléfono + PIN). Cero mensajes.
 */
export async function resetParticipantPin(id: string) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  if (!z.string().uuid().safeParse(id).success) return { error: 'ID inválido' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('prode_participants')
    .update({ pin_hash: null })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: 'Error al resetear el PIN: ' + error.message }
  revalidatePath('/dashboard/prode')
  return { success: true }
}

export async function deleteLeague(id: string) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  if (!z.string().uuid().safeParse(id).success) return { error: 'ID inválido' }

  const supabase = createAdminClient()

  // Las ligas de la casa (is_house) NO se pueden borrar.
  const { data: league } = await supabase
    .from('prode_leagues')
    .select('id, is_house')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!league) return { error: 'Liga no encontrada' }
  if (league.is_house) return { error: 'La liga de la casa no se puede eliminar' }

  const { error } = await supabase
    .from('prode_leagues')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: 'Error al eliminar la liga: ' + error.message }
  revalidatePath('/dashboard/prode')
  return { success: true }
}

// ---------------------------------------------------------------------------
// B. Premios
// ---------------------------------------------------------------------------

export interface WeeklyLeaderboardRow {
  rank: number
  participant_id: string
  display_name: string
  week_points: number
  exact_hits: number
}

export async function getWeeklyLeaderboard(input: { weekStart: string; weekEnd: string }) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const tournamentId = await resolveTournamentId(orgId)
  if (!tournamentId) return { error: 'No hay torneo configurado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('prode_weekly_leaderboard', {
    p_tournament_id: tournamentId,
    p_week_start: input.weekStart,
    p_week_end: input.weekEnd,
    p_limit: 10,
  })
  if (error) return { error: 'Error al cargar la tabla: ' + error.message }
  return { success: true, rows: (data ?? []) as WeeklyLeaderboardRow[] }
}

export async function awardWeek(input: { weekStart: string; weekEnd: string }) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const tournamentId = await resolveTournamentId(orgId)
  if (!tournamentId) return { error: 'No hay torneo configurado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('prode_award_weekly_prizes', {
    p_tournament_id: tournamentId,
    p_week_start: input.weekStart,
    p_week_end: input.weekEnd,
  })
  if (error) return { error: 'Error al premiar la semana: ' + error.message }

  const res = (data ?? {}) as {
    ok?: boolean
    winner?: { participant_id: string; display_name: string; client_id: string; points: number } | null
    already?: boolean
  }
  revalidatePath('/dashboard/prode')
  return {
    success: true,
    winner: res.winner ?? null,
    already: res.already ?? false,
  }
}

export async function awardGrandPrize() {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const tournamentId = await resolveTournamentId(orgId)
  if (!tournamentId) return { error: 'No hay torneo configurado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('prode_award_grand_prize', {
    p_tournament_id: tournamentId,
  })
  if (error) return { error: 'Error al premiar al campeón: ' + error.message }

  const res = (data ?? {}) as {
    ok?: boolean
    winner?: { participant_id: string; display_name: string } | null
    already?: boolean
  }
  revalidatePath('/dashboard/prode')
  return { success: true, winner: res.winner ?? null, already: res.already ?? false }
}

// ---------------------------------------------------------------------------
// C. Recordatorios WhatsApp
// ---------------------------------------------------------------------------

/**
 * Autora el template `prode_recordatorio` en la WABA de la org (Meta Cloud API).
 * Espeja seedDefaultTemplates(): mismos headers, mismo manejo de errores.
 *
 * IMPORTANTE: Meta debe APROBAR el template (~minutos) antes de que los envíos
 * funcionen. El `language` registrado debe coincidir EXACTAMENTE con
 * REMINDER_TEMPLATE_LANGUAGE ('es_AR') — si Meta lo normaliza distinto, el envío
 * falla con error 132001 (ver Known Risk #4).
 */
export async function createReminderTemplate(): Promise<{
  success?: boolean
  status?: string
  error?: string
}> {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const supabase = createAdminClient()

  const { data: waConfig } = await supabase
    .from('organization_whatsapp_config')
    .select('whatsapp_access_token, whatsapp_business_id')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!waConfig?.whatsapp_access_token || !waConfig?.whatsapp_business_id) {
    return { error: 'WhatsApp no está configurado para esta organización' }
  }

  // Canal org-default de WA (branch_id = NULL) para registrar el template local.
  const { data: channel } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform', 'whatsapp')
    .is('branch_id', null)
    .eq('is_active', true)
    .maybeSingle()

  // Botón URL hacia la pantalla de jugada del Prode.
  const playUrl = `${await buildAppUrl()}/mundial/jugar`

  const bodyText =
    '¡Hola {{1}}! 🎯 Hoy se juega en el Prode Mundial de Monaco. Dejá tu jugada para {{2}} antes del pitazo y sumá fichas para ganar cortes 💈'

  const payload = {
    name: REMINDER_TEMPLATE_NAME,
    language: REMINDER_TEMPLATE_LANGUAGE,
    category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text: bodyText,
        example: {
          // Meta requiere ejemplos para templates con variables.
          body_text: [['Juan', 'Argentina vs Brasil']],
        },
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Jugar ahora',
            url: playUrl,
          },
        ],
      },
    ],
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${waConfig.whatsapp_business_id}/message_templates`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waConfig.whatsapp_access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      }
    )

    const json = await res.json()

    if (!res.ok) {
      const metaErr = json?.error?.message ?? 'Error desconocido'
      if (typeof metaErr === 'string' && metaErr.toLowerCase().includes('already exists')) {
        // Ya existe en Meta: no es error real. Aseguramos el registro local.
        if (channel) {
          const { error: upErr } = await supabase.from('message_templates').upsert(
            {
              channel_id: channel.id,
              name: REMINDER_TEMPLATE_NAME,
              language: REMINDER_TEMPLATE_LANGUAGE,
              category: 'marketing',
              status: 'pending',
              components: payload.components,
            },
            { onConflict: 'channel_id, name' }
          )
          if (upErr) console.error('[Prode] upsert template (already exists)', upErr.message)
        }
        revalidatePath('/dashboard/prode')
        return { success: true, status: 'pending' }
      }
      return { error: 'Meta rechazó la plantilla: ' + metaErr }
    }

    const metaStatus = (json?.status as string | undefined) ?? 'pending'

    // Registro local (igual que seedDefaultTemplates)
    if (channel) {
      const { error: upErr } = await supabase.from('message_templates').upsert(
        {
          channel_id: channel.id,
          name: REMINDER_TEMPLATE_NAME,
          language: REMINDER_TEMPLATE_LANGUAGE,
          category: 'marketing',
          status: metaStatus.toLowerCase(),
          components: payload.components,
        },
        { onConflict: 'channel_id, name' }
      )
      if (upErr) console.error('[Prode] upsert template local', upErr.message)
    }

    revalidatePath('/dashboard/prode')
    return { success: true, status: metaStatus }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Error de red al crear la plantilla' }
  }
}

/** Botón "Enviar recordatorio ahora" del panel. */
export async function sendReminders(): Promise<{ success?: boolean; enqueued?: number; reason?: string; error?: string }> {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const res = await enqueueProdeReminders(orgId)
  revalidatePath('/dashboard/prode')
  return { success: true, enqueued: res.enqueued, reason: res.reason }
}

// ---------------------------------------------------------------------------
// D. Canje de premio por QR (staff)
// ---------------------------------------------------------------------------

/**
 * Canjea un premio del Prode a partir del QR del cliente.
 *
 * ⚠️ Usa el client SSR (createClient) — NO createAdminClient — porque la RPC
 * redeem_reward_by_qr es SECURITY DEFINER y lee auth.uid() para validar que el
 * que canjea es un staff de la org. Con service role auth.uid() es null y la RPC
 * devuelve { success:false, error:'Unauthorized' }.
 */
export async function redeemRewardByQr(
  code: string
): Promise<
  | { success: true; rewardName: string | null; isFreeService: boolean; discountPct: number | null }
  | { error: string }
> {
  // Validación básica: hex-ish, no vacío.
  const clean = (code ?? '').trim().toLowerCase()
  if (!clean) return { error: 'Ingresá un código' }
  if (!/^[0-9a-f-]{8,64}$/.test(clean)) return { error: 'El código no tiene un formato válido' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('redeem_reward_by_qr', { p_qr_code: clean })

  if (error) return { error: error.message }

  const row = (data ?? {}) as {
    success?: boolean
    error?: string
    reward_name?: string | null
    is_free_service?: boolean
    discount_pct?: number | null
  }

  if (row.success) {
    return {
      success: true,
      rewardName: row.reward_name ?? null,
      isFreeService: !!row.is_free_service,
      discountPct: row.discount_pct ?? null,
    }
  }

  // Mapear errores conocidos a texto en español.
  const raw = (row.error ?? '').toLowerCase()
  if (raw.includes('unauthorized')) return { error: 'No autorizado: iniciá sesión como staff' }
  if (raw.includes('expired') || raw.includes('vencid')) return { error: 'El premio está vencido' }
  if (raw.includes('not found') || raw.includes('redeemed') || raw.includes('canjead'))
    return { error: 'Premio no encontrado o ya canjeado' }
  return { error: row.error ?? 'No se pudo canjear el premio' }
}

// ---------------------------------------------------------------------------
// E. Configuración del torneo (reglas de puntaje, fechas, estado)
// ---------------------------------------------------------------------------

/** Convierte una hora local de ARG ("YYYY-MM-DDTHH:mm") a ISO UTC. ARG = UTC-3 fijo. */
function argLocalToIso(local: string | null | undefined): string | null {
  if (!local) return null
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  const d = new Date(`${local}:00-03:00`)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/** Lee el settings actual del torneo y devuelve el objeto + el tournamentId. */
async function loadTournamentSettings(
  orgId: string
): Promise<{ id: string; settings: Record<string, unknown> } | null> {
  const tournamentId = await resolveTournamentId(orgId)
  if (!tournamentId) return null
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('prode_tournament')
    .select('id, settings')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!data) return null
  return { id: data.id, settings: (data.settings as Record<string, unknown>) ?? {} }
}

const scoringSchema = z.object({
  outcomePoints: z.number().int().min(0).max(50),
  exactBonus: z.number().int().min(0).max(50),
  featuredMultiplier: z.number().min(1).max(10),
})

export async function updateScoringSettings(input: {
  outcomePoints: number
  exactBonus: number
  featuredMultiplier: number
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const parsed = scoringSchema.safeParse(input)
  if (!parsed.success) return { error: 'Valores inválidos. Revisá los puntos y el multiplicador.' }

  const t = await loadTournamentSettings(orgId)
  if (!t) return { error: 'No hay torneo configurado' }

  const next = {
    ...t.settings,
    match_outcome_points: parsed.data.outcomePoints,
    match_exact_bonus: parsed.data.exactBonus,
    featured_multiplier: parsed.data.featuredMultiplier,
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('prode_tournament')
    .update({ settings: next, updated_at: new Date().toISOString() })
    .eq('id', t.id)
    .eq('organization_id', orgId)
  if (error) return { error: 'No se pudieron guardar las reglas: ' + error.message }

  revalidatePath('/dashboard/prode')
  return { success: true }
}

const tournamentSchema = z.object({
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  predictionsLockAt: z.string().nullable().optional(),
  status: z.enum(['upcoming', 'active', 'finished']),
})

export async function updateTournament(input: {
  startsAt: string
  endsAt: string
  predictionsLockAt: string | null
  status: 'upcoming' | 'active' | 'finished'
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const parsed = tournamentSchema.safeParse(input)
  if (!parsed.success) return { error: 'Datos del torneo inválidos' }

  const startsAt = argLocalToIso(parsed.data.startsAt)
  const endsAt = argLocalToIso(parsed.data.endsAt)
  const lockAt =
    parsed.data.predictionsLockAt && parsed.data.predictionsLockAt.length > 0
      ? argLocalToIso(parsed.data.predictionsLockAt)
      : null
  if (!startsAt || !endsAt) return { error: 'Fechas inválidas' }
  if (new Date(endsAt) <= new Date(startsAt))
    return { error: 'La fecha de fin debe ser posterior al inicio' }

  const tournamentId = await resolveTournamentId(orgId)
  if (!tournamentId) return { error: 'No hay torneo configurado' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('prode_tournament')
    .update({
      starts_at: startsAt,
      ends_at: endsAt,
      predictions_lock_at: lockAt,
      status: parsed.data.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
  if (error) return { error: 'No se pudo guardar el torneo: ' + error.message }

  revalidatePath('/dashboard/prode')
  return { success: true }
}

// ---------------------------------------------------------------------------
// F. CRUD de preguntas de la quiniela
// ---------------------------------------------------------------------------

const QUESTION_KINDS = [
  'champion',
  'runner_up',
  'top_scorer',
  'surprise_team',
  'team_stage',
  'bonus',
] as const
const ANSWER_TYPES = ['team', 'choice', 'number', 'text'] as const

const questionInputSchema = z.object({
  label: z.string().min(2).max(300),
  helpText: z.string().max(500).nullable().optional(),
  kind: z.enum(QUESTION_KINDS),
  answerType: z.enum(ANSWER_TYPES),
  options: z.array(z.string().min(1).max(120)).max(30).optional(),
  points: z.number().int().min(1).max(200),
  sortOrder: z.number().int().min(0).max(999).optional(),
})

export async function createQuestion(input: {
  label: string
  helpText?: string | null
  kind: (typeof QUESTION_KINDS)[number]
  answerType: (typeof ANSWER_TYPES)[number]
  options?: string[]
  points: number
  sortOrder?: number
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const parsed = questionInputSchema.safeParse(input)
  if (!parsed.success) return { error: 'Datos de la pregunta inválidos' }
  const d = parsed.data
  if (d.answerType === 'choice' && (!d.options || d.options.length < 2))
    return { error: 'Una pregunta de opción múltiple necesita al menos 2 opciones' }

  const tournamentId = await resolveTournamentId(orgId)
  if (!tournamentId) return { error: 'No hay torneo configurado' }

  const supabase = createAdminClient()

  // sort_order: si no se pasa, va al final.
  let sortOrder = d.sortOrder
  if (sortOrder == null) {
    const { data: maxRow } = await supabase
      .from('prode_questions')
      .select('sort_order')
      .eq('tournament_id', tournamentId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    sortOrder = (maxRow?.sort_order ?? 0) + 1
  }

  const { error } = await supabase.from('prode_questions').insert({
    organization_id: orgId,
    tournament_id: tournamentId,
    kind: d.kind,
    label: d.label,
    help_text: d.helpText ?? null,
    answer_type: d.answerType,
    options: d.answerType === 'choice' ? d.options : null,
    points: d.points,
    sort_order: sortOrder,
  })
  if (error) return { error: 'No se pudo crear la pregunta: ' + error.message }

  revalidatePath('/dashboard/prode')
  return { success: true }
}

export async function updateQuestion(input: {
  id: string
  label: string
  helpText?: string | null
  kind: (typeof QUESTION_KINDS)[number]
  answerType: (typeof ANSWER_TYPES)[number]
  options?: string[]
  points: number
  sortOrder?: number
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  if (!z.string().uuid().safeParse(input.id).success) return { error: 'ID inválido' }
  const parsed = questionInputSchema.safeParse(input)
  if (!parsed.success) return { error: 'Datos de la pregunta inválidos' }
  const d = parsed.data
  if (d.answerType === 'choice' && (!d.options || d.options.length < 2))
    return { error: 'Una pregunta de opción múltiple necesita al menos 2 opciones' }

  const supabase = createAdminClient()
  const patch: Record<string, unknown> = {
    kind: d.kind,
    label: d.label,
    help_text: d.helpText ?? null,
    answer_type: d.answerType,
    options: d.answerType === 'choice' ? d.options : null,
    points: d.points,
  }
  if (d.sortOrder != null) patch.sort_order = d.sortOrder

  const { error } = await supabase
    .from('prode_questions')
    .update(patch)
    .eq('id', input.id)
    .eq('organization_id', orgId)
  if (error) return { error: 'No se pudo actualizar la pregunta: ' + error.message }

  revalidatePath('/dashboard/prode')
  return { success: true }
}

export async function deleteQuestion(id: string) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  if (!z.string().uuid().safeParse(id).success) return { error: 'ID inválido' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('prode_questions')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)
  if (error) return { error: 'No se pudo eliminar la pregunta: ' + error.message }

  revalidatePath('/dashboard/prode')
  return { success: true }
}

export async function reorderQuestions(orderedIds: string[]) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  if (!Array.isArray(orderedIds) || orderedIds.length === 0)
    return { error: 'Lista vacía' }
  if (!orderedIds.every((id) => z.string().uuid().safeParse(id).success))
    return { error: 'IDs inválidos' }

  const supabase = createAdminClient()
  // Actualiza sort_order = índice. Pocas preguntas → loop simple.
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('prode_questions')
      .update({ sort_order: i })
      .eq('id', orderedIds[i])
      .eq('organization_id', orgId)
    if (error) return { error: 'No se pudo reordenar: ' + error.message }
  }

  revalidatePath('/dashboard/prode')
  return { success: true }
}

// ---------------------------------------------------------------------------
// G. Override de equipos en partidos de knockout
// ---------------------------------------------------------------------------

const setTeamsSchema = z.object({
  matchId: z.string().uuid(),
  homeTeamId: z.string().uuid().nullable(),
  awayTeamId: z.string().uuid().nullable(),
})

export async function setMatchTeams(input: {
  matchId: string
  homeTeamId: string | null
  awayTeamId: string | null
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const parsed = setTeamsSchema.safeParse(input)
  if (!parsed.success) return { error: 'Datos inválidos' }
  const { matchId, homeTeamId, awayTeamId } = parsed.data

  const supabase = createAdminClient()

  // Resolver labels desde los equipos (para que la app pública muestre el nombre).
  const ids = [homeTeamId, awayTeamId].filter((x): x is string => !!x)
  const labelById = new Map<string, string>()
  if (ids.length > 0) {
    const { data: teams } = await supabase
      .from('prode_teams')
      .select('id, name')
      .in('id', ids)
      .eq('organization_id', orgId)
    for (const t of teams ?? []) labelById.set(t.id, t.name)
  }

  const { error } = await supabase
    .from('prode_matches')
    .update({
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      home_team_label: homeTeamId ? labelById.get(homeTeamId) ?? null : null,
      away_team_label: awayTeamId ? labelById.get(awayTeamId) ?? null : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', matchId)
    .eq('organization_id', orgId)
  if (error) return { error: 'No se pudieron asignar los equipos: ' + error.message }

  revalidatePath('/dashboard/prode')
  return { success: true }
}

// ---------------------------------------------------------------------------
// H. Premios: mapeo de recompensa por slot + edición de la recompensa
// ---------------------------------------------------------------------------

const PRIZE_SLOTS = {
  weekly: 'weekly_reward_id',
  grand: 'grand_reward_id',
  welcome: 'welcome_reward_id',
  grand2: 'grand_2nd_reward_id',
  grand3: 'grand_3rd_reward_id',
} as const

export async function setPrizeMapping(input: {
  slot: keyof typeof PRIZE_SLOTS
  rewardId: string
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  if (!(input.slot in PRIZE_SLOTS)) return { error: 'Slot inválido' }
  if (!z.string().uuid().safeParse(input.rewardId).success) return { error: 'Recompensa inválida' }

  // Verificar que la recompensa pertenece a la org.
  const supabase = createAdminClient()
  const { data: reward } = await supabase
    .from('reward_catalog')
    .select('id')
    .eq('id', input.rewardId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!reward) return { error: 'Recompensa no encontrada' }

  const t = await loadTournamentSettings(orgId)
  if (!t) return { error: 'No hay torneo configurado' }

  const next = { ...t.settings, [PRIZE_SLOTS[input.slot]]: input.rewardId }
  const { error } = await supabase
    .from('prode_tournament')
    .update({ settings: next, updated_at: new Date().toISOString() })
    .eq('id', t.id)
    .eq('organization_id', orgId)
  if (error) return { error: 'No se pudo guardar el premio: ' + error.message }

  revalidatePath('/dashboard/prode')
  return { success: true }
}

const updateRewardSchema = z.object({
  rewardId: z.string().uuid(),
  description: z.string().max(500).nullable().optional(),
  discountPct: z.number().int().min(0).max(100).nullable().optional(),
  isFreeService: z.boolean().optional(),
  isActive: z.boolean().optional(),
  validUntil: z.string().nullable().optional(),
})

export async function updateReward(input: {
  rewardId: string
  description?: string | null
  discountPct?: number | null
  isFreeService?: boolean
  isActive?: boolean
  validUntil?: string | null
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const parsed = updateRewardSchema.safeParse(input)
  if (!parsed.success) return { error: 'Datos de la recompensa inválidos' }
  const d = parsed.data

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (d.description !== undefined) patch.description = d.description
  if (d.discountPct !== undefined) patch.discount_pct = d.discountPct
  if (d.isFreeService !== undefined) patch.is_free_service = d.isFreeService
  if (d.isActive !== undefined) patch.is_active = d.isActive
  if (d.validUntil !== undefined)
    patch.valid_until = d.validUntil ? new Date(d.validUntil).toISOString() : null

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('reward_catalog')
    .update(patch)
    .eq('id', d.rewardId)
    .eq('organization_id', orgId)
  if (error) return { error: 'No se pudo actualizar la recompensa: ' + error.message }

  revalidatePath('/dashboard/prode')
  return { success: true }
}

// ---------------------------------------------------------------------------
// H.2 Premios por Desafío (D1/D2/D3, 16vos, 8vos): mapeo + tabla + premiación
// ---------------------------------------------------------------------------

export interface ChallengeLeaderboardRow {
  rank: number
  participant_id: string
  display_name: string
  challenge_points: number
  exact_hits: number
}

/** Tabla del Desafío (suma de puntos de los partidos de ese stage/matchday). */
export async function getChallengeLeaderboard(input: { stage: string; matchday: number | null }) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }

  const tournamentId = await resolveTournamentId(result.orgId)
  if (!tournamentId) return { error: 'No hay torneo configurado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('prode_challenge_leaderboard', {
    p_tournament_id: tournamentId,
    p_stage: input.stage,
    p_matchday: input.matchday,
    p_limit: 10,
  })
  if (error) return { error: 'Error al cargar la tabla: ' + error.message }
  return { success: true, rows: (data ?? []) as ChallengeLeaderboardRow[] }
}

/** Mapea qué recompensa entrega un Desafío (settings.challenge_rewards[key]). */
export async function setChallengeReward(input: { key: string; rewardId: string }) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  if (!input.key) return { error: 'Desafío inválido' }
  if (!z.string().uuid().safeParse(input.rewardId).success) return { error: 'Recompensa inválida' }

  const supabase = createAdminClient()
  const { data: reward } = await supabase
    .from('reward_catalog')
    .select('id')
    .eq('id', input.rewardId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!reward) return { error: 'Recompensa no encontrada' }

  const t = await loadTournamentSettings(orgId)
  if (!t) return { error: 'No hay torneo configurado' }

  const current = (t.settings.challenge_rewards as Record<string, string> | undefined) ?? {}
  const next = { ...t.settings, challenge_rewards: { ...current, [input.key]: input.rewardId } }

  const { error } = await supabase
    .from('prode_tournament')
    .update({ settings: next, updated_at: new Date().toISOString() })
    .eq('id', t.id)
    .eq('organization_id', orgId)
  if (error) return { error: 'No se pudo guardar el premio del desafío: ' + error.message }

  revalidatePath('/dashboard/prode')
  return { success: true }
}

/** Premia al 1° de un Desafío (manual). Idempotente: una vez por challenge_key. */
export async function awardChallengePrize(input: {
  key: string
  stage: string
  matchday: number | null
  rewardId: string
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }

  const tournamentId = await resolveTournamentId(result.orgId)
  if (!tournamentId) return { error: 'No hay torneo configurado' }
  if (!z.string().uuid().safeParse(input.rewardId).success)
    return { error: 'Elegí qué recompensa entregar para este desafío' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('prode_award_challenge_prize', {
    p_tournament_id: tournamentId,
    p_challenge_key: input.key,
    p_stage: input.stage,
    p_matchday: input.matchday,
    p_reward_id: input.rewardId,
  })
  if (error) return { error: 'Error al premiar el desafío: ' + error.message }

  const res = (data ?? {}) as {
    ok?: boolean
    winner?: { participant_id: string; display_name: string; points: number } | null
    already?: boolean
    error?: string
    reason?: string
  }
  if (res.ok === false) return { error: res.error ?? 'No se pudo premiar el desafío' }

  revalidatePath('/dashboard/prode')
  return {
    success: true,
    winner: res.winner ?? null,
    already: res.already ?? false,
    reason: res.reason ?? null,
  }
}

// ---------------------------------------------------------------------------
// I. Disparar la sincronización manual (football-data.org)
// ---------------------------------------------------------------------------

/**
 * Invoca la edge function `prode-sync` para refrescar fixtures/resultados/llaves
 * a demanda. La función valida `x-cron-secret` SOLO si tiene CRON_SECRET seteado;
 * el dashboard debe exponer ese mismo secreto en `PRODE_SYNC_SECRET`/`CRON_SECRET`.
 */
export async function triggerProdeSync(): Promise<{
  success?: boolean
  teams?: number
  matches?: number
  scored?: number
  error?: string
}> {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!baseUrl) return { error: 'Falta NEXT_PUBLIC_SUPABASE_URL' }
  const secret = process.env.PRODE_SYNC_SECRET || process.env.CRON_SECRET || ''
  if (!secret)
    return {
      error:
        'Falta configurar PRODE_SYNC_SECRET en el dashboard para sincronizar manualmente. El sync automático sigue corriendo por su cuenta.',
    }

  try {
    const res = await fetch(`${baseUrl}/functions/v1/prode-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': secret,
        ...(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
          ? { Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` }
          : {}),
      },
      body: '{}',
      signal: AbortSignal.timeout(25000),
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      error?: string
      teamsUpserted?: number
      matchesUpserted?: number
      scored?: number
    }
    if (!res.ok || json.ok === false) {
      if (res.status === 404)
        return {
          error:
            'La función de sincronización (prode-sync) no está deployada en Supabase. Hay que deployarla una vez para habilitar el botón.',
        }
      if (res.status === 403)
        return {
          error:
            'El sync rechazó la llamada (403): el PRODE_SYNC_SECRET del dashboard no coincide con el CRON_SECRET de la función.',
        }
      if (json.error?.includes('FOOTBALL_DATA_API_KEY'))
        return {
          error: 'Falta el secret FOOTBALL_DATA_API_KEY en Supabase para que el sync traiga los datos.',
        }
      return { error: json.error ? `Sync falló: ${json.error}` : `Sync falló (${res.status})` }
    }

    revalidatePath('/dashboard/prode')
    return {
      success: true,
      teams: json.teamsUpserted ?? 0,
      matches: json.matchesUpserted ?? 0,
      scored: json.scored ?? 0,
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Error de red al sincronizar' }
  }
}
