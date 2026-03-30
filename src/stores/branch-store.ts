import { create } from 'zustand'

interface BranchStore {
  organizationId: string | null
  selectedBranchId: string | null
  allowedBranchIds: string[] | null // null = sin restricción (owner/admin)
  setOrganizationId: (id: string | null) => void
  setSelectedBranchId: (id: string | null) => void
  setAllowedBranchIds: (ids: string[] | null) => void
}

export const useBranchStore = create<BranchStore>((set, get) => ({
  organizationId: null,
  selectedBranchId: null,
  allowedBranchIds: null,
  setOrganizationId: (id) => set({ organizationId: id }),
  setSelectedBranchId: (id) => {
    const { allowedBranchIds } = get()
    // Si está restringido y la sucursal solicitada no está permitida, ignorar
    if (id && allowedBranchIds && !allowedBranchIds.includes(id)) return
    set({ selectedBranchId: id })
  },
  setAllowedBranchIds: (ids) => set({ allowedBranchIds: ids }),
}))
