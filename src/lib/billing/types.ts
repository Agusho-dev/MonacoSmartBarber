// ============================================================
// Tipos y clases del sistema de entitlements
// Archivo sin 'use server' para poder exportar tipos y clase.
// ============================================================

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'paused'
  | 'incomplete'

export type ModuleVisibility = 'active' | 'beta' | 'coming_soon' | 'hidden'

export type Limits = {
  branches: number
  staff: number
  clients: number
  broadcasts_monthly: number
  ai_messages_monthly: number
}

export type CurrentUsage = {
  branches: number
  staff: number
  clients: number
  broadcasts_this_month: number
  ai_messages_this_month: number
}

export type ModuleMeta = {
  id: string
  name: string
  description: string | null
  icon: string | null
  category: string | null
  status: ModuleVisibility
  teaser_copy: string | null
  estimated_release: string | null
  price_ars_addon: number | null
  included_in_plans: string[]
  feature_key: string
  sort_order: number
  unlocked: boolean
}

export type Entitlements = {
  orgId: string
  plan: {
    id: string
    name: string
    tagline: string | null
    price_ars_monthly: number
  }
  status: SubscriptionStatus
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  features: Record<string, boolean>
  limits: Limits
  currentUsage: CurrentUsage
  enabledModuleIds: string[]
  visibleModules: ModuleMeta[]
  isGrandfathered: boolean
  inGracePeriod: boolean
  isAccessAllowed: boolean
}

export type LimitMetric = 'branches' | 'staff' | 'clients'
export type MonthlyCapMetric = 'broadcasts_monthly' | 'ai_messages_monthly'
export type UsageMetric = 'broadcasts_sent' | 'sms_sent' | 'ai_messages'

export type EntitlementErrorKind =
  | 'feature_locked'
  | 'limit_exceeded'
  | 'subscription_inactive'

export class EntitlementError extends Error {
  kind: EntitlementErrorKind
  feature?: string
  limit?: number
  current?: number

  constructor(
    kind: EntitlementErrorKind,
    message: string,
    meta: { feature?: string; limit?: number; current?: number } = {},
  ) {
    super(message)
    this.name = 'EntitlementError'
    this.kind = kind
    this.feature = meta.feature
    this.limit = meta.limit
    this.current = meta.current
  }

  toResponse() {
    return {
      error: this.kind,
      message: this.message,
      feature: this.feature ?? null,
      limit: this.limit ?? null,
      current: this.current ?? null,
    } as const
  }
}

export type EntitlementErrorResponse = ReturnType<EntitlementError['toResponse']>

export function isEntitlementResponseError(
  value: unknown,
): value is EntitlementErrorResponse {
  if (!value || typeof value !== 'object') return false
  const v = value as { error?: unknown }
  return v.error === 'feature_locked' || v.error === 'limit_exceeded' || v.error === 'subscription_inactive'
}
