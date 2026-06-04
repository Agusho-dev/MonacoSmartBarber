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
