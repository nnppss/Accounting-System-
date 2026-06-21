import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, db, migrate, openDb, rawSqlite } from './db'
import { seedReferenceData, SUBGROUP_SEED } from './seed'
import { subgroup } from './schema'

const MIGRATIONS = join(process.cwd(), 'drizzle')

/** Fresh in-memory DB, migrated + seeded — runs under the Node ABI (Vitest). */
function freshDb(): void {
  closeDb()
  openDb(':memory:')
  migrate(MIGRATIONS)
  seedReferenceData()
}

afterEach(() => closeDb())

describe('db foundation', () => {
  it('migrates the full schema (21 tables across Phase 1 + 2 + 3 + 4)', () => {
    freshDb()
    const rows = rawSqlite()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'"
      )
      .all() as { name: string }[]
    const names = rows.map((r) => r.name)
    expect(names).toContain('voucher')
    expect(names).toContain('voucher_entry')
    expect(names).toContain('account')
    expect(names).toContain('aamad')
    expect(names).toContain('nikasi')
    expect(names).toContain('sauda')
    expect(names).toContain('loan')
    expect(names).toContain('loan_event')
    expect(names).toContain('bardana')
    expect(names).toHaveLength(21)
  })

  it('seeds the 9 subgroups, idempotently', () => {
    freshDb()
    seedReferenceData() // a second call must not duplicate
    const rows = db().select().from(subgroup).all()
    expect(rows).toHaveLength(9)
    expect(rows).toHaveLength(SUBGROUP_SEED.length)
  })

  it('enforces foreign keys (pragma on)', () => {
    freshDb()
    expect(() =>
      rawSqlite()
        .prepare('INSERT INTO account (name, type, subgroup_id) VALUES (?, ?, ?)')
        .run('Ghost', 'kisan', 9999)
    ).toThrow()
  })
})
