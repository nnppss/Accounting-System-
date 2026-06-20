import { ipcMain } from 'electron'
import { rawSqlite } from '../data/db'

/** Register all IPC handlers (the typed API surface the renderer calls). */
export function registerIpc(): void {
  // Foundation smoke test: read the seeded reference data through the migrated schema,
  // proving openDb → migrate → seed worked end to end. Replaced by real module handlers
  // (accounts, vouchers, …) as Phase 1 progresses.
  ipcMain.handle('ping', () => {
    const sq = rawSqlite()
    const row = sq.prepare('SELECT count(*) AS n FROM subgroup').get() as { n: number }
    return { ok: true, stored: `${row.n} subgroups`, at: new Date().toISOString() }
  })
}
