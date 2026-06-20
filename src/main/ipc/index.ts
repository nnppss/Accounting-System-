import { ipcMain } from 'electron'
import { rawSqlite } from '../data/db'

/** Register all IPC handlers (the typed API surface the renderer calls). */
export function registerIpc(): void {
  // Phase 0 proof: write + read a value through SQLite, end to end.
  ipcMain.handle('ping', (_e, msg: string) => {
    const sq = rawSqlite()
    sq.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(
      'last_ping',
      msg
    )
    const row = sq.prepare('SELECT value FROM app_meta WHERE key = ?').get('last_ping') as {
      value: string
    }
    return { ok: true, stored: row.value, at: new Date().toISOString() }
  })
}
