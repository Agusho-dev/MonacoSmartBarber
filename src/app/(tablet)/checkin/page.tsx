/**
 * Página de check-in del kiosk (server component).
 *
 * Lee el operation_mode de la sucursal desde Supabase y delega
 * el renderizado al ModeRouter (client component) que selecciona
 * el sub-flujo correcto:
 *
 *   walk_in       → CheckinWalkIn (flujo original, sin cambios visuales)
 *   appointments  → AppointmentLookupFlow
 *   hybrid        → HybridRouter
 *
 * Si no hay branchId en la URL o el branch no existe, el CheckinWalkIn
 * maneja la selección de sucursal como siempre lo hizo.
 */

import { Suspense } from 'react'
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

interface CheckinPageProps {
  searchParams: Promise<{ branch?: string }>
}

export default async function CheckinPage({ searchParams }: CheckinPageProps) {
  const params = await searchParams
  const branchId = params.branch

  // Sin branchId en la URL → el CheckinWalkIn maneja la selección internamente.
  // (El PIN gate se aplica recién cuando hay una org/branch identificable; sin
  // branch no podemos saber a qué org pedirle el PIN.)
  if (!branchId || !isValidUUID(branchId)) {
    return (
      <Suspense>
        <CheckinWalkIn />
      </Suspense>
    )
  }

  // Leer branch + datos de la org dueña (operación pública: sin auth)
  const supabase = createAdminClient()
  const { data: branch } = await supabase
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

  // ─── PIN gate (aplica a TODOS los modos: walk_in, appointments, hybrid) ───
  // Supabase devuelve embedded relations como array (incluso con !inner). Tomamos
  // el primero por seguridad y lo casteamos al shape mínimo que necesitamos.
  const orgRel = branch?.organizations as
    | { slug: string; name: string; logo_url: string | null }
    | { slug: string; name: string; logo_url: string | null }[]
    | null
    | undefined
  const org = Array.isArray(orgRel) ? (orgRel[0] ?? null) : (orgRel ?? null)

  if (org) {
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
            {/* placeholder; el reload tras validar muestra el contenido real */}
            <div />
          </PinGate>
        )
      }
    }
  }

  // ─── Render normal según modo ─────────────────────────────────────────────
  const operationMode = ((branch?.operation_mode as BranchOperationMode) ?? 'walk_in')

  if (operationMode === 'walk_in') {
    return (
      <Suspense>
        <CheckinWalkIn />
      </Suspense>
    )
  }

  const bgColor = branch?.checkin_bg_color ?? '#27272a'
  const isLightBg = isLightBackground(bgColor)

  return (
    <Suspense>
      <ModeRouter
        branchId={branchId}
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
