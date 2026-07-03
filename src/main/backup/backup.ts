import type Database from 'better-sqlite3'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import type { BackupFileRow, BackupReason } from '../../shared/contracts'

/**
 * File-level backups of the single SQLite database (architecture.md §8). The whole app is one
 * `.db` file, so a backup is a timestamped copy of it in the user-chosen backup folder — picked
 * on first launch and changeable from the Backup page. Copies are taken automatically on app
 * open and quit, before a year-end close, and on demand.
 *
 * Like the data layer this module is deliberately **Electron-free** (unit-tested under the Node
 * ABI); the Electron layer (backup/index.ts) resolves the real paths and passes them in.
 */

/** Routine open/quit copies are rolling — keep this many, prune older ones. Setup/manual/pre-close
 * backups are deliberate acts and are never pruned. */
const ROUTINE_KEEP = 30

const FILE_RE = /^paritosh-(\d{8})-(\d{6})(?:~\d+)?-(setup|open|quit|pre-close|manual)\.db$/

// ---------------------------------------------------------------- settings

/** Read the configured backup folder from the app settings JSON; null until first-run setup. */
export function readBackupDir(settingsPath: string): string | null {
  if (!existsSync(settingsPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as { backupDir?: unknown }
    return typeof parsed.backupDir === 'string' && parsed.backupDir !== '' ? parsed.backupDir : null
  } catch {
    return null
  }
}

/** Persist the backup folder, preserving any other settings the file may hold. */
export function writeBackupDir(settingsPath: string, dir: string): void {
  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
    } catch {
      /* corrupt settings file — rewrite it */
    }
  }
  settings['backupDir'] = dir
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}

// ---------------------------------------------------------------- backup

function stamp(d: Date): { date: string; time: string } {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return {
    date: `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`,
    time: `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  }
}

/**
 * Copy the live database into the backup folder as `paritosh-YYYYMMDD-HHMMSS-<reason>.db`.
 * The WAL is checkpointed into the main file first so a plain file copy is a complete,
 * openable database. Returns the backup's file name; throws if the folder can't be written.
 *
 * Routine open/quit copies are **skipped** (returns null) when the checkpointed database is
 * byte-identical to the newest backup already on disk — a view-only session where nothing
 * changed shouldn't churn out a redundant copy and push older restore points out of the
 * rolling window. Deliberate reasons (setup/manual/pre-close) always write.
 */
export function runBackup(
  sqlite: Database.Database,
  dbPath: string,
  backupDir: string,
  reason: BackupReason,
  now = new Date()
): string | null {
  mkdirSync(backupDir, { recursive: true })
  sqlite.pragma('wal_checkpoint(TRUNCATE)')

  if ((reason === 'open' || reason === 'quit') && sameAsNewest(dbPath, backupDir)) return null

  const { date, time } = stamp(now)
  let name = `paritosh-${date}-${time}-${reason}.db`
  for (let n = 2; existsSync(join(backupDir, name)); n++) {
    name = `paritosh-${date}-${time}~${n}-${reason}.db`
  }
  copyFileSync(dbPath, join(backupDir, name))

  pruneRoutine(backupDir)
  return name
}

/** True when the live db file is byte-for-byte the newest backup — i.e. nothing changed since. */
function sameAsNewest(dbPath: string, backupDir: string): boolean {
  const newest = listBackups(backupDir)[0]
  if (!newest) return false
  const live = readFileSync(dbPath)
  if (live.length !== newest.sizeBytes) return false
  return live.equals(readFileSync(join(backupDir, newest.fileName)))
}

/** Delete open/quit copies beyond the newest ROUTINE_KEEP. Other reasons are kept forever. */
function pruneRoutine(backupDir: string): void {
  const routine = listBackups(backupDir).filter((b) => b.reason === 'open' || b.reason === 'quit')
  for (const old of routine.slice(ROUTINE_KEEP)) {
    unlinkSync(join(backupDir, old.fileName))
  }
}

/** Every backup in the folder, newest first (for the Backup page's table). */
export function listBackups(backupDir: string): BackupFileRow[] {
  if (!existsSync(backupDir)) return []
  const rows: BackupFileRow[] = []
  for (const fileName of readdirSync(backupDir)) {
    const m = FILE_RE.exec(fileName)
    if (!m) continue
    const st = statSync(join(backupDir, fileName))
    rows.push({
      fileName,
      reason: m[3] as BackupReason,
      sizeBytes: st.size,
      modifiedAt: st.mtimeMs
    })
  }
  return rows.sort((a, b) => b.modifiedAt - a.modifiedAt || b.fileName.localeCompare(a.fileName))
}
