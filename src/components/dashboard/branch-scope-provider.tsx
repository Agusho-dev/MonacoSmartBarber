'use client'

import { useEffect } from 'react'
import { useBranchStore } from '@/stores/branch-store'

interface BranchScopeProviderProps {
  allowedBranchIds: string[] | null
  children: React.ReactNode
}

/**
 * Initializes the branch store with the user's allowed branches on mount.
 * - null = unrestricted (owner/admin)
 * - string[] = only those branches are accessible
 */
export function BranchScopeProvider({ allowedBranchIds, children }: BranchScopeProviderProps) {
  const { setAllowedBranchIds, setSelectedBranchId, selectedBranchId } = useBranchStore()

  useEffect(() => {
    setAllowedBranchIds(allowedBranchIds)

    // If restricted and current selection is not allowed, force to first allowed branch
    if (allowedBranchIds && allowedBranchIds.length > 0) {
      if (!selectedBranchId || !allowedBranchIds.includes(selectedBranchId)) {
        setSelectedBranchId(allowedBranchIds[0])
      }
    }
  }, [allowedBranchIds, selectedBranchId, setAllowedBranchIds, setSelectedBranchId])

  return <>{children}</>
}
