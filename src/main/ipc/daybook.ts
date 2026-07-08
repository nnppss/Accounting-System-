import { ipcMain } from 'electron'
import { getDayBook } from '../services/daybook'
import { requireSession } from '../session'

export function registerDayBookIpc(): void {
  ipcMain.handle('daybook:get', (_e, date: string) => getDayBook(requireSession().yearId, date))
}
