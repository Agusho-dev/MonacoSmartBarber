'use client'

import { useEffect } from 'react'
import { useBranchStore } from '@/stores/branch-store'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Branch {
  id: string
  name: string
}

interface Props {
  branches: Branch[]
  className?: string
}

export function BranchSelector({ branches, className }: Props) {
  const { selectedBranchId, setSelectedBranchId } = useBranchStore()

  // Initialize branch in store if not set
  useEffect(() => {
    if (!selectedBranchId && branches.length > 0) {
      setSelectedBranchId(branches[0].id)
    }
  }, [selectedBranchId, branches, setSelectedBranchId])

  const effectiveValue = selectedBranchId ?? (branches[0]?.id ?? '')

  if (branches.length <= 1) return null

  return (
    <Select value={effectiveValue} onValueChange={setSelectedBranchId}>
      <SelectTrigger className={className ?? 'w-[200px]'}>
        <SelectValue placeholder="Seleccionar sucursal" />
      </SelectTrigger>
      <SelectContent>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
