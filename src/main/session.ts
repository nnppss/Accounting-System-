import type { Session } from './auth/auth'

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
