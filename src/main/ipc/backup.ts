import { dialog, ipcMain, shell } from 'electron'
import { backupNow, getBackupDir, listBackupFiles, setBackupDir } from '../backup'
import { defaultBackupDir } from '../paths'
import type { BackupSettings } from '../../shared/contracts'

/**
 * Backup IPC. `settings`/`chooseDir`/`setDir` are reachable **before login** — the first-run
 * setup screen sits in front of the login page, so none of these require a session.
 * `setDir` proves the folder is writable by taking a backup into it before accepting it.
 */
export function registerBackupIpc(): void {
  ipcMain.handle(
    'backup:settings',
    (): BackupSettings => ({ backupDir: getBackupDir(), defaultDir: defaultBackupDir() })
  )
  ipcMain.handle('backup:chooseDir', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Choose backup folder',
      defaultPath: getBackupDir() ?? defaultBackupDir(),
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('backup:setDir', (_e, dir: string) => setBackupDir(dir))
  ipcMain.handle('backup:now', () => backupNow('manual'))
  ipcMain.handle('backup:list', () => listBackupFiles())
  ipcMain.handle('backup:openFolder', async () => {
    const dir = getBackupDir()
    if (dir) await shell.openPath(dir)
  })
}
