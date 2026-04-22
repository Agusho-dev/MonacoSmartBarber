'use client'

import * as React from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface TemplateOption {
  id: string
  name: string
  language: string
  category: string | null
  status: string
}

interface TemplatePickerSelectProps {
  templates: TemplateOption[]
  value: string | null
  onChange: (templateId: string | null) => void
  placeholder?: string
  disabled?: boolean
  recommendedName?: string
  className?: string
  /**
   * Cuando true, muestra templates con status != approved en la lista
   * (con badge). Útil para que el admin vea el estado de aprobación de Meta.
   */
  showPending?: boolean
}

const STATUS_LABEL: Record<string, string> = {
  approved: 'Aprobada',
  pending: 'Pendiente',
  rejected: 'Rechazada',
  paused: 'Pausada',
  disabled: 'Desactivada',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  approved: 'default',
  pending: 'secondary',
  rejected: 'destructive',
  paused: 'outline',
  disabled: 'outline',
}

export function TemplatePickerSelect({
  templates,
  value,
  onChange,
  placeholder = 'Seleccioná una template',
  disabled,
  recommendedName,
  className,
  showPending = true,
}: TemplatePickerSelectProps) {
  const filtered = React.useMemo(() => {
    return showPending ? templates : templates.filter(t => t.status === 'approved')
  }, [templates, showPending])

  // Ordenar: recomendada primero, luego aprobadas, luego por nombre
  const sorted = React.useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (recommendedName) {
        if (a.name === recommendedName && b.name !== recommendedName) return -1
        if (b.name === recommendedName && a.name !== recommendedName) return 1
      }
      const aApproved = a.status === 'approved' ? 0 : 1
      const bApproved = b.status === 'approved' ? 0 : 1
      if (aApproved !== bApproved) return aApproved - bApproved
      return a.name.localeCompare(b.name)
    })
  }, [filtered, recommendedName])

  const handleChange = (next: string) => {
    onChange(next === '__none__' ? null : next)
  }

  return (
    <Select
      value={value ?? '__none__'}
      onValueChange={handleChange}
      disabled={disabled || templates.length === 0}
    >
      <SelectTrigger className={cn('w-full', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">
          <span className="text-muted-foreground">Sin template (texto plano)</span>
        </SelectItem>
        {sorted.map(t => (
          <SelectItem key={t.id} value={t.id} disabled={t.status !== 'approved'}>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{t.name}</span>
              {t.name === recommendedName && (
                <Badge variant="default" className="text-[10px]">Recomendada</Badge>
              )}
              {t.status !== 'approved' && (
                <Badge variant={STATUS_VARIANT[t.status] ?? 'outline'} className="text-[10px]">
                  {STATUS_LABEL[t.status] ?? t.status}
                </Badge>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
