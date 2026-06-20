import { ipcMain } from 'electron'
import type { DrCr } from '../data/schema'
import {
  createAccount,
  createPerson,
  listAccounts,
  listPersons,
  listSubgroups,
  setDefaulter,
  setOpeningBalance,
  type AccountInput,
  type AccountListFilter,
  type PersonInput
} from '../services/accounts'
import { getAccountLedger } from '../services/ledger'
import { requireSession } from '../session'

/** Account Manager IPC — year + accountant are injected from the session, never trusted from UI. */
export function registerAccountsIpc(): void {
  ipcMain.handle('accounts:subgroups', () => listSubgroups())
  ipcMain.handle('accounts:list', (_e, filter?: AccountListFilter) =>
    listAccounts(requireSession().yearId, filter)
  )
  ipcMain.handle('accounts:create', (_e, input: AccountInput) => createAccount(input))
  ipcMain.handle('accounts:ledger', (_e, accountId: number) =>
    getAccountLedger(accountId, requireSession().yearId)
  )
  ipcMain.handle(
    'accounts:setOpening',
    (_e, accountId: number, amountPaise: number, drCr: DrCr, date: string) => {
      const s = requireSession()
      setOpeningBalance(accountId, s.yearId, amountPaise, drCr, date, s.userId)
    }
  )
  ipcMain.handle('accounts:setDefaulter', (_e, accountId: number, isDefaulter: boolean) =>
    setDefaulter(accountId, isDefaulter, requireSession().userId)
  )
  ipcMain.handle('persons:create', (_e, input: PersonInput) => createPerson(input))
  ipcMain.handle('persons:list', (_e, search?: string) => listPersons(search))
}
