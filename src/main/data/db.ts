import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

let _db: BetterSQLite3Database<typeof schema> | null = null
let _sqlite: Database.Database | null = null

export function getDbPath(): string {
  return join(app.getPath('userData'), 'paritosh.db')
}

/** Open the single SQLite file, set pragmas, and (Phase 0) ensure the smoke-test table. */
export function initDb(): BetterSQLite3Database<typeof schema> {
  if (_db) return _db
  _sqlite = new Database(getDbPath())
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('foreign_keys = ON')
  // Phase 0: a tiny table to prove the DB round-trip. Real schema + migrations land in Phase 1.
  _sqlite.exec(
    'CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
  )
  _db = drizzle(_sqlite, { schema })
  return _db
}

export function db(): BetterSQLite3Database<typeof schema> {
  if (!_db) throw new Error('DB not initialized — call initDb() first')
  return _db
}

export function rawSqlite(): Database.Database {
  if (!_sqlite) throw new Error('DB not initialized — call initDb() first')
  return _sqlite
}
