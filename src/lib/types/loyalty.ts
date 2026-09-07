// =============================================================================
// src/lib/types/loyalty.ts
// Tipos del programa de fidelización (migraciones 196/197). Son el espejo de
// las tablas loyalty_* y del JSON que devuelven las RPC del dashboard
// (`loyalty_dashboard_overview`, `loyalty_client_summary`, etc.).
//
// Vive aparte de database.ts a propósito: ese archivo lo toca otro agente en
// paralelo y acá no hay nada que dependa de sus interfaces.
// =============================================================================

export type LoyaltyTierCode = 'bronce' | 'plata' | 'oro' | 'platinum'

export const LOYALTY_TIER_CODES: LoyaltyTierCode[] = ['bronce', 'plata', 'oro', 'platinum']

export interface LoyaltySettings {
  organization_id: string
  is_enabled: boolean
  program_started_at: string | null
  window_weeks: number
  grace_days: number
  base_points: number
  points_expiry_days: number
  welcome_bonus_points: number
  reward_validity_days: number
  expiring_soon_days: number
  referral_enabled: boolean
  referral_new_client_discount_pct: number
  referral_new_client_points: number
  referral_referrer_points: number
  referral_valid_from: string | null
  referral_valid_until: string | null
  referral_max_per_referrer: number | null
  updated_at: string
}

/** Campos editables de loyalty_settings. `undefined` = no tocar. */
export type LoyaltySettingsInput = Partial<Omit<LoyaltySettings, 'organization_id' | 'is_enabled' | 'program_started_at' | 'updated_at'>>

export interface LoyaltyTier {
  id: string
  organization_id: string
  code: LoyaltyTierCode
  name: string
  sort_order: number
  min_visits: number
  /** null = sin tope (la categoría más alta). */
  max_visits: number | null
  multiplier_pct: number
  color_primary: string
  color_secondary: string
  text_color: string
  benefits: string[]
  is_active: boolean
  updated_at: string
}

/** Lo que reescribe `saveLoyaltyTiers` (una entrada por código). */
export interface LoyaltyTierInput {
  code: LoyaltyTierCode
  name: string
  min_visits: number
  max_visits: number | null
  multiplier_pct: number
  color_primary: string
  color_secondary: string
  text_color: string
  benefits: string[]
}

/** Lo mínimo que necesita la tarjeta para dibujarse. */
export type LoyaltyTierLook = Pick<LoyaltyTier, 'code' | 'name' | 'color_primary' | 'color_secondary' | 'text_color'>

export type LoyaltyRewardKind = 'descuento' | 'merch' | 'especial'
export type LoyaltyRewardCategory = 'cortes' | 'merch'

export interface LoyaltyReward {
  id: string
  organization_id: string
  name: string
  description: string | null
  type: string
  kind: LoyaltyRewardKind
  points_cost: number
  discount_pct: number | null
  is_free_service: boolean
  service_id: string | null
  /** null = ilimitado. */
  stock: number | null
  validity_days: number | null
  /** null = todas las categorías. */
  allowed_tiers: LoyaltyTierCode[] | null
  allow_stacking: boolean
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
  is_featured: boolean
  category: LoyaltyRewardCategory | null
  image_url: string | null
  sort_order: number
  created_at: string
  updated_at: string
  /** Embed: nombre del servicio al que aplica. */
  service?: { name: string } | null
  /** Cuántos canjes tiene (para decidir si se puede borrar). */
  redemptions_count?: number
}

export interface LoyaltyRewardInput {
  id?: string
  name: string
  description: string | null
  kind: LoyaltyRewardKind
  points_cost: number
  discount_pct: number | null
  service_id: string | null
  stock: number | null
  validity_days: number | null
  allowed_tiers: LoyaltyTierCode[] | null
  allow_stacking: boolean
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
  is_featured: boolean
  category: LoyaltyRewardCategory | null
  image_url: string | null
  sort_order: number
}

export type LoyaltyNotificationKind =
  | 'tier_up' | 'tier_grace_warning' | 'tier_grace_reminder' | 'tier_down' | 'near_tier'
  | 'points_earned' | 'points_expiring' | 'reward_unlocked' | 'near_reward' | 'benefit_new'
  | 'referral_completed_referrer' | 'referral_completed_referred'

export interface LoyaltyNotificationRule {
  id: string
  organization_id: string
  kind: LoyaltyNotificationKind
  is_enabled: boolean
  title: string
  body: string
  days_before: number | null
  deep_link: string | null
  sort_order: number
  updated_at: string
}

export interface LoyaltyNotificationRuleInput {
  is_enabled?: boolean
  title?: string
  body?: string
  days_before?: number | null
}

