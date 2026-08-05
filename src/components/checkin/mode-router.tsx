'use client'

/**
 * ModeRouter — cascarón del kiosko para sucursales con turnos.
 *
 * Rutea entre tres superficies y no hace nada más:
 *   - `TurnosCheckinFlow`: el flujo del cliente con turno (appointments/hybrid).
 *   - `InlineQuickBookFlow`: la reserva inline.
 *   - `CheckinWalkIn`: la fila, sólo alcanzable desde hybrid.
 *
 * La sucursal y el modo los resuelve el server component (`page.tsx`), que ya
 * verificó que el turnero esté REALMENTE activo (operation_mode + is_enabled).
 *
 * Los datos de reserva (servicios y barberos) se cargan acá, una sola vez por
 * carga de página: este componente no se remonta con el reset del kiosko, y
 * `getPublicBranchAppointmentStaff` está rate-limiteado por IP+sucursal —
 * cargarlos dentro del sub-flujo gastaba una ficha por cliente.
 */

import { useState, useEffect } from 'react'
import { getPublicBranchAppointmentStaff } from '@/lib/actions/appointments'
import { publicGetBranchServices } from '@/lib/actions/public-booking'
import type { BranchOperationMode } from '@/lib/actions/turnos-mode'
import type { PublicStaff, PublicService } from '@/lib/actions/public-booking'
import { CheckinWalkIn } from '@/app/(tablet)/checkin/checkin-walk-in'
import { TurnosCheckinFlow } from '@/components/checkin/turnos-flow'
import type { NewClientPrefill } from '@/components/checkin/turnos-flow'
import { InlineQuickBookFlow } from '@/components/checkin/inline-quickbook-flow'
import { TerminalAmbient, TerminalGlobalStyles } from '@/components/checkin/terminal-theme'
import { cn } from '@/lib/utils'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ModeRouterProps {
  branchId: string
  branchName: string
  branchTimezone: string
  organizationId: string
  orgName: string
  orgLogoUrl: string | null
  operationMode: BranchOperationMode
  /** Color de fondo ya resuelto (sucursal → app_settings). */
  bgCss: string
  isLightBg: boolean
}

type SubRoute = 'default' | 'walkin' | 'booking'

// ─── Componente ───────────────────────────────────────────────────────────────

