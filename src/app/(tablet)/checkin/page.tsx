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
 *     Al elegirla navega a `?branch=<id>` para que ESTE componente vuelva a
 *     correr y pueda resolver el modo: sin eso, una sucursal en modo turnos
 *     atendida desde una tablet sin querystring nunca salía del walk-in.
 *   - Con branch + turnero activo en modo `appointments` → ModeRouter (flujo
 *     de turnos puro, sin fila).
 *   - Con branch + turnero activo en modo `hybrid` → CheckinWalkIn con
 *     `conTurnos`: la tablet es la fila de siempre (cara/teléfono, servicio,
 *     barbero, fichaje del staff) y, al identificar al cliente, si tiene turno
 *     HOY le ofrece confirmar la llegada. Sin turno no le pregunta nada ni le
 *     ofrece reservar: reservar es cosa de la página `/turnos/[slug]` y de la
 *     app. (Antes hybrid iba al flujo de turnos y cada walk-in pasaba por
 *     "no tenés turno, ¿entrás a la fila?" — y el staff perdía "Soy barbero".)
 *   - Con branch sin turnero activo → CheckinWalkIn.
 */

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { ModeRouter } from '@/components/checkin/mode-router'
import { CheckinWalkIn } from '@/app/(tablet)/checkin/checkin-walk-in'
import { PinGate } from '@/components/checkin/pin-gate'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import { resolveCheckinBackground } from '@/lib/checkin-bg'
import type { BranchOperationMode } from '@/lib/actions/turnos-mode'
import { getAppointmentSettings } from '@/lib/actions/appointments'
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
  name: string
  timezone: string | null
  organization_id: string
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
        name,
        timezone,
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
        name: data.name as string,
        timezone: (data.timezone as string | null) ?? null,
        organization_id: data.organization_id as string,
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
      return <PinGate orgSlug={org.slug} orgName={org.name} orgLogoUrl={org.logo_url} />
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

  // Tener turnos prendidos son DOS cosas, no una: `operation_mode` distinto de
  // walk_in Y `appointment_settings.is_enabled`. Con is_enabled en false (que es
  // el default de fábrica) la tablet anunciaba "trabajamos con turnos" pero el
  // motor de disponibilidad devolvía "Turnos no habilitados": la sucursal
  // quedaba sin fila y sin turnos a la vez.
  const operationMode = (branch.operation_mode ?? 'walk_in') as BranchOperationMode
  const settings =
    operationMode === 'walk_in'
      ? null
      : await getAppointmentSettings(branch.organization_id, branch.id)
  const turneroActivo = operationMode !== 'walk_in' && settings?.is_enabled === true

  if (!turneroActivo) {
    return (
      <Suspense>
        <CheckinWalkIn />
      </Suspense>
    )
  }

  // Híbrido: la fila manda, los turnos se suman (ver cabecera).
  if (operationMode === 'hybrid') {
    return (
      <Suspense>
        <CheckinWalkIn conTurnos />
      </Suspense>
    )
  }

  const { css: bgCss, isLight } = resolveCheckinBackground(
    branch.checkin_bg_color?.trim() || (await getOrgCheckinBg(branch.organization_id))
  )

  return (
    <Suspense>
      <ModeRouter
        branchId={branch.id}
        branchName={branch.name}
        branchTimezone={branch.timezone || 'America/Argentina/Buenos_Aires'}
        organizationId={branch.organization_id}
        orgName={org.name}
        orgLogoUrl={org.logo_url}
        operationMode={operationMode}
        bgCss={bgCss}
        isLightBg={isLight}
      />
    </Suspense>
  )
}

// ─── Helper local ─────────────────────────────────────────────────────────────

/** Fondo por defecto de la org, igual que el que usa el kiosko walk-in. */
async function getOrgCheckinBg(orgId: string): Promise<string> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('app_settings')
    .select('checkin_bg_color')
    .eq('organization_id', orgId)
    .maybeSingle()

  const color = data?.checkin_bg_color
  return typeof color === 'string' && color.trim() ? color.trim() : '#3f3f46'
}
