import { ipcMain } from 'electron'
import { getTrialBalance } from '../services/ledger'
import { requireSession } from '../session'

export function registerLedgerIpc(): void {
  ipcMain.handle('ledger:trialBalance', () => getTrialBalance(requireSession().yearId))
}
