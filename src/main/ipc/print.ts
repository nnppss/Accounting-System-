import { ipcMain } from 'electron'
import type {
  AamadListRow,
  BardanaRow,
  ExpenseRow,
  LoanRow,
  NikasiListRow,
  PartyRow,
  SaudaListRow
} from '../../shared/contracts'
import {
  printAamadReceipt,
  printAamadRegister,
  printBardana,
  printBill,
  printDayBook,
  printExpenseRegister,
  printFinancials,
  printGatePass,
  printLedger,
  printLoanRegister,
  printLoanStatement,
  printMoneyBookDetail,
  printMoneyBookSummary,
  printNikasiRegister,
  printParty,
  printSaudaRegister,
  printTrialBalance,
  printVoucher
} from '../printing/print'
import { requireSession } from '../session'

/**
 * Phase 6 IPC — printing the five core documents to PDF (gate pass, bill, voucher, ledger, trial
 * balance). Each returns a `PrintResult` ({ path } or { path: null } if the user cancels the save
 * dialog). yearId/year come from the session.
 */
export function registerPrintIpc(): void {
  ipcMain.handle('print:gatePass', (_e, nikasiId: number) => {
    requireSession()
    return printGatePass(nikasiId)
  })
  ipcMain.handle('print:bill', (_e, accountId: number, asOf?: string) =>
    printBill(accountId, requireSession().yearId, asOf)
  )
  ipcMain.handle('print:voucher', (_e, voucherId: number) => {
    requireSession()
    return printVoucher(voucherId)
  })
  ipcMain.handle('print:ledger', (_e, accountId: number) =>
    printLedger(accountId, requireSession().yearId)
  )
  ipcMain.handle('print:trialBalance', () => {
    const s = requireSession()
    return printTrialBalance(s.yearId, s.year)
  })

  ipcMain.handle('print:moneyBookSummary', (_e, accountId: number) => {
    const s = requireSession()
    return printMoneyBookSummary(accountId, s.yearId, s.year)
  })
  ipcMain.handle('print:moneyBookDetail', (_e, accountId: number, month: number) => {
    const s = requireSession()
    return printMoneyBookDetail(accountId, month, s.yearId, s.year)
  })
  ipcMain.handle('print:dayBook', (_e, date: string) => printDayBook(date, requireSession().yearId))
  ipcMain.handle('print:financials', () => {
    const s = requireSession()
    return printFinancials(s.yearId, s.year)
  })
  ipcMain.handle('print:aamadReceipt', (_e, aamadId: number) => {
    requireSession()
    return printAamadReceipt(aamadId)
  })
  ipcMain.handle('print:loanStatement', (_e, loanId: number) => {
    requireSession()
    return printLoanStatement(loanId)
  })

  // Filter-aware registers — the renderer passes the rows it currently shows.
  ipcMain.handle('print:aamadRegister', (_e, subtitle: string, rows: AamadListRow[]) => {
    requireSession()
    return printAamadRegister(subtitle, rows)
  })
  ipcMain.handle('print:saudaRegister', (_e, rows: SaudaListRow[]) => {
    requireSession()
    return printSaudaRegister(rows)
  })
  ipcMain.handle('print:nikasiRegister', (_e, subtitle: string, rows: NikasiListRow[]) => {
    requireSession()
    return printNikasiRegister(subtitle, rows)
  })
  ipcMain.handle(
    'print:expenseRegister',
    (_e, subtitle: string, rows: Array<ExpenseRow & { kind: 'salary' | 'loading' }>) => {
      requireSession()
      return printExpenseRegister(subtitle, rows)
    }
  )
  ipcMain.handle('print:bardana', (_e, subtitle: string, rows: BardanaRow[]) =>
    printBardana(subtitle, rows, requireSession().yearId)
  )
  ipcMain.handle('print:loanRegister', (_e, rows: LoanRow[]) => {
    requireSession()
    return printLoanRegister(rows)
  })
  ipcMain.handle('print:party', (_e, subtitle: string, rows: PartyRow[]) => {
    requireSession()
    return printParty(subtitle, rows)
  })
}
