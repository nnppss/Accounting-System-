import { ipcMain } from 'electron'
import type { PartyCriteria } from '../../shared/contracts'
import { getBill, listBillSubjects } from '../services/bills'
import {
  deleteSavedFilter,
  listSavedFilters,
  saveFilter,
  searchParty
} from '../services/party'
import { requireSession } from '../session'

/** Phase 5 IPC — the read layers: Bills + Party search + saved presets. Posts nothing. */
export function registerViewsIpc(): void {
  // Bills
  ipcMain.handle('bills:subjects', (_e, asOf?: string) =>
    listBillSubjects(requireSession().yearId, asOf)
  )
  ipcMain.handle('bills:get', (_e, accountId: number, asOf?: string) =>
    getBill(accountId, requireSession().yearId, asOf)
  )

  // Party search
  ipcMain.handle('party:search', (_e, criteria?: PartyCriteria, asOf?: string) =>
    searchParty(requireSession().yearId, criteria ?? {}, asOf)
  )

  // Saved presets
  ipcMain.handle('party:savedFilters', () =>
    listSavedFilters('party', requireSession().userId)
  )
  ipcMain.handle('party:saveFilter', (_e, name: string, criteria: PartyCriteria) =>
    saveFilter('party', name, criteria, requireSession().userId)
  )
  ipcMain.handle('party:deleteFilter', (_e, id: number) => {
    requireSession()
    deleteSavedFilter(id)
  })
}
