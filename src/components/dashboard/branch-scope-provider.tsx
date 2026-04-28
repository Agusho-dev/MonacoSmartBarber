'use client'

import { useEffect } from 'react'
import { useBranchStore } from '@/stores/branch-store'

interface BranchScopeProviderProps {
  allowedBranchIds: string[] | null
  organizationId: string | null
  children: React.ReactNode
}

/**
 * Inicializa el store de sucursales con las sucursales permitidas del usuario al montar.
 * - null = sin restricción (owner/admin)
 * - string[] = solo esas sucursales son accesibles
 */
export function BranchScopeProvider({ allowedBranchIds, organizationId, children }: BranchScopeProviderProps) {
  const { setAllowedBranchIds, setSelectedBranchId, setOrganizationId, selectedBranchId } = useBranchStore()

  useEffect(() => {
    console.log('[debug-branch][BranchScopeProvider] effect', {
      organizationId,
      allowedBranchIds,
      allowedKind: allowedBranchIds === null ? 'null (full)' : `array(${allowedBranchIds.length})`,
    })
    setOrganizationId(organizationId)
    setAllowedBranchIds(allowedBranchIds)

    // Si está restringido y la selección actual no está permitida, forzar a la primera sucursal permitida
    if (allowedBranchIds && allowedBranchIds.length > 0) {
      if (!selectedBranchId || !allowedBranchIds.includes(selectedBranchId)) {
        setSelectedBranchId(allowedBranchIds[0])
      }
    }
  }, [allowedBranchIds, organizationId, selectedBranchId, setAllowedBranchIds, setOrganizationId, setSelectedBranchId])

  return <>{children}</>
}
