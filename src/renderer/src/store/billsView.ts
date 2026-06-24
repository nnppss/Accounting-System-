import { create } from 'zustand'

/**
 * Bills & Salaries view state, kept in a store (not page-local state) so it survives leaving the
 * list to open a bill / salary slip and coming back. The back arrow lands on the same tab and
 * search the user left — mirroring how Accounts Master keeps its filters (see accountsFilter).
 */
export type BillMode = 'bill' | 'salary'

interface BillsViewState {
  mode: BillMode
  search: string
  setMode: (m: BillMode) => void
  setSearch: (s: string) => void
}

export const useBillsView = create<BillsViewState>((set) => ({
  mode: 'bill',
  search: '',
  setMode: (mode) => set({ mode }),
  setSearch: (search) => set({ search })
}))
