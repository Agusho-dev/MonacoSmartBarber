'use client'

import { useState, useTransition } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getAvailableSlots } from '@/lib/actions/appointments'
import type { BookingServiceOption } from './appointment-booking-dialog'
import type { GridBarber } from './appointments-grid-view'

interface Props {
  branchId: string
  services: BookingServiceOption[]
  barbers: GridBarber[]
  onPickSlot: (args: { date: string; time: string; barberId: string }) => void
}

interface FoundSlot {
  date: string
  time: string
  barberId: string
  barberName: string
}

export function AppointmentTimeFinder({ branchId, services, barbers, onPickSlot }: Props) {
  const [serviceId, setServiceId] = useState<string>('')
  const [barberId, setBarberId] = useState<string>('__any__')
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().split('T')[0])
  const [daysAhead, setDaysAhead] = useState(7)
  const [results, setResults] = useState<FoundSlot[]>([])
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const availableServices = services.filter(
    (s) => !s.branch_id || s.branch_id === branchId,
  )

  function handleSearch() {
    setError('')
    setResults([])
    startTransition(async () => {
      const found: FoundSlot[] = []
      for (let i = 0; i < daysAhead; i++) {
        const d = new Date(fromDate + 'T12:00:00')
        d.setDate(d.getDate() + i)
        const dateStr = d.toISOString().split('T')[0]
        const { slots, error: slotsError } = await getAvailableSlots(
          branchId,
          dateStr,
          serviceId || undefined,
          barberId === '__any__' ? undefined : barberId,
        )
        if (slotsError) continue

        for (const barber of slots) {
          for (const slot of barber.slots) {
            if (!slot.available) continue
            found.push({
              date: dateStr,
              time: slot.time,
              barberId: barber.barberId,
              barberName: barber.barberName,
            })
            if (found.length >= 20) break
          }
          if (found.length >= 20) break
        }
        if (found.length >= 20) break
      }

      if (found.length === 0) {
        setError('No se encontraron horarios disponibles en ese rango.')
      }
      setResults(found)
    })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Search className="size-4" />
        <h3 className="text-sm font-semibold">Buscador de hora</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Servicio</Label>
          <Select value={serviceId} onValueChange={setServiceId}>
            <SelectTrigger><SelectValue placeholder="Cualquier servicio" /></SelectTrigger>
            <SelectContent>
              {availableServices.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} · {s.duration_minutes ?? 30}min
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Barbero</Label>
          <Select value={barberId} onValueChange={setBarberId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">Cualquiera</SelectItem>
              {barbers.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Desde</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Días</Label>
            <Input
              type="number"
              min={1}
              max={30}
              value={daysAhead}
              onChange={(e) => setDaysAhead(Number(e.target.value) || 1)}
            />
          </div>
        </div>

        <Button size="sm" className="w-full" onClick={handleSearch} disabled={isPending}>
          {isPending ? <><Loader2 className="mr-2 size-4 animate-spin" /> Buscando…</> : 'Buscar horarios'}
        </Button>

        {error && (
          <p className="text-xs text-red-500">{error}</p>
        )}

        {results.length > 0 && (
          <ul className="space-y-1 border-t pt-2">
            {results.map((r, i) => (
              <li key={`${r.date}-${r.time}-${r.barberId}-${i}`}>
                <button
                  className="w-full rounded-md border bg-card p-2 text-left text-xs hover:bg-accent"
                  onClick={() => onPickSlot({ date: r.date, time: r.time, barberId: r.barberId })}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold">{r.date} · {r.time}</span>
                    <span className="text-muted-foreground truncate ml-2">{r.barberName}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
