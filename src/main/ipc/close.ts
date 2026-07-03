import { ipcMain } from 'electron'
import { backupNow } from '../backup'
import { closeYear, getCloseStatus, previewClose, rollbackClose } from '../engines/close-year'
import { verifyPassword } from '../auth/auth'
import { requireSession } from '../session'

/**
 * Phase 6 IPC — Year-end Close. `preview`/`status` are read-only; `run`/`rollback` are
 * **password-gated**: the accountant re-enters their login password and it is verified against the
 * session user before the engine writes anything (software.md §3.13 "password-gated").
 */
export function registerCloseIpc(): void {
  ipcMain.handle('close:preview', () => previewClose(requireSession().yearId))
  ipcMain.handle('close:status', () => getCloseStatus(requireSession().yearId))
  ipcMain.handle('close:run', (_e, password: string) => {
    const s = requireSession()
    if (!verifyPassword(s.userId, password)) throw new Error('Incorrect password')
    // Pre-close file snapshot (software.md §5) on top of the engine's logical rollback plan.
    // Strict: if the backup folder is gone/unwritable the close does not run.
    if (backupNow('pre-close') === null) {
      throw new Error('Backup folder is not set — configure it on the Backup page first')
    }
    return closeYear(s.yearId, s.userId)
  })
  ipcMain.handle('close:rollback', (_e, password: string) => {
    const s = requireSession()
    if (!verifyPassword(s.userId, password)) throw new Error('Incorrect password')
    return rollbackClose(s.yearId, s.userId)
  })
}
