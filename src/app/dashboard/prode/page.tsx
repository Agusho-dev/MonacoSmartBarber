import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { ProdeClient } from './prode-client'

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
    return (
      <ProdeClient
        tournament={null}
        matches={[]}
        questions={[]}
        teams={[]}
        participants={[]}
        leagues={[]}
        weeklyPrizes={[]}
        whatsappActive={false}
        reminderTemplateStatus={null}
      />
    )
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
    waConfigRes,
  ] = await Promise.all([
    supabase
      .from('prode_matches')
      .select(
        'id, kickoff_at, status, home_score, away_score, is_featured, stage, group_label, home_team_label, away_team_label, home_team_id, away_team_id'
      )
      .eq('organization_id', orgId)
      .eq('tournament_id', tournamentId)
      .order('kickoff_at', { ascending: true }),
    supabase
      .from('prode_questions')
      .select('id, label, answer_type, options, points, correct_answer, resolved_at, sort_order')
      .eq('organization_id', orgId)
      .eq('tournament_id', tournamentId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('prode_teams')
      .select('id, name, code')
      .eq('organization_id', orgId)
      .eq('tournament_id', tournamentId)
      .order('name', { ascending: true }),
    supabase
      .from('prode_participants')
      .select('id, display_name, profile_completed_at, created_at, clients(name, phone)')
      .eq('organization_id', orgId)
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: false }),
    supabase
      .from('prode_leagues')
      .select('id, name, invite_code, is_house, is_public')
      .eq('organization_id', orgId)
      .eq('tournament_id', tournamentId)
      .order('is_house', { ascending: false }),
    supabase
      .from('prode_league_members')
      .select('league_id')
      .eq('organization_id', orgId),
    supabase
      .from('prode_weekly_prizes')
      .select('id, week_start, week_end, winner_participant_id, winner_points, client_reward_id, awarded_at, notified_at')
      .eq('organization_id', orgId)
      .eq('tournament_id', tournamentId)
      .order('week_start', { ascending: true }),
    supabase
      .from('organization_whatsapp_config')
      .select('is_active')
      .eq('organization_id', orgId)
      .maybeSingle(),
  ])

  // Conteo de miembros por liga
  const memberCounts = new Map<string, number>()
  for (const m of leagueMembersRes.data ?? []) {
    memberCounts.set(m.league_id, (memberCounts.get(m.league_id) ?? 0) + 1)
  }
  const leagues = (leaguesRes.data ?? []).map((l) => ({
    ...l,
    member_count: memberCounts.get(l.id) ?? 0,
  }))

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

  // Normalizar participantes (clients puede venir como array por el join)
  const participants = (participantsRes.data ?? []).map((p) => {
    const rel = p.clients as { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null
    const client = Array.isArray(rel) ? rel[0] : rel
    return {
      id: p.id,
      display_name: p.display_name,
      phone: client?.phone ?? null,
      client_name: client?.name ?? null,
      profile_completed: !!p.profile_completed_at,
      created_at: p.created_at as string,
    }
  })

  return (
    <ProdeClient
      tournament={{
        id: tournament.id,
        name: tournament.name,
        season: tournament.season,
        status: tournament.status,
        starts_at: tournament.starts_at,
        ends_at: tournament.ends_at,
      }}
      matches={(matchesRes.data ?? []) as ProdeMatch[]}
      questions={(questionsRes.data ?? []) as ProdeQuestion[]}
      teams={(teamsRes.data ?? []) as ProdeTeam[]}
      participants={participants}
      leagues={leagues}
      weeklyPrizes={(prizesRes.data ?? []) as ProdeWeeklyPrize[]}
      whatsappActive={!!waConfigRes.data?.is_active}
      reminderTemplateStatus={reminderTemplateStatus}
    />
  )
}

// Tipos compartidos con el client (re-exportados desde el client)
export interface ProdeMatch {
  id: string
  kickoff_at: string
  status: string
  home_score: number | null
  away_score: number | null
  is_featured: boolean
  stage: string | null
  group_label: string | null
  home_team_label: string | null
  away_team_label: string | null
  home_team_id: string | null
  away_team_id: string | null
}

export interface ProdeQuestion {
  id: string
  label: string
  answer_type: string
  options: unknown
  points: number
  correct_answer: string | null
  resolved_at: string | null
  sort_order: number
}

export interface ProdeTeam {
  id: string
  name: string
  code: string | null
}

export interface ProdeWeeklyPrize {
  id: string
  week_start: string
  week_end: string
  winner_participant_id: string | null
  winner_points: number | null
  client_reward_id: string | null
  awarded_at: string
  notified_at: string | null
}
