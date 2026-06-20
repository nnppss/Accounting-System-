import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

/**
 * The data layer is deliberately **Electron-free** so services/engines can be unit-tested
 * under the Node ABI (Vitest) with an in-memory DB. The Electron layer (main/index.ts)
 * resolves the real file path + migrations folder and calls these functions.
 */
export type Db = BetterSQLite3Database<typeof schema>

let _db: Db | null = null
let _sqlite: Database.Database | null = null

/** Open the single SQLite file (or ':memory:'), set WAL + foreign keys, return the Drizzle handle. */
export function openDb(path: string): Db {
  if (_db) return _db
  _sqlite = new Database(path)
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('foreign_keys = ON')
  _db = drizzle(_sqlite, { schema })
  return _db
}

/** Run all pending migrations from the given folder (the generated ./drizzle output). */
export function migrate(migrationsFolder: string): void {
  drizzleMigrate(db(), { migrationsFolder })
}

export function db(): Db {
  if (!_db) throw new Error('DB not initialized — call openDb(path) first')
  return _db
}

export function rawSqlite(): Database.Database {
  if (!_sqlite) throw new Error('DB not initialized — call openDb(path) first')
  return _sqlite
}

/** Close + reset the singleton (used by tests; the app keeps one connection for its lifetime). */
export function closeDb(): void {
  _sqlite?.close()
  _sqlite = null
  _db = null
}
