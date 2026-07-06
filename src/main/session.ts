import { eq } from 'drizzle-orm'
import type { Session } from './auth/auth'
import { db } from './data/db'
import { financialYear } from './data/schema'

/**
 * The single-user working session, held in the main process for the app's lifetime. Set on
 * login; the IPC handlers read the working-year id and accountant id from here so the renderer
 * never has to pass them (and can't forge them). Services stay pure — handlers inject these.
 */
let current: Session | null = null

export function setSession(session: Session): void {
  current = session
}

export function clearSession(): void {
  current = null
}

export function getSession(): Session | null {
  return current
}

/** For handlers that require a logged-in user; throws otherwise. */
export function requireSession(): Session {
  if (!current) throw new Error('Not logged in')
  return current
}

/**
 * For handlers that WRITE into the working year: a closed year is read-only, so any correction
 * must go through Year-end Close → Undo (which reopens it) rather than silently desyncing the
 * carry-forwards computed at close time.
 */
export function requireOpenYear(): Session {
  const s = requireSession()
  const yr = db()
    .select({ status: financialYear.status })
    .from(financialYear)
    .where(eq(financialYear.id, s.yearId))
    .get()
  if (yr?.status === 'closed') {
    throw new Error(`Year ${s.year} is closed — undo its close (Year-end Close page) to make changes`)
  }
  return s
}
