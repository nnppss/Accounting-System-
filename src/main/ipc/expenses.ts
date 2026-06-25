import { ipcMain } from 'electron'
import type {
  BardanaInput,
  ExpensePaymentInput,
  LoadingContractorYearInput
} from '../../shared/contracts'
import type { BardanaDirection } from '../../shared/enums'
import { createBardana, deleteBardana, getBardanaAccount, listBardana } from '../services/bardana'
import {
  listLoadingContractorYears,
  listLoadingRegister,
  listSalaryRegister,
  payLoadingContractor,
  paySalary,
  setLoadingContractorYear
} from '../services/expenses'
import { requireSession } from '../session'

/** Phase 4 IPC — Bardana sub-ledger + staff salary / loading-contractor expenses. */
export function registerExpensesIpc(): void {
  // Bardana
  ipcMain.handle('bardana:create', (_e, input: BardanaInput) => {
    const s = requireSession()
    return createBardana(s.yearId, input, s.userId)
  })
  ipcMain.handle('bardana:list', (_e, direction?: BardanaDirection) =>
    listBardana(requireSession().yearId, direction)
  )
  ipcMain.handle('bardana:account', () => getBardanaAccount(requireSession().yearId))
  ipcMain.handle('bardana:delete', (_e, id: number) => {
    const s = requireSession()
    return deleteBardana(s.yearId, id, s.userId)
  })

  // Staff salaries
  ipcMain.handle('expenses:paySalary', (_e, input: ExpensePaymentInput) => {
    const s = requireSession()
    return paySalary(s.yearId, input, s.userId)
  })
  ipcMain.handle('expenses:salaryRegister', () => listSalaryRegister(requireSession().yearId))

  // Loading contractor
  ipcMain.handle('expenses:payLoading', (_e, input: ExpensePaymentInput) => {
    const s = requireSession()
    return payLoadingContractor(s.yearId, input, s.userId)
  })
  ipcMain.handle('expenses:loadingRegister', () => listLoadingRegister(requireSession().yearId))
  ipcMain.handle('expenses:loadingYears', () => listLoadingContractorYears(requireSession().yearId))
  ipcMain.handle('expenses:setLoadingYear', (_e, input: LoadingContractorYearInput) => {
    const s = requireSession()
    return setLoadingContractorYear(s.yearId, input, s.userId)
  })
}
