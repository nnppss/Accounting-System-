import bcrypt from 'bcryptjs'
import { desc, eq } from 'drizzle-orm'
import { db } from '../data/db'
import { financialYear, user } from '../data/schema'
import { writeAudit } from '../audit/audit'
import type { Session, YearInfo } from '../../shared/contracts'

/**
 * Auth + year-context (architecture.md §8). Login takes a year + username + password and
 * returns a session that carries the working-year id and the accountant name stamped onto
 * every voucher. Pure Node (bcryptjs is pure JS — no native rebuild, gotcha §4.5).
 */

const BCRYPT_ROUNDS = 10

export type { Session, YearInfo } from '../../shared/contracts'

export function createUser(
  username: string,
  password: string,
  accountantName: string,
  role = 'accountant'
): number {
  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS)
  const row = db()
    .insert(user)
    .values({ username, passwordHash, accountantName, role })
    .returning({ id: user.id })
    .get()
  writeAudit({ action: 'create', entity: 'user', entityId: row.id, after: { username, role } })
  return row.id
}

/**
 * Verify credentials against a known year; throws on any mismatch (no detail leaked to caller).
 * `accountantName` is the human actually working this session, entered at sign-in (architecture.md §8):
 * when given it is stamped on the session (and shown in the top bar); when blank we fall back to the
 * user's stored name so callers/tests that don't pass one keep working.
 */
export function login(
  year: number,
  username: string,
  password: string,
  accountantName?: string
): Session {
  const yr = db().select().from(financialYear).where(eq(financialYear.year, year)).get()
  if (!yr) throw new Error(`Financial year ${year} does not exist`)
  const u = db().select().from(user).where(eq(user.username, username)).get()
  if (!u || !bcrypt.compareSync(password, u.passwordHash)) {
    throw new Error('Invalid username or password')
  }
  return {
    userId: u.id,
    username: u.username,
    accountantName: accountantName?.trim() || u.accountantName,
    role: u.role,
    yearId: yr.id,
    year: yr.year
  }
}

/**
 * Verify a user's password — the gate for sensitive actions (the Year-end Close, Phase 6). Returns
 * false on any mismatch rather than throwing, so the caller can decide the message.
 */
export function verifyPassword(userId: number, password: string): boolean {
  const u = db().select().from(user).where(eq(user.id, userId)).get()
  if (!u) return false
  return bcrypt.compareSync(password, u.passwordHash)
}

export function createYear(year: number, rentRatePaise = 0): number {
  const existing = db().select().from(financialYear).where(eq(financialYear.year, year)).get()
  if (existing) throw new Error(`Financial year ${year} already exists`)
  const row = db()
    .insert(financialYear)
    .values({ year, rentRatePaise })
    .returning({ id: financialYear.id })
    .get()
  writeAudit({ action: 'create', entity: 'financial_year', entityId: row.id, after: { year } })
  return row.id
}

export function listYears(): YearInfo[] {
  return db()
    .select({
      id: financialYear.id,
      year: financialYear.year,
      status: financialYear.status,
      rentRatePaise: financialYear.rentRatePaise
    })
    .from(financialYear)
    .orderBy(desc(financialYear.year))
    .all()
}

/**
 * First-run bootstrap so the app is never locked out: seed a default admin and the current
 * calendar year if the tables are empty. The owner changes the password afterwards.
 */
export function ensureBootstrap(currentYear: number = new Date().getFullYear()): void {
  if (!db().select().from(user).get()) {
    createUser('admin', 'admin123', 'Administrator', 'admin')
  }
  if (!db().select().from(financialYear).get()) {
    createYear(currentYear)
  }
}
