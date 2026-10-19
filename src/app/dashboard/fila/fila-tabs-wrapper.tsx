'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CalendarClock, Users } from 'lucide-react'
import { AppointmentList } from '@/components/appointments/appointment-list'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import type { Appointment } from '@/lib/types/database'
import { AltaCliente } from './alta-cliente'
import type { BarberRow, BranchRow } from './_tablero/derivados'

interface Props {
  children: React.ReactNode
  appointments: Appointment[]
  noShowToleranceMinutes: number
  branches: BranchRow[]
  barbers: BarberRow[]
  orgId: string
}

/** Turnos que todavía cuentan para hoy (los que se muestran en la pestaña). */
const ESTADOS_VIVOS = ['pending_payment', 'confirmed', 'checked_in']

/**
 * El marco de la pantalla de fila: las dos vistas (la fila en vivo y los turnos
 * del día), la sucursal y «Anotar cliente», todo en un renglón.
 *
 * En escritorio la pantalla mide lo que queda del alto del dashboard y cada panel
 * scrollea adentro; en el celular scrollea la página entera. El shell deja abajo
 * 4,5 rem para la barra de navegación del celular (y para las barras fijas de
 * guardar de otras pantallas): en `lg` esa barra no existe, así que acá se
 * recupera con un margen negativo y queda abajo el mismo aire que arriba (1,5 rem).
 */
export function FilaTabsWrapper({ children, appointments, noShowToleranceMinutes, branches, barbers, orgId }: Props) {
  const turnosVivos = appointments.filter((a) => ESTADOS_VIVOS.includes(a.status)).length

  return (
    <Tabs
      defaultValue="fila"
      className="gap-4 md:h-[calc(100dvh-8.25rem)] lg:-mb-[4.5rem] lg:h-[calc(100dvh-6.5rem)]"
    >
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList className="w-full rounded-xl p-1 group-data-[orientation=horizontal]/tabs:h-11 sm:w-auto">
          <TabsTrigger value="fila" className="gap-2 rounded-lg px-4 text-[0.9375rem]">
            <Users className="size-4" aria-hidden />
            Fila en vivo
          </TabsTrigger>
          <TabsTrigger value="turnos" className="gap-2 rounded-lg px-4 text-[0.9375rem]">
            <CalendarClock className="size-4" aria-hidden />
            Turnos del día
            {turnosVivos > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-500/20 px-1.5 font-mono text-xs tabular-nums text-violet-200">
                {turnosVivos}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">
          <BranchSelector branches={branches} className="min-w-0 flex-1 data-[size=default]:h-10 sm:w-[12.5rem] sm:flex-none" />
          <AltaCliente orgId={orgId} barberosIniciales={barbers} />
        </div>
      </div>

      <TabsContent value="fila" className="mt-0 md:min-h-0 md:flex-1">
        {children}
      </TabsContent>

      <TabsContent value="turnos" className="mt-0 md:min-h-0 md:flex-1 md:overflow-y-auto">
        <AppointmentList appointments={appointments} noShowToleranceMinutes={noShowToleranceMinutes} />
      </TabsContent>
    </Tabs>
  )
}
