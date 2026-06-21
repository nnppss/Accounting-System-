import { create } from 'zustand'
import type { AccountType } from '@shared/enums'

/**
 * Accounts Master filter state, kept in a store (not page-local state) so it survives leaving the
 * list to open an account's ledger and coming back. The back arrow lands on the same filtered list;
 * only an explicit Close (✕) resets this and returns to the blank starting screen.
 */
export type AccountFilters = { name: string; villageCity: string; state: string; phone: string }
export const EMPTY_FILTERS: AccountFilters = { name: '', villageCity: '', state: '', phone: '' }

interface AccountsFilterState {
  type: AccountType | undefined
  filters: AccountFilters
  includeSystem: boolean
  setType: (t: AccountType | undefined) => void
  setFilters: (f: AccountFilters) => void
  setIncludeSystem: (v: boolean) => void
  reset: () => void
}

export const useAccountsFilter = create<AccountsFilterState>((set) => ({
  type: undefined,
  filters: EMPTY_FILTERS,
  includeSystem: false,
  setType: (type) => set({ type }),
  setFilters: (filters) => set({ filters }),
  setIncludeSystem: (includeSystem) => set({ includeSystem }),
  reset: () => set({ type: undefined, filters: EMPTY_FILTERS, includeSystem: false })
}))
