'use client'

/**
 * ModeRouter — decide qué sub-flujo renderizar según el operation_mode de la sucursal.
 *
 * Modos:
 *   walk_in       → CheckinWalkIn (flujo original, regresión 0)
 *   appointments  → AppointmentLookupFlow + InlineQuickBookFlow
 *   hybrid        → HybridRouter (pregunta "¿Tenés turno?" + ramificación)
 *
 * Este componente es client porque gestiona el sub-routing entre flujos
 * y carga los datos de servicios/barberos para los modos que los necesitan.
 * La sucursal ya fue resuelta por el server component (page.tsx) y llega
 * como prop para evitar un segundo fetch en el cliente.
 */

import { useState, useEffect } from 'react'
import type { BranchOperationMode } from '@/lib/actions/turnos-mode'
import type { Service, Staff } from '@/lib/types/database'
import { CheckinWalkIn } from '@/app/(tablet)/checkin/checkin-walk-in'
import { AppointmentLookupFlow } from '@/components/checkin/appointment-lookup-flow'
import { InlineQuickBookFlow } from '@/components/checkin/inline-quickbook-flow'
import { HybridRouter } from '@/components/checkin/hybrid-router'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ModeRouterProps {
  branchId: string
  operationMode: BranchOperationMode
  /** isLightBg se puede derivar del branch.checkin_bg_color en el server y pasarse */
  isLightBg?: boolean
}

// ─── Sub-rutas internas ───────────────────────────────────────────────────────

type SubRoute = 'default' | 'walkin' | 'booking'

// ─── Componente ───────────────────────────────────────────────────────────────

export function ModeRouter({ branchId, operationMode, isLightBg = false }: ModeRouterProps) {
  const [subRoute, setSubRoute] = useState<SubRoute>('default')
  const [services, setServices] = useState<Service[]>([])
  const [barbers, setBarbers] = useState<Staff[]>([])

  // Cargar servicios y barberos solo para los modos que los necesitan
  useEffect(() => {
    if (operationMode === 'walk_in') return

    const loadData = async () => {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const [servicesRes, staffRes] = await Promise.all([
        supabase
          .from('services')
          .select('*')
          .eq('is_active', true)
          .in('availability', ['appointment', 'all', 'both'])
          .or(`branch_id.eq.${branchId},branch_id.is.null`)
          .order('name'),
        supabase
          .from('staff')
          .select('*')
          .eq('branch_id', branchId)
          .or('role.eq.barber,is_also_barber.eq.true')
          .eq('is_active', true)
          .order('full_name'),
      ])

      setServices((servicesRes.data ?? []) as Service[])
      setBarbers((staffRes.data ?? []) as Staff[])
    }

    loadData()
  }, [branchId, operationMode])

  // ─── Sub-ruta: walk-in completo (desde hybrid) ──────────────────────────────
  if (subRoute === 'walkin') {
    return <CheckinWalkIn />
  }

  // ─── Sub-ruta: reserva inline (desde appointments o hybrid) ─────────────────
  if (subRoute === 'booking') {
    return (
      <InlineQuickBookFlow
        branchId={branchId}
        services={services}
        barbers={barbers}
        isLightBg={isLightBg}
        onBack={() => setSubRoute('default')}
        onReset={() => setSubRoute('default')}
      />
    )
  }

  // ─── walk_in ─────────────────────────────────────────────────────────────────
  if (operationMode === 'walk_in') {
    return <CheckinWalkIn />
  }

  // ─── appointments ─────────────────────────────────────────────────────────────
  if (operationMode === 'appointments') {
    return (
      <AppointmentLookupFlow
        branchId={branchId}
        isLightBg={isLightBg}
        onNoAppointmentBook={() => setSubRoute('booking')}
        onReset={() => setSubRoute('default')}
      />
    )
  }

  // ─── hybrid ───────────────────────────────────────────────────────────────────
  if (operationMode === 'hybrid') {
    return (
      <HybridRouter
        branchId={branchId}
        services={services}
        barbers={barbers}
        isLightBg={isLightBg}
        clientName=""
        onWalkIn={() => setSubRoute('walkin')}
        onReset={() => setSubRoute('default')}
      />
    )
  }

  // Fallback seguro
  return <CheckinWalkIn />
}
