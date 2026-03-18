import { create } from 'zustand'

interface BranchStore {
  selectedBranchId: string | null
  allowedBranchIds: string[] | null // null = unrestricted (owner/admin)
  setSelectedBranchId: (id: string | null) => void
  setAllowedBranchIds: (ids: string[] | null) => void
}

export const useBranchStore = create<BranchStore>((set, get) => ({
  selectedBranchId: null,
  allowedBranchIds: null,
  setSelectedBranchId: (id) => {
    const { allowedBranchIds } = get()
    // If restricted and the requested branch is not allowed, ignore
    if (id && allowedBranchIds && !allowedBranchIds.includes(id)) return
    set({ selectedBranchId: id })
  },
  setAllowedBranchIds: (ids) => set({ allowedBranchIds: ids }),
}))
