import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { setupDb } from '../test-utils'
import { createUser, createYear, ensureBootstrap, listYears, login } from './auth'

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
})
