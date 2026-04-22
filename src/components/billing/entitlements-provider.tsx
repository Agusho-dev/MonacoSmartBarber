'use client'

import { createContext, useContext, type ReactNode } from 'react'

export type EntitlementsSnapshot = {
  orgId: string
  planId: string
  planName: string
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused' | 'incomplete'
  trialEndsAt: string | null
  features: Record<string, boolean>
  limits: {
    branches: number
    staff: number
    clients: number
    broadcasts_monthly: number
    ai_messages_monthly: number
  }
  currentUsage: {
    branches: number
    staff: number
    clients: number
    broadcasts_this_month: number
    ai_messages_this_month: number
  }
  enabledModuleIds: string[]
  isAccessAllowed: boolean
  cancelAtPeriodEnd: boolean
  isGrandfathered: boolean
}

const EntitlementsContext = createContext<EntitlementsSnapshot | null>(null)

export function EntitlementsProvider({
  value,
  children,
}: {
  value: EntitlementsSnapshot | null
  children: ReactNode
}) {
  return (
    <EntitlementsContext.Provider value={value}>
      {children}
    </EntitlementsContext.Provider>
  )
}

export function useEntitlements(): EntitlementsSnapshot | null {
  return useContext(EntitlementsContext)
}

export function useHasFeature(featureKey: string): boolean {
  const ent = useEntitlements()
  return ent?.features[featureKey] === true
}

export function useRemainingLimit(metric: 'branches' | 'staff' | 'clients'): number | 'unlimited' {
  const ent = useEntitlements()
  if (!ent) return 0
  const limit = ent.limits[metric]
  if (limit === -1) return 'unlimited'
  const used = ent.currentUsage[metric]
  return Math.max(0, limit - used)
}
