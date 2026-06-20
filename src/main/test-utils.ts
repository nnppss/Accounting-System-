import { join } from 'path'
import { eq } from 'drizzle-orm'
import { closeDb, db, migrate, openDb } from './data/db'
import { seedReferenceData } from './data/seed'
import { subgroup, type AccountType } from './data/schema'
import { createYear } from './auth/auth'
import { createAccount } from './services/accounts'

/**
 * Test scaffolding (not a test file). Spins up a fresh in-memory DB — migrated + seeded —
 * under the Node ABI (gotcha §4.1). Tests call `setupDb()` in beforeEach and `closeDb()` in
 * afterEach. Never touches the app's real .db file.
 */

const MIGRATIONS = join(process.cwd(), 'drizzle')

export function setupDb(): void {
  closeDb()
  openDb(':memory:')
  migrate(MIGRATIONS)
  seedReferenceData()
}

/** Resolve a seeded subgroup id by name. */
export function groupId(name: string): number {
  const row = db().select({ id: subgroup.id }).from(subgroup).where(eq(subgroup.name, name)).get()
  if (!row) throw new Error(`subgroup '${name}' not found`)
  return row.id
}

/** Create a party account in a named subgroup; returns its id. */
export function makeAccount(name: string, type: AccountType, subgroupName: string): number {
  return createAccount({ name, type, subgroupId: groupId(subgroupName) })
}

/** Create a financial year and return its id. */
export function makeYear(year = 2026, rentRatePaise = 0): number {
  return createYear(year, rentRatePaise)
}
