import Database from 'better-sqlite3'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listBackups, readBackupDir, runBackup, writeBackupDir } from './backup'

/** Backups copy a real file, so unlike the service tests these use a temp dir, not ':memory:'. */

let work: string
let dbFile: string
let backupDir: string
let sqlite: Database.Database

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'paritosh-backup-test-'))
  dbFile = join(work, 'paritosh.db')
  backupDir = join(work, 'backups')
  sqlite = new Database(dbFile)
  sqlite.pragma('journal_mode = WAL')
  sqlite.exec(`CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('hello')`)
})

afterEach(() => {
  sqlite.close()
  rmSync(work, { recursive: true, force: true })
})

describe('settings', () => {
  it('round-trips the backup dir and returns null before setup', () => {
    const settings = join(work, 'settings.json')
    expect(readBackupDir(settings)).toBeNull()
    writeBackupDir(settings, backupDir)
    expect(readBackupDir(settings)).toBe(backupDir)
  })

  it('preserves unrelated settings keys and survives a corrupt file', () => {
    const settings = join(work, 'settings.json')
    writeFileSync(settings, '{"other": 42}')
    writeBackupDir(settings, backupDir)
    expect(JSON.parse(readFileSync(settings, 'utf8'))).toEqual({
      other: 42,
      backupDir
    })
    writeFileSync(settings, 'not-json')
    expect(readBackupDir(settings)).toBeNull()
    writeBackupDir(settings, backupDir) // rewrites the corrupt file instead of throwing
    expect(readBackupDir(settings)).toBe(backupDir)
  })
})

describe('runBackup', () => {
  it('creates the folder and a complete, openable copy (WAL flushed)', () => {
    // Row still sitting in the WAL — the checkpoint must fold it into the copied file.
    sqlite.prepare(`INSERT INTO t VALUES ('in-wal')`).run()
    const name = runBackup(sqlite, dbFile, backupDir, 'open')!
    expect(name).toMatch(/^paritosh-\d{8}-\d{6}-open\.db$/)

    const copy = new Database(join(backupDir, name), { readonly: true })
    const rows = copy.prepare('SELECT v FROM t ORDER BY v').all() as { v: string }[]
    copy.close()
    expect(rows.map((r) => r.v)).toEqual(['hello', 'in-wal'])
  })

  it('never overwrites: same-second backups get a ~n suffix', () => {
    const at = new Date('2026-07-02T14:30:55')
    const a = runBackup(sqlite, dbFile, backupDir, 'manual', at)!
    const b = runBackup(sqlite, dbFile, backupDir, 'manual', at)!
    expect(a).not.toBe(b)
    expect(existsSync(join(backupDir, a))).toBe(true)
    expect(existsSync(join(backupDir, b))).toBe(true)
  })

  it('prunes routine open/quit copies past 30 but keeps deliberate ones forever', () => {
    // 35 stale routine copies + 1 old pre-close snapshot, with staggered mtimes. Each copy
    // must differ or the dedup would skip it, so mutate the db every iteration.
    for (let i = 0; i < 35; i++) {
      sqlite.prepare(`INSERT INTO t VALUES (?)`).run(`row-${i}`)
      const name = runBackup(sqlite, dbFile, backupDir, i % 2 ? 'open' : 'quit', new Date(2026, 0, 1 + i))!
      utimesSync(join(backupDir, name), new Date(2026, 0, 1 + i), new Date(2026, 0, 1 + i))
    }
    const snapshot = runBackup(sqlite, dbFile, backupDir, 'pre-close', new Date(2025, 11, 31))!
    utimesSync(join(backupDir, snapshot), new Date(2025, 11, 31), new Date(2025, 11, 31))

    sqlite.prepare(`INSERT INTO t VALUES ('trigger')`).run()
    runBackup(sqlite, dbFile, backupDir, 'open') // triggers the prune

    const left = listBackups(backupDir)
    expect(left.filter((b) => b.reason === 'open' || b.reason === 'quit')).toHaveLength(30)
    // the oldest snapshot survives even though it predates everything
    expect(left.some((b) => b.fileName === snapshot)).toBe(true)
    // the survivors are the *newest* routine copies
    const oldestRoutine = left.filter((b) => b.reason !== 'pre-close').at(-1)
    expect(oldestRoutine?.modifiedAt).toBeGreaterThan(new Date(2026, 0, 5).getTime())
  })

  it('skips a routine backup when nothing changed, but still writes deliberate ones', () => {
    // First open backup writes; a view-only session that follows changes nothing.
    const first = runBackup(sqlite, dbFile, backupDir, 'open')
    expect(first).toMatch(/-open\.db$/)
    expect(runBackup(sqlite, dbFile, backupDir, 'quit')).toBeNull() // unchanged → skipped
    expect(runBackup(sqlite, dbFile, backupDir, 'open')).toBeNull() // still unchanged
    expect(listBackups(backupDir)).toHaveLength(1)

    // A deliberate manual backup is taken even when unchanged.
    expect(runBackup(sqlite, dbFile, backupDir, 'manual')).not.toBeNull()
    expect(listBackups(backupDir)).toHaveLength(2)

    // Once the data actually changes, the next routine backup writes again.
    sqlite.prepare(`INSERT INTO t VALUES ('changed')`).run()
    expect(runBackup(sqlite, dbFile, backupDir, 'quit')).not.toBeNull()
    expect(listBackups(backupDir)).toHaveLength(3)
  })
})

describe('listBackups', () => {
  it('returns [] for a missing folder and ignores foreign files', () => {
    expect(listBackups(join(work, 'nope'))).toEqual([])
    runBackup(sqlite, dbFile, backupDir, 'manual')
    writeFileSync(join(backupDir, 'notes.txt'), 'x')
    writeFileSync(join(backupDir, 'paritosh-junk.db'), 'x')
    expect(listBackups(backupDir)).toHaveLength(1)
    expect(readdirSync(backupDir)).toHaveLength(3)
  })

  it('reports reason, size and mtime, newest first', () => {
    const a = runBackup(sqlite, dbFile, backupDir, 'quit', new Date(2026, 5, 1))!
    utimesSync(join(backupDir, a), new Date(2026, 5, 1), new Date(2026, 5, 1))
    const b = runBackup(sqlite, dbFile, backupDir, 'pre-close', new Date(2026, 5, 2))!
    utimesSync(join(backupDir, b), new Date(2026, 5, 2), new Date(2026, 5, 2))

    const rows = listBackups(backupDir)
    expect(rows.map((r) => r.fileName)).toEqual([b, a])
    expect(rows[0].reason).toBe('pre-close')
    expect(rows[1].reason).toBe('quit')
    expect(rows[0].sizeBytes).toBeGreaterThan(0)
  })
})
