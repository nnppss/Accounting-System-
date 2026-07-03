import { app } from 'electron'
import { join } from 'path'

/** The single SQLite file lives in Electron's per-user data dir. */
export function dbPath(): string {
  return join(app.getPath('userData'), 'paritosh.db')
}

/** Generated migrations ship beside the app in prod (extraResources), at the repo root in dev. */
export function migrationsFolder(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : join(app.getAppPath(), 'drizzle')
}

/** App settings JSON (currently just the backup folder) — beside the DB, not inside it, so it
 * survives a database restore and is readable before the DB opens. */
export function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Suggested backup folder offered on first-run setup. */
export function defaultBackupDir(): string {
  return join(app.getPath('documents'), 'Paritosh Cold Backups')
}
