import { ipcMain } from 'electron'
import { changePassword, createYear, listYears, login } from '../auth/auth'
import { clearSession, getSession, requireSession, setSession } from '../session'

/** Auth IPC — login stores the session in the main process (see session.ts). */
export function registerAuthIpc(): void {
  ipcMain.handle('auth:listYears', () => listYears())
  ipcMain.handle('auth:createYear', (_e, year: number, rentRatePaise: number) =>
    createYear(year, rentRatePaise)
  )
  ipcMain.handle(
    'auth:login',
    (_e, year: number, username: string, password: string, accountantName?: string) => {
      const session = login(year, username, password, accountantName)
      setSession(session)
      return session
    }
  )
  ipcMain.handle('auth:logout', () => clearSession())
  ipcMain.handle('auth:session', () => getSession())
  // Change the logged-in user's own password (current password re-verified in the service).
  // On success the session's stale `mustChangePassword` flag is cleared.
  ipcMain.handle('auth:changePassword', (_e, currentPassword: string, newPassword: string) => {
    const s = requireSession()
    changePassword(s.userId, currentPassword, newPassword)
    setSession({ ...s, mustChangePassword: false })
  })
}