export function ModeRouter({
  branchId,
  branchName,
  branchTimezone,
  organizationId,
  orgName,
  orgLogoUrl,
  operationMode,
  bgCss,
  isLightBg,
}: ModeRouterProps) {
  const [subRoute, setSubRoute] = useState<SubRoute>('default')
  const [resetKey, setResetKey] = useState(0)
  const [prefill, setPrefill] = useState<NewClientPrefill | undefined>(undefined)

  const [services, setServices] = useState<PublicService[]>([])
  const [staff, setStaff] = useState<PublicStaff[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  /**
   * Vuelve el kiosko a cero para el próximo cliente.
   *
   * `setSubRoute('default')` solo no alcanza: cuando la sub-ruta YA era
   * 'default', React descarta el update, el sub-flujo no se re-renderiza y su
   * step interno se queda donde estaba. Bumpear la key fuerza el remount, así
   * el reset no depende de que cada sub-flujo se acuerde de limpiarse.
   */
  const resetKiosko = () => {
    setSubRoute('default')
    setPrefill(undefined)
    setResetKey((k) => k + 1)
  }

  const irAReservar = (datos?: NewClientPrefill) => {
    setPrefill(datos)
    setSubRoute('booking')
  }

  // ── Datos de reserva ──
  useEffect(() => {
    let cancelado = false

    const cargar = async () => {
      setLoadingData(true)
      setDataError(null)

      // Los servicios reservables salen de `publicGetBranchServices`, la misma
      // fuente que usa el turnero público. Antes se consultaba `services`
      // directo desde el browser con la anon key: (a) la política
      // `services_anon_read` no filtra por organización, así que llegaban los
      // servicios de las 7 orgs de la plataforma, y (b) el filtro
      // `availability IN ('appointment','all','both')` usaba valores que NO
      // existen en el enum `service_availability` (es `checkin | upsell | both`),
      // con lo cual la query moría con 22P02 y el kiosko anunciaba "no hay
      // servicios disponibles para reservar" en una sucursal perfectamente
      // configurada.
      const [serviciosRes, staffRows] = await Promise.all([
        publicGetBranchServices(branchId),
        getPublicBranchAppointmentStaff(branchId),
      ])

      if (cancelado) return

      // `publicGetBranchServices` ya descarta lo que no es autogestionable; acá
      // sólo se sacan los adicionales (`upsell`), que se venden arriba de un
      // corte y no son un turno en sí mismos.
      const servicios = serviciosRes.filter(s => s.availability !== 'upsell')

      // Las dos actions devuelven [] tanto por error de lectura como por "no hay
      // nada configurado", así que no se pueden distinguir desde acá. Que falten
      // LAS DOS cosas a la vez sí es señal de que algo no anda: una sucursal con
      // el turnero activo tiene sí o sí servicios y al menos un barbero.
      if (!servicios.length && !staffRows.length) {
        setDataError('No pudimos cargar los datos para reservar. Avisá en el mostrador.')
      }

      setServices(servicios)
      setStaff(staffRows as PublicStaff[])
      setLoadingData(false)
    }

    cargar()
    return () => {
      cancelado = true
    }
  }, [branchId])

  // El flujo walk-in lista las sucursales con `getPublicBranches()`, que
  // resuelve la org desde la cookie. Una tablet abierta directo en
  // `/checkin?branch=…` (link del dashboard) no la tiene, y el cliente que
  // elegía "entrar a la fila" se encontraba con el selector de sucursales
  // vacío girando. La seteamos sólo si falta, para no pisar una org elegida.
  useEffect(() => {
    const yaHayOrg = document.cookie
      .split(';')
      .some((c) => /^\s*(public|active)_organization=/.test(c))
    if (yaHayOrg) return

    import('@/lib/actions/org').then(({ setActiveOrgFromBranch }) => {
      setActiveOrgFromBranch(branchId)
    })
  }, [branchId])

  const irACambiarSucursal = () => {
    // Sin ?branch la página vuelve al selector de sucursales.
    window.location.href = '/checkin'
  }

  // ─── Sub-ruta: fila walk-in (sólo hybrid) ───────────────────────────────────
  //
  // La key remonta el flujo por cliente y `onExit` lo devuelve al kiosko de
  // turnos cuando termina. Sin las dos cosas, el primero que elegía la fila
  // dejaba la tablet en walk-in puro para todos los siguientes.
  if (subRoute === 'walkin') {
    return <CheckinWalkIn key={`walkin-${resetKey}`} onExit={resetKiosko} />
  }

  const shell = (children: React.ReactNode) => (
    <div
      className={cn(
        'relative h-dvh flex flex-col items-center select-none overflow-y-auto overflow-x-hidden py-2 md:py-4',
        !isLightBg && 'bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.03)_0%,transparent_60%)]'
      )}
      style={{ background: bgCss, color: isLightBg ? '#18181b' : '#f4f4f5' }}
    >
      <TerminalGlobalStyles />
      <TerminalAmbient className={isLightBg ? 'hidden' : undefined} />
      {children}
    </div>
  )

  if (subRoute === 'booking') {
    return shell(
      <InlineQuickBookFlow
        key={`booking-${resetKey}`}
        branchId={branchId}
        branchTimezone={branchTimezone}
        services={services}
        staff={staff}
        dataError={dataError}
        loadingData={loadingData}
        isLightBg={isLightBg}
        prefill={prefill}
        onBack={resetKiosko}
        onReset={resetKiosko}
      />
    )
  }

  // `walk_in` no debería llegar acá (page.tsx rutea al kiosko clásico), pero si
  // llega, la fila es el fallback seguro.
  if (operationMode === 'walk_in') {
    return <CheckinWalkIn key={`walkin-fallback-${resetKey}`} />
  }

  return shell(
    <TurnosCheckinFlow
      key={`turnos-${resetKey}`}
      branchId={branchId}
      branchName={branchName}
      organizationId={organizationId}
      orgName={orgName}
      orgLogoUrl={orgLogoUrl}
      operationMode={operationMode}
      isLightBg={isLightBg}
      canBook={!loadingData && !dataError && services.length > 0 && staff.length > 0}
      onBook={irAReservar}
      onWalkIn={() => setSubRoute('walkin')}
      onReset={resetKiosko}
      onChangeBranch={irACambiarSucursal}
    />
  )
}