export type ReferralStatus = 'pending' | 'completed' | 'rejected' | 'cancelled'

export interface Referral {
  id: string
  organization_id: string
  referrer_client_id: string
  referred_client_id: string
  visit_id: string | null
  branch_id: string | null
  service_id: string | null
  status: ReferralStatus
  discount_pct: number
  discount_amount: number
  referred_points: number
  referrer_points: number
  rejection_reason: string | null
  created_at: string
  completed_at: string | null
  referrer?: { name: string } | null
  referred?: { name: string } | null
  branch?: { name: string } | null
  service?: { name: string } | null
}

export interface LoyaltyService {
  id: string
  name: string
  price: number
  branch_id: string | null
  branch_name: string | null
  counts_as_visit: boolean
  is_active: boolean
}

// ── RPC loyalty_dashboard_overview ───────────────────────────────────────────

export interface LoyaltyOverviewTier {
  code: LoyaltyTierCode
  name: string
  sort: number
  color_primary: string
  color_secondary: string
  text_color: string
  count: number
  in_grace: number
}

export interface LoyaltyDistribution {
  bronce: number
  plata: number
  oro: number
  platinum: number
  total: number
  with_visits_in_window: number
}

export interface LoyaltyEvent {
  id: string
  kind: string
  client_id: string | null
  client_name?: string | null
  visit_id?: string | null
  data: Record<string, unknown>
  created_at: string
}

export interface LoyaltyOverview {
  /** null si la org todavía no tiene fila en loyalty_settings. */
  settings: LoyaltySettings | null
  tiers: LoyaltyOverviewTier[]
  points: {
    issued_30d: number
    redeemed_30d: number
    expired_30d: number
    live_balance: number
    expiring_30d: number
    clients_with_points: number
  }
  rewards: { available: number; used_30d: number; expired_30d: number }
  referrals: { completed_30d: number; completed_total: number; pending: number }
  events: LoyaltyEvent[]
  in_grace: number
  distribution_preview: LoyaltyDistribution | null
  errors_7d: number
}

// ── RPC loyalty_client_summary ───────────────────────────────────────────────

export type LoyaltyPointTxType =
  | 'earned' | 'welcome_bonus' | 'referral_referrer' | 'referral_referred' | 'manual_adjust'
  | 'redeemed' | 'expired' | 'reversal'

export interface LoyaltyPointLot {
  id: string
  points: number
  remaining: number
  type: LoyaltyPointTxType
  description: string | null
  created_at: string
  expires_at: string | null
  visit_id: string | null
  meta: Record<string, unknown>
  reversed: boolean
}

export type ClientRewardStatusLoyalty = 'available' | 'redeemed' | 'expired' | 'cancelled'

export interface LoyaltyClientReward {
  id: string
  name: string
  kind: LoyaltyRewardKind
  status: ClientRewardStatusLoyalty
  points_spent: number
  created_at: string
  expires_at: string | null
  redeemed_at: string | null
  qr_code: string
  source: string
  cancel_reason: string | null
}

export interface LoyaltyClientReferral {
  id: string
  status: ReferralStatus
  created_at: string
  completed_at: string | null
  i_am_referrer: boolean
  other_name: string | null
  referrer_points: number
  referred_points: number
  discount_amount: number
  visit_id: string | null
}

export interface LoyaltyClientVisit {
  id: string
  completed_at: string
  amount: number
  discount_amount: number | null
  service_name: string | null
  branch_name: string | null
  /** Puntos del lote vivo de esa visita; null si no generó (o se revirtió). */
  lot_points: number | null
}

export interface LoyaltyClientSummary {
  client: {
    id: string
    name: string
    phone: string
    created_at: string
    referral_code: string | null
    has_app: boolean
  }
  state: {
    tier_code: LoyaltyTierCode | null
    tier_name: string | null
    color_primary: string | null
    color_secondary: string | null
    text_color: string | null
    visits_in_window: number
    total_visits: number | null
    tier_reached_at: string | null
    grace_until: string | null
    enrolled_at: string | null
    last_visit_at: string | null
    next_tier_name: string | null
    visits_to_next: number | null
    welcome_bonus: boolean
  } | null
  visits_in_window_live: number | null
  balance: number
  lots: LoyaltyPointLot[]
  rewards: LoyaltyClientReward[]
  referrals: LoyaltyClientReferral[]
  events: LoyaltyEvent[]
  recent_visits: LoyaltyClientVisit[]
}

export interface LoyaltyMaintenanceResult {
  lots_expired: number
  expiring_notified: number
  tier_changes: number
  grace_reminders: number
  rewards_expired: number
  ran_at: string
}
