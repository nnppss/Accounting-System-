import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { setupDb } from '../test-utils'
import { changePassword, createUser, createYear, ensureBootstrap, listYears, login } from './auth'

beforeEach(() => setupDb())
afterEach(() => closeDb())

describe('auth', () => {
  it('logs in with a valid year + username + password', () => {
    createYear(2026, 15000)
    createUser('seema', 'secret123', 'Seema Accountant')
    const session = login(2026, 'seema', 'secret123')
    expect(session.accountantName).toBe('Seema Accountant')
    expect(session.year).toBe(2026)
    expect(session.yearId).toBeGreaterThan(0)
  })

  it('rejects a wrong password', () => {
    createYear(2026)
    createUser('seema', 'secret123', 'Seema')
    expect(() => login(2026, 'seema', 'wrong')).toThrow(/invalid/i)
  })

  it('rejects an unknown year', () => {
    createUser('seema', 'secret123', 'Seema')
    expect(() => login(2099, 'seema', 'secret123')).toThrow(/year/i)
  })

  it('refuses a duplicate year', () => {
    createYear(2026)
    expect(() => createYear(2026)).toThrow(/already exists/i)
  })

  it('bootstraps a default admin + current year when empty', () => {
    ensureBootstrap(2026)
    expect(listYears().map((y) => y.year)).toContain(2026)
    expect(login(2026, 'admin', 'admin123').role).toBe('admin')
  })

  it('flags the seeded default password so the UI can nudge a change', () => {
    ensureBootstrap(2026)
    expect(login(2026, 'admin', 'admin123').mustChangePassword).toBe(true)
  })

  it('changes a password and clears the default-password flag', () => {
    createYear(2026)
    const id = createUser('admin', 'admin123', 'Administrator', 'admin')
    expect(login(2026, 'admin', 'admin123').mustChangePassword).toBe(true)

    changePassword(id, 'admin123', 'fresh-secret')
    expect(() => login(2026, 'admin', 'admin123')).toThrow(/invalid/i)
    const session = login(2026, 'admin', 'fresh-secret')
    expect(session.mustChangePassword).toBeFalsy()
  })

  it('rejects a password change with the wrong current password, too-short or unchanged', () => {
    createYear(2026)
    const id = createUser('seema', 'secret123', 'Seema')
    expect(() => changePassword(id, 'wrong', 'newsecret')).toThrow(/current password/i)
    expect(() => changePassword(id, 'secret123', 'short')).toThrow(/6 characters/i)
    expect(() => changePassword(id, 'secret123', 'secret123')).toThrow(/different/i)
  })
})
