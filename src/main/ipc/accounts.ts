import { ipcMain } from 'electron'
import type { DrCr } from '../data/schema'
import {
  createAccount,
  createPerson,
  deleteAccount,
  deletePerson,
  getAccountDetail,
  listAccounts,
  listPersons,
  listPersonFieldValues,
  listSubgroups,
  setDefaulter,
  setOpeningBalance,
  updateAccountIdentity,
  type AccountInput,
  type AccountListFilter,
  type PersonInput
} from '../services/accounts'
import type { AccountIdentityInput } from '../../shared/contracts'
import { getAccountLedger } from '../services/ledger'
import { verifyPassword } from '../auth/auth'
import { requireSession } from '../session'

/** Account Manager IPC — year + accountant are injected from the session, never trusted from UI. */
export function registerAccountsIpc(): void {
  ipcMain.handle('accounts:subgroups', () => listSubgroups())
  ipcMain.handle('accounts:list', (_e, filter?: AccountListFilter) =>
    listAccounts(requireSession().yearId, filter)
  )
  // Create the account and, if an opening balance was supplied (setup time), record it atomically
  // for the session's working year before returning the new id.
  ipcMain.handle('accounts:create', (_e, input: AccountInput) => {
    const s = requireSession()
    const id = createAccount(input, s.year)
    if (input.opening) {
      setOpeningBalance(
        id,
        s.yearId,
        input.opening.amountPaise,
        input.opening.drCr,
        input.opening.date,
        s.userId
      )
    }
    return id
  })
  ipcMain.handle('accounts:detail', (_e, accountId: number) =>
    getAccountDetail(accountId, requireSession().yearId)
  )
  ipcMain.handle('accounts:updateIdentity', (_e, accountId: number, input: AccountIdentityInput) =>
    updateAccountIdentity(accountId, input, requireSession().userId)
  )
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
  // Destructive — password-gated like the Year-end Close: the accountant re-enters their login
  // password and it is verified against the session user before anything is deleted.
  ipcMain.handle('accounts:delete', (_e, accountId: number, password: string) => {
    const s = requireSession()
    if (!verifyPassword(s.userId, password)) throw new Error('Incorrect password')
    deleteAccount(accountId, s.userId)
  })
  ipcMain.handle('persons:create', (_e, input: PersonInput) => createPerson(input))
  ipcMain.handle('persons:list', (_e, search?: string) => listPersons(search))
  ipcMain.handle('persons:fieldValues', (_e, field: 'villageCity' | 'state' | 'sonOf') =>
    listPersonFieldValues(field)
  )
  ipcMain.handle('persons:delete', (_e, personId: number) =>
    deletePerson(personId, requireSession().userId)
  )
}
