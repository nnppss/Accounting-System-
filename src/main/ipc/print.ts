import { ipcMain } from 'electron'
import {
  printBill,
  printGatePass,
  printLedger,
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
}
