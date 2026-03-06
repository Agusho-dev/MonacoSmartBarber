'use client'

import { useState } from 'react'
import {
  format,
  startOfWeek,
  startOfMonth,
  startOfDay,
  endOfDay,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarIcon } from 'lucide-react'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'

interface DateRangePickerProps {
  from: Date
  to: Date
  onChange: (from: Date, to: Date) => void
}

const presets = [
  {
    label: 'Hoy',
    getRange: () => ({
      from: startOfDay(new Date()),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: 'Semana',
    getRange: () => ({
      from: startOfWeek(new Date(), { weekStartsOn: 1 }),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: 'Mes',
    getRange: () => ({
      from: startOfMonth(new Date()),
      to: endOfDay(new Date()),
    }),
  },
]

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <Button
          key={p.label}
          variant="outline"
          size="sm"
          onClick={() => {
            const r = p.getRange()
            onChange(r.from, r.to)
          }}
        >
          {p.label}
        </Button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <CalendarIcon className="size-4" />
            {format(from, 'dd/MM/yy', { locale: es })} –{' '}
            {format(to, 'dd/MM/yy', { locale: es })}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            selected={{ from, to }}
            onSelect={(range) => {
              if (range?.from) {
                onChange(
                  startOfDay(range.from),
                  endOfDay(range.to ?? range.from)
                )
                if (range.to) setOpen(false)
              }
            }}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
