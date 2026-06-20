import { ipcMain } from 'electron'
import { getCashBankAccounts, getDetail, getSummary } from '../services/moneybook'
import { requireSession } from '../session'

export function registerMoneyBookIpc(): void {
  ipcMain.handle('moneybook:accounts', () => getCashBankAccounts())
  ipcMain.handle('moneybook:summary', (_e, accountId: number) =>
    getSummary(accountId, requireSession().yearId)
  )
  ipcMain.handle('moneybook:detail', (_e, accountId: number, month: number) =>
    getDetail(accountId, requireSession().yearId, month)
  )
}
