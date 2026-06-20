import { ipcMain } from 'electron'
import { createYear, listYears, login } from '../auth/auth'
import { clearSession, getSession, setSession } from '../session'

/** Auth IPC — login stores the session in the main process (see session.ts). */
export function registerAuthIpc(): void {
  ipcMain.handle('auth:listYears', () => listYears())
  ipcMain.handle('auth:createYear', (_e, year: number, rentRatePaise: number) =>
    createYear(year, rentRatePaise)
  )
  ipcMain.handle('auth:login', (_e, year: number, username: string, password: string) => {
    const session = login(year, username, password)
    setSession(session)
    return session
  })
  ipcMain.handle('auth:logout', () => clearSession())
  ipcMain.handle('auth:session', () => getSession())
}
