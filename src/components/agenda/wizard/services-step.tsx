'use client'

import { useMemo } from 'react'
import { Clock, Check, Scissors, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import type { TurnosService, TurnosStaff } from '@/lib/actions/turnos'

interface Props {
  services: TurnosService[]
  staff: TurnosStaff[]
  selectedServiceIds: string[]
  selectedStaffId: string | null
  onServicesChange: (ids: string[]) => void
  onStaffChange: (id: string | null) => void
}

const CUALQUIERA = '__cualquiera__'

export function ServicesStep({
  services,
  staff,
  selectedServiceIds,
  selectedStaffId,
  onServicesChange,
  onStaffChange,
}: Props) {
  const totalDuration = useMemo(() => {
    return services
      .filter((s) => selectedServiceIds.includes(s.id))
      .reduce((acc, s) => acc + s.duration_minutes, 0)
  }, [services, selectedServiceIds])

  const totalPrice = useMemo(() => {
    return services
      .filter((s) => selectedServiceIds.includes(s.id))
      .reduce((acc, s) => acc + s.price, 0)
  }, [services, selectedServiceIds])

  function toggleService(id: string) {
    onServicesChange(
      selectedServiceIds.includes(id)
        ? selectedServiceIds.filter((s) => s !== id)
        : [...selectedServiceIds, id]
    )
  }

  return (
    <div className="space-y-4">
      {/* Lista de servicios */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Servicios
        </p>
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay servicios habilitados para turnos en esta sucursal.
          </p>
        ) : (
          <ul className="grid gap-2">
            {services.map((service) => {
              const selected = selectedServiceIds.includes(service.id)
              return (
                <li key={service.id}>
                  <button
                    type="button"
                    onClick={() => toggleService(service.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent',
                      selected && 'border-primary bg-primary/5'
                    )}
                  >
                    <div
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full border',
                        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted bg-muted'
                      )}
                    >
                      {selected ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Scissors className="size-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{service.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {service.duration_minutes} min
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-sm">
                      {formatCurrency(service.price)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Selector de barbero */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Barbero preferido
        </p>
        <Select
          value={selectedStaffId ?? CUALQUIERA}
          onValueChange={(v) => onStaffChange(v === CUALQUIERA ? null : v)}
        >
          <SelectTrigger className="gap-2">
            <User className="size-4 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CUALQUIERA}>Cualquiera disponible</SelectItem>
            {staff.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Preview totales */}
      {selectedServiceIds.length > 0 && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-sm">
            <Clock className="size-3.5 text-muted-foreground" />
            <span className="font-medium">{totalDuration} min</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <span className="font-mono text-sm font-medium">{formatCurrency(totalPrice)}</span>
          <div className="ml-auto flex gap-1">
            {selectedServiceIds.length > 1 && (
              <Badge variant="secondary" className="text-[10px]">
                {selectedServiceIds.length} servicios
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
