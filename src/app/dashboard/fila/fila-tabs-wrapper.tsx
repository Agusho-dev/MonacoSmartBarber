'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CalendarClock, Users } from 'lucide-react'
import { AppointmentList } from '@/components/appointments/appointment-list'
import type { Appointment } from '@/lib/types/database'

interface Props {
  children: React.ReactNode
  appointments: Appointment[]
  noShowToleranceMinutes: number
}

export function FilaTabsWrapper({ children, appointments, noShowToleranceMinutes }: Props) {
  return (
    <Tabs defaultValue="fila" className="h-full">
      <div className="px-3 pt-1">
        <TabsList>
          <TabsTrigger value="fila" className="gap-1.5">
            <Users className="h-4 w-4" />
            Fila
          </TabsTrigger>
          <TabsTrigger value="turnos" className="gap-1.5">
            <CalendarClock className="h-4 w-4" />
            Turnos del día
            {appointments.filter(a => ['confirmed', 'checked_in'].includes(a.status)).length > 0 && (
              <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                {appointments.filter(a => ['confirmed', 'checked_in'].includes(a.status)).length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="fila" className="mt-0 h-full">
        {children}
      </TabsContent>

      <TabsContent value="turnos" className="mt-0 px-3">
        <AppointmentList
          appointments={appointments}
          noShowToleranceMinutes={noShowToleranceMinutes}
        />
      </TabsContent>
    </Tabs>
  )
}
