// Tipos compartidos del panel Prode Mundial. Single source of truth para el
// server component (page.tsx) y todos los componentes de _components/.

export interface TournamentLite {
  id: string
  name: string
  season: string
  status: string // upcoming | active | finished
  starts_at: string
  ends_at: string
  predictions_lock_at: string | null
  settings: ProdeSettings
}

export interface ProdeSettings {
  match_outcome_points?: number
  match_exact_bonus?: number
  featured_multiplier?: number
  weekly_reward_id?: string
  grand_reward_id?: string
  welcome_reward_id?: string
  grand_prize_awarded_at?: string
  [k: string]: unknown
}

export interface ProdeMatch {
  id: string
  kickoff_at: string
  status: string // scheduled | live | finished | cancelled
  home_score: number | null
  away_score: number | null
  is_featured: boolean
  stage: string | null // group | round_of_32 | round_of_16 | quarter_final | semi_final | third_place | final
  group_label: string | null
  matchday: number | null
  home_team_label: string | null
  away_team_label: string | null
  home_team_id: string | null
  away_team_id: string | null
  venue: string | null
  updated_at: string | null
}

export interface ProdeTeam {
  id: string
  name: string
  short_name: string | null
  code: string | null
  group_label: string | null
  flag_url: string | null
}

export interface ProdeQuestion {
  id: string
  kind: string // champion | runner_up | top_scorer | surprise_team | team_stage | bonus
  label: string
  help_text: string | null
  answer_type: string // team | choice | number | text
  options: unknown // jsonb: string[] o {value,label}[]
  points: number
  correct_answer: string | null
  resolved_at: string | null
  sort_order: number
}

export interface ParticipantRow {
  id: string
  display_name: string
  phone: string | null
  client_name: string | null
  profile_completed: boolean
  created_at: string
  plays: number
  has_pin: boolean
}

export interface LeagueRow {
  id: string
  name: string
  invite_code: string
  is_house: boolean
  is_public: boolean
  member_count: number
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

export interface RewardLite {
  id: string
  name: string
  description: string | null
  type: string
  discount_pct: number | null
  is_free_service: boolean
  is_active: boolean
  valid_until: string | null
}

export interface ProdeStats {
  participants: number
  plays: number // match + question predictions
  matchesPlayed: number
  matchesTotal: number
}

// Distribución de respuestas por pregunta: answer -> count.
export type QuestionDistribution = Record<string, Record<string, number>>

export interface ProdePageData {
  tournament: TournamentLite
  matches: ProdeMatch[]
  questions: ProdeQuestion[]
  teams: ProdeTeam[]
  participants: ParticipantRow[]
  leagues: LeagueRow[]
  weeklyPrizes: ProdeWeeklyPrize[]
  rewards: RewardLite[]
  stats: ProdeStats
  distribution: QuestionDistribution
  lastSyncAt: string | null
  whatsappActive: boolean
  reminderTemplateStatus: string | null
}
