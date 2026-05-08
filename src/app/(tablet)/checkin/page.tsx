/**
 * Página de check-in del kiosk (server component, multi-tenant).
 *
 * Resolución de org (orden estricto):
 *   1. Si hay ?branch= en la URL → resuelve org dueña de ese branch.
 *   2. Si no, intenta resolver via cookie pública (public_organization).
 *   3. Si no hay org → redirect a `/` (tenant selector).
 *
 * Una vez resuelta la org, aplica el PIN gate si la org lo requiere.
 *
 * Render según contexto:
 *   - Sin branch resuelto → CheckinWalkIn (selecciona branch, filtrado por org).
 *   - Con branch + walk_in → CheckinWalkIn.
 *   - Con branch + appointments/hybrid → ModeRouter.
 */

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { ModeRouter } from '@/components/checkin/mode-router'
import { CheckinWalkIn } from '@/app/(tablet)/checkin/checkin-walk-in'
import { PinGate } from '@/components/checkin/pin-gate'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import type { BranchOperationMode } from '@/lib/actions/turnos-mode'
import {
  hasValidCheckinSessionForOrg,
  orgRequiresCheckinPin,
} from '@/lib/actions/checkin-pin'
import { getActiveOrganization } from '@/lib/actions/org'

interface CheckinPageProps {
  searchParams: Promise<{ branch?: string }>
}

type ResolvedOrg = { slug: string; name: string; logo_url: string | null }
type ResolvedBranch = {
  id: string
  operation_mode: BranchOperationMode | null
  checkin_bg_color: string | null
} | null

export default async function CheckinPage({ searchParams }: CheckinPageProps) {
  const params = await searchParams
  const branchId = params.branch && isValidUUID(params.branch) ? params.branch : null

  // ─── 1. Resolver org (vía branch URL o cookie) ────────────────────────────
  let org: ResolvedOrg | null = null
  let branch: ResolvedBranch = null

  if (branchId) {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('branches')
      .select(`
        id,
        operation_mode,
        checkin_bg_color,
        organization_id,
        organizations!inner ( slug, name, logo_url )
      `)
      .eq('id', branchId)
      .eq('is_active', true)
      .maybeSingle()

    if (data) {
      branch = {
        id: data.id,
        operation_mode: data.operation_mode as BranchOperationMode | null,
        checkin_bg_color: data.checkin_bg_color as string | null,
      }
      const orgRel = data.organizations as ResolvedOrg | ResolvedOrg[] | null | undefined
      org = Array.isArray(orgRel) ? (orgRel[0] ?? null) : (orgRel ?? null)
    }
  }

  if (!org) {
    const activeOrg = await getActiveOrganization()
    if (activeOrg) {
      org = { slug: activeOrg.slug, name: activeOrg.name, logo_url: activeOrg.logo_url }
    }
  }

  // Multi-tenant strict: sin org no podemos servir el kiosk.
  if (!org) {
    redirect('/')
  }

  // ─── 2. PIN gate ──────────────────────────────────────────────────────────
  const requiresPin = await orgRequiresCheckinPin(org.slug)
  if (requiresPin) {
    const ok = await hasValidCheckinSessionForOrg(org.slug)
    if (!ok) {
      return (
        <PinGate
          orgSlug={org.slug}
          orgName={org.name}
          orgLogoUrl={org.logo_url}
        >
          <div />
        </PinGate>
      )
    }
  }

  // ─── 3. Render según contexto ─────────────────────────────────────────────
  // Sin branch específico → CheckinWalkIn maneja la selección (filtrada por org).
  if (!branch) {
    return (
      <Suspense>
        <CheckinWalkIn />
      </Suspense>
    )
  }

  const operationMode = (branch.operation_mode ?? 'walk_in') as BranchOperationMode

  if (operationMode === 'walk_in') {
    return (
      <Suspense>
        <CheckinWalkIn />
      </Suspense>
    )
  }

  const bgColor = branch.checkin_bg_color ?? '#27272a'
  const isLightBg = isLightBackground(bgColor)

  return (
    <Suspense>
      <ModeRouter
        branchId={branch.id}
        operationMode={operationMode}
        isLightBg={isLightBg}
      />
    </Suspense>
  )
}

// ─── Helper local ─────────────────────────────────────────────────────────────

/**
 * Heurística rápida para saber si el color de fondo es claro.
 * Soporta hex (#rrggbb, #rgb) y oklch (siempre oscuro en este contexto).
 */
function isLightBackground(color: string): boolean {
  if (!color || color.startsWith('oklch')) return false

  const hex = color.replace('#', '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex

  if (full.length !== 6) return false

  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)

  // Luminancia relativa (fórmula simplificada)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6
}
