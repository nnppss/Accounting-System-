import { rawSqlite } from '../data/db'
import { dbPath, settingsPath } from '../paths'
import type { BackupFileRow, BackupReason } from '../../shared/contracts'
import { listBackups, readBackupDir, runBackup, writeBackupDir } from './backup'

/** Electron-aware face of the backup module: resolves the real paths and the live DB handle. */

export function getBackupDir(): string | null {
  return readBackupDir(settingsPath())
}

/** First-run setup / later change: persist the folder and immediately take a `setup` backup —
 * which both seeds the folder and proves it is writable before the choice is accepted. A `setup`
 * reason is never deduped, so this always returns a real file name. */
export function setBackupDir(dir: string): string {
  const name = runBackup(rawSqlite(), dbPath(), dir, 'setup')!
  writeBackupDir(settingsPath(), dir)
  return name
}

/** Back up now if a folder is configured; null (silently) before first-run setup. */
export function backupNow(reason: BackupReason): string | null {
  const dir = getBackupDir()
  if (!dir) return null
  return runBackup(rawSqlite(), dbPath(), dir, reason)
}

export function listBackupFiles(): BackupFileRow[] {
  const dir = getBackupDir()
  return dir ? listBackups(dir) : []
}
