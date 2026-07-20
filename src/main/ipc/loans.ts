import { ipcMain } from 'electron'
import type { ChequeInput, LoanInput } from '../../shared/contracts'
import type { ChequeStatus } from '../../shared/enums'
import {
  createLoan,
  getLoan,
  getLoanComposition,
  listAccountInterest,
  listLoans,
  listPartyLoanEvents,
  recordPayment,
  undoPayment
} from '../services/loans'
import { listCheques } from '../services/cheques'
import { bounceCheque, clearCheque, recordCheque } from '../engines/cheque-clearing'
import { fixLoanInterest, fixPartyInterest } from '../engines/interest'
import { requireOpenYear, requireSession } from '../session'

/** Phase 3 IPC — Loans + the interest engine, and the cheque-clearing lifecycle. */
export function registerLoansIpc(): void {
  // Loans
  ipcMain.handle('loans:create', (_e, input: LoanInput) => {
    const s = requireOpenYear()
    return createLoan(s.yearId, input, s.userId)
  })
  ipcMain.handle('loans:list', (_e, asOf?: string) => listLoans(requireSession().yearId, asOf))
  ipcMain.handle('loans:get', (_e, loanId: number, asOf?: string) => getLoan(loanId, asOf))
  ipcMain.handle('loans:composition', (_e, loanId: number) => getLoanComposition(loanId))
  ipcMain.handle('loans:partyEvents', (_e, accountId: number) =>
    listPartyLoanEvents(accountId, requireSession().yearId)
  )
  ipcMain.handle(
    'loans:pay',
    (
      _e,
      loanId: number,
      amountPaise: number,
      date: string,
      mode: 'cash' | 'bank' | 'cheque',
      bankAccountId?: number,
      chequeNo?: string,
      chequeBank?: string
    ) =>
      recordPayment(
        loanId,
        amountPaise,
        date,
        mode,
        bankAccountId,
        requireOpenYear().userId,
        chequeNo ? { no: chequeNo, bank: chequeBank } : undefined
      )
  )
  ipcMain.handle('loans:undoPayment', (_e, eventId: number) =>
    undoPayment(eventId, requireOpenYear().userId)
  )
  // The interest sitting on a party's loans, and the accountant's override of it.
  ipcMain.handle('loans:accountInterest', (_e, accountId: number, asOf?: string) =>
    listAccountInterest(accountId, requireSession().yearId, asOf)
  )
  ipcMain.handle('loans:fixInterest', (_e, loanId: number, atDate: string, interestPaise: number) =>
    fixLoanInterest(loanId, atDate, interestPaise, requireOpenYear().userId)
  )
  // The party's whole interest as one agreed figure — what the Fix-interest screen calls.
  ipcMain.handle(
    'loans:fixPartyInterest',
    (_e, accountId: number, atDate: string, totalInterestPaise: number) => {
      const s = requireOpenYear()
      return fixPartyInterest(accountId, s.yearId, atDate, totalInterestPaise, s.userId)
    }
  )

  // Cheques
  ipcMain.handle('cheques:record', (_e, input: ChequeInput) => {
    const s = requireOpenYear()
    return recordCheque(s.yearId, input, s.userId)
  })
  ipcMain.handle('cheques:list', (_e, status?: ChequeStatus) =>
    listCheques(requireSession().yearId, status)
  )
  ipcMain.handle('cheques:clear', (_e, chequeId: number, clearanceDate: string) =>
    clearCheque(chequeId, clearanceDate, requireOpenYear().userId)
  )
  ipcMain.handle('cheques:bounce', (_e, chequeId: number, date: string) =>
    bounceCheque(chequeId, date, requireOpenYear().userId)
  )
}
