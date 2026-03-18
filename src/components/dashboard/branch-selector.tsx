'use client'

import { useEffect, useState } from 'react'
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
  const { selectedBranchId, setSelectedBranchId, allowedBranchIds } = useBranchStore()

  const [isMounted, setIsMounted] = useState(false)

  // Filter branches by allowed scope
  const visibleBranches = allowedBranchIds
    ? branches.filter((b) => allowedBranchIds.includes(b.id))
    : branches

  useEffect(() => {
    setIsMounted(true)
    // Initialize branch in store if not set
    if (!selectedBranchId && visibleBranches.length > 0) {
      setSelectedBranchId(visibleBranches[0].id)
    }
  }, [selectedBranchId, visibleBranches, setSelectedBranchId])

  if (!isMounted) {
    return (
      <div className={className ?? 'w-[200px] h-10 rounded-md border bg-transparent opacity-50'} />
    )
  }

  const effectiveValue = selectedBranchId ?? (visibleBranches[0]?.id ?? '')

  // Hide selector if only 1 visible branch (or none)
  if (visibleBranches.length <= 1) return null

  return (
    <Select value={effectiveValue} onValueChange={setSelectedBranchId}>
      <SelectTrigger className={className ?? 'w-[200px]'}>
        <SelectValue placeholder="Seleccionar sucursal" />
      </SelectTrigger>
      <SelectContent>
        {visibleBranches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
