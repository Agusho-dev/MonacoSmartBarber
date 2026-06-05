import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { ProdeClient } from './prode-client'
import type {
  LeagueRow,
  ParticipantRow,
  ProdeChallengePrize,
  ProdeMatch,
  ProdeQuestion,
  ProdeStats,
  ProdeTeam,
  ProdeWeeklyPrize,
  QuestionDistribution,
  RewardLite,
} from './_lib/types'

const REMINDER_TEMPLATE_NAME = 'prode_recordatorio'

/**
 * Resuelve el torneo "activo" de la org: status active → upcoming → último por
 * starts_at. Espeja resolveTournamentId() de actions/prode.ts.
 */
async function resolveTournament(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string
) {
  const { data } = await supabase
    .from('prode_tournament')
    .select('*')
    .eq('organization_id', orgId)
    .order('starts_at', { ascending: false })

  if (!data || data.length === 0) return null
  return (
    data.find((t) => t.status === 'active') ??
    data.find((t) => t.status === 'upcoming') ??
    data[0]
  )
}

export default async function ProdePage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()

  const tournament = await resolveTournament(supabase, orgId)

  if (!tournament) {
    return <ProdeClient data={null} />
  }

  const tournamentId = tournament.id

  const [
    matchesRes,
    questionsRes,
    teamsRes,
    participantsRes,
    leaguesRes,
    leagueMembersRes,
    prizesRes,
    challengePrizesRes,
    rewardsRes,
    matchPredsRes,
    questionPredsRes,
    matchPredCount,
    questionPredCount,
    waConfigRes,
  ] = await Promise.all([
    supabase
      .from('prode_matches')
      .select(
        'id, kickoff_at, status, home_score, away_score, is_featured, stage, group_label, matchday, home_team_label, away_team_label, home_team_id, away_team_id, venue, updated_at'
      )
      .eq('organization_id', orgId)
      .eq('tournament_id', tournamentId)
      .order('kickoff_at', { ascending: true }),
    supabase
      .from('prode_questions')
      .select(
        'id, kind, label, help_text, answer_type, options, points, correct_answer, resolved_at, sort_order'
      )
      .eq('organization_id', orgId)
      .eq('tournament_id', tournamentId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('prode_teams')
      .select('id, name, short_name, code, group_label, flag_url')
      .eq('organization_id', orgId)
      .eq('tournament_id', tournamentId)
      .order('name', { ascending: true }),
    supabase
      .from('prode_participants')
      .select('id, display_name, profile_completed_at, created_at, pin_hash, clients(name, phone)')
      .eq('organization_id', orgId)
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: false }),
    supabase
      .from('prode_leagues')
      .select('id, name, invite_code, is_house, is_public')
      .eq('organization_id', orgId)
      .eq('tournament_id', tournamentId)
      .order('is_house', { ascending: false }),
    supabase.from('prode_league_members').select('league_id').eq('organization_id', orgId),
    supabase
      .from('prode_weekly_prizes')
      .select(
        'id, week_start, week_end, winner_participant_id, winner_points, client_reward_id, awarded_at, notified_at'
      )
      .eq('organization_id', orgId)
      .eq('tournament_id', tournamentId)
      .order('week_start', { ascending: true }),
    supabase
      .from('prode_challenge_prizes')
      .select(
        'id, challenge_key, stage, matchday, winner_participant_id, winner_points, reward_id, client_reward_id, awarded_at'
      )
      .eq('organization_id', orgId)
      .eq('tournament_id', tournamentId),
    supabase
      .from('reward_catalog')
      .select('id, name, description, type, discount_pct, is_free_service, is_active, valid_until')
      .eq('organization_id', orgId)
      .order('name', { ascending: true }),
    // Para # jugadas por participante (capado; pre-lanzamiento es chico).
    supabase
      .from('prode_match_predictions')
      .select('participant_id')
      .eq('organization_id', orgId)
      .limit(50000),
    // Para distribución de respuestas + jugadas de quiniela por participante.
    supabase
      .from('prode_question_predictions')
      .select('participant_id, question_id, answer')
      .eq('organization_id', orgId)
      .limit(50000),
    supabase
      .from('prode_match_predictions')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId),
    supabase
      .from('prode_question_predictions')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId),
    supabase
      .from('organization_whatsapp_config')
      .select('is_active')
      .eq('organization_id', orgId)
      .maybeSingle(),
  ])

  const matches = (matchesRes.data ?? []) as ProdeMatch[]

  // Conteo de miembros por liga
  const memberCounts = new Map<string, number>()
  for (const m of leagueMembersRes.data ?? []) {
    memberCounts.set(m.league_id, (memberCounts.get(m.league_id) ?? 0) + 1)
  }
  const leagues: LeagueRow[] = (leaguesRes.data ?? []).map((l) => ({
    ...l,
    member_count: memberCounts.get(l.id) ?? 0,
  }))

  // Jugadas por participante (partidos + quiniela)
  const playsByParticipant = new Map<string, number>()
  for (const r of matchPredsRes.data ?? [])
    playsByParticipant.set(r.participant_id, (playsByParticipant.get(r.participant_id) ?? 0) + 1)
  for (const r of questionPredsRes.data ?? [])
    playsByParticipant.set(r.participant_id, (playsByParticipant.get(r.participant_id) ?? 0) + 1)

  // Normalizar participantes (clients puede venir como array por el join)
  const participants: ParticipantRow[] = (participantsRes.data ?? []).map((p) => {
    const rel = p.clients as
      | { name: string | null; phone: string | null }
      | { name: string | null; phone: string | null }[]
      | null
    const client = Array.isArray(rel) ? rel[0] : rel
    return {
      id: p.id,
      display_name: p.display_name,
      phone: client?.phone ?? null,
      client_name: client?.name ?? null,
      profile_completed: !!p.profile_completed_at,
      created_at: p.created_at as string,
      plays: playsByParticipant.get(p.id) ?? 0,
      has_pin: !!(p as { pin_hash?: string | null }).pin_hash,
    }
  })

  // Distribución de respuestas de la quiniela: questionId -> answer -> count
  const distribution: QuestionDistribution = {}
  for (const r of questionPredsRes.data ?? []) {
    const q = (distribution[r.question_id] ??= {})
    q[r.answer] = (q[r.answer] ?? 0) + 1
  }

  // Última sincronización: el updated_at más reciente entre los partidos.
  let lastSyncAt: string | null = null
  for (const m of matches) {
    if (m.updated_at && (!lastSyncAt || m.updated_at > lastSyncAt)) lastSyncAt = m.updated_at
  }

  const stats: ProdeStats = {
    participants: participants.length,
    plays: (matchPredCount.count ?? 0) + (questionPredCount.count ?? 0),
    matchesPlayed: matches.filter((m) => m.status === 'finished').length,
    matchesTotal: matches.length,
  }

  // Estado del template de recordatorio (vía canal WA org-default)
  let reminderTemplateStatus: string | null = null
  const { data: channel } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform', 'whatsapp')
    .is('branch_id', null)
    .eq('is_active', true)
    .maybeSingle()
  if (channel) {
    const { data: tpl } = await supabase
      .from('message_templates')
      .select('status')
      .eq('channel_id', channel.id)
      .eq('name', REMINDER_TEMPLATE_NAME)
      .maybeSingle()
    reminderTemplateStatus = tpl?.status ?? null
  }

  return (
    <ProdeClient
      data={{
        tournament: {
          id: tournament.id,
          name: tournament.name,
          season: tournament.season,
          status: tournament.status,
          starts_at: tournament.starts_at,
          ends_at: tournament.ends_at,
          predictions_lock_at: tournament.predictions_lock_at ?? null,
          settings: (tournament.settings as Record<string, unknown>) ?? {},
        },
        matches,
        questions: (questionsRes.data ?? []) as ProdeQuestion[],
        teams: (teamsRes.data ?? []) as ProdeTeam[],
        participants,
        leagues,
        weeklyPrizes: (prizesRes.data ?? []) as ProdeWeeklyPrize[],
        challengePrizes: (challengePrizesRes.data ?? []) as ProdeChallengePrize[],
        rewards: (rewardsRes.data ?? []) as RewardLite[],
        stats,
        distribution,
        lastSyncAt,
        whatsappActive: !!waConfigRes.data?.is_active,
        reminderTemplateStatus,
      }}
    />
  )
}
