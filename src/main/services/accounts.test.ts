import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { groupId, makeAccount, makeYear, setupDb } from '../test-utils'
import {
  createAccount,
  createPerson,
  listAccounts,
  setDefaulter,
  setOpeningBalance
} from './accounts'
import { getAccountBalance, getTrialBalance } from './ledger'

let yearId: number

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
})
afterEach(() => closeDb())

describe('Account Manager', () => {
  it('links an account to a person', () => {
    const personId = createPerson({ name: 'Ramesh', sonOf: 'Suresh', villageCity: 'Hapur' })
    const acctId = createAccount({ name: 'Ramesh (Kisan)', type: 'kisan', subgroupId: groupId('Farmer'), personId })
    const rows = listAccounts(yearId)
    const row = rows.find((r) => r.id === acctId)
    expect(row?.personName).toBe('Ramesh')
    expect(row?.type).toBe('kisan')
  })

  it('hides system accounts by default but can include them', () => {
    expect(listAccounts(yearId).some((r) => r.isSystem)).toBe(false)
    expect(listAccounts(yearId, { includeSystem: true }).some((r) => r.name === 'Cash')).toBe(true)
  })

  it('toggles the defaulter flag', () => {
    const acctId = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
    setDefaulter(acctId, true)
    expect(listAccounts(yearId).find((r) => r.id === acctId)?.isDefaulter).toBe(true)
  })

  it('posts an opening balance and keeps the trial balance net zero', () => {
    const kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
    setOpeningBalance(kisan, yearId, 250000, 'dr', '2026-01-01')
    expect(getAccountBalance(kisan, yearId)).toBe(250000)
    const tb = getTrialBalance(yearId)
    expect(tb.balanced).toBe(true)
    expect(listAccounts(yearId).find((r) => r.id === kisan)?.balancePaise).toBe(250000)
  })

  it('replaces (not doubles) an opening balance when re-entered', () => {
    const kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
    setOpeningBalance(kisan, yearId, 250000, 'dr', '2026-01-01')
    setOpeningBalance(kisan, yearId, 300000, 'dr', '2026-01-01')
    expect(getAccountBalance(kisan, yearId)).toBe(300000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })
})
