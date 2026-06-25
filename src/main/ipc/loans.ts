import { ipcMain } from 'electron'
import type { ChequeInput, LoanInput } from '../../shared/contracts'
import type { ChequeStatus } from '../../shared/enums'
import {
  createLoan,
  getLoan,
  getLoanComposition,
  listLoans,
  recordPayment
} from '../services/loans'
import { listCheques } from '../services/cheques'
import { bounceCheque, clearCheque, recordCheque } from '../engines/cheque-clearing'
import { requireSession } from '../session'

/** Phase 3 IPC — Loans + the interest engine, and the cheque-clearing lifecycle. */
export function registerLoansIpc(): void {
  // Loans
  ipcMain.handle('loans:create', (_e, input: LoanInput) => {
    const s = requireSession()
    return createLoan(s.yearId, input, s.userId)
  })
  ipcMain.handle('loans:list', (_e, asOf?: string) => listLoans(requireSession().yearId, asOf))
  ipcMain.handle('loans:get', (_e, loanId: number, asOf?: string) => getLoan(loanId, asOf))
  ipcMain.handle('loans:composition', (_e, loanId: number) => getLoanComposition(loanId))
  ipcMain.handle(
    'loans:pay',
    (_e, loanId: number, amountPaise: number, date: string, mode: 'cash' | 'bank', bankAccountId?: number) =>
      recordPayment(loanId, amountPaise, date, mode, bankAccountId, requireSession().userId)
  )

  // Cheques
  ipcMain.handle('cheques:record', (_e, input: ChequeInput) => {
    const s = requireSession()
    return recordCheque(s.yearId, input, s.userId)
  })
  ipcMain.handle('cheques:list', (_e, status?: ChequeStatus) =>
    listCheques(requireSession().yearId, status)
  )
  ipcMain.handle('cheques:clear', (_e, chequeId: number, clearanceDate: string) =>
    clearCheque(chequeId, clearanceDate, requireSession().userId)
  )
  ipcMain.handle('cheques:bounce', (_e, chequeId: number, date: string) =>
    bounceCheque(chequeId, date, requireSession().userId)
  )
}
