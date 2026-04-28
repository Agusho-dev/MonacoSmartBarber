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

const ALL_BRANCHES_VALUE = '__all__'

interface Props {
  branches: Branch[]
  className?: string
  allowAll?: boolean
}

export function BranchSelector({ branches, className, allowAll }: Props) {
  const { selectedBranchId, setSelectedBranchId, allowedBranchIds } = useBranchStore()

  const [isMounted, setIsMounted] = useState(false)

  // Filter branches by allowed scope
  const visibleBranches = allowedBranchIds
    ? branches.filter((b) => allowedBranchIds.includes(b.id))
    : branches

  useEffect(() => {
    setIsMounted(true)
    console.log('[debug-branch][BranchSelector] mount', {
      branchesIn: branches.length,
      allowedBranchIds,
      visibleCount: visibleBranches.length,
      allowAll,
    })
    // Initialize branch in store if not set (skip when allowAll — null means "todas")
    if (!allowAll && !selectedBranchId && visibleBranches.length > 0) {
      setSelectedBranchId(visibleBranches[0].id)
    }
  }, [allowAll, selectedBranchId, visibleBranches, setSelectedBranchId, branches.length, allowedBranchIds])

  if (!isMounted) {
    return (
      <div className={className ?? 'w-[200px] h-10 rounded-md border bg-transparent opacity-50'} />
    )
  }

  // Hide selector if only 1 visible branch (or none) and allowAll is not set
  if (!allowAll && visibleBranches.length <= 1) {
    console.log('[debug-branch][BranchSelector] hidden', { branchesIn: branches.length, visibleCount: visibleBranches.length, allowedBranchIds })
    return null
  }

  const effectiveValue = allowAll
    ? (selectedBranchId ?? ALL_BRANCHES_VALUE)
    : (selectedBranchId ?? (visibleBranches[0]?.id ?? ''))

  function handleChange(value: string) {
    setSelectedBranchId(value === ALL_BRANCHES_VALUE ? null : value)
  }

  return (
    <Select value={effectiveValue} onValueChange={handleChange}>
      <SelectTrigger className={className ?? 'w-[200px]'}>
        <SelectValue placeholder="Seleccionar sucursal" />
      </SelectTrigger>
      <SelectContent>
        {allowAll && (
          <SelectItem value={ALL_BRANCHES_VALUE}>Todas las sucursales</SelectItem>
        )}
        {visibleBranches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
