import { create } from 'zustand'

interface BranchStore {
  selectedBranchId: string | null
  setSelectedBranchId: (id: string | null) => void
}

export const useBranchStore = create<BranchStore>((set) => ({
  selectedBranchId: null,
  setSelectedBranchId: (id) => set({ selectedBranchId: id }),
}))
