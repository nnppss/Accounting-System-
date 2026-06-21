import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, db } from '../data/db'
import { account } from '../data/schema'
import { groupId, makeAccount, makeYear, setupDb } from '../test-utils'
import {
  backfillAccountCodes,
  createAccount,
  createPerson,
  deleteAccount,
  getAccountDetail,
  listAccounts,
  setDefaulter,
  setOpeningBalance,
  updateAccountIdentity
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

  it('filters accounts by linked person village, state and phone', () => {
    const personId = createPerson({
      name: 'Ramesh',
      villageCity: 'Hapur',
      state: 'UP',
      phone: '9876500000'
    })
    const acctId = createAccount({
      name: 'Ramesh (Kisan)',
      type: 'kisan',
      subgroupId: groupId('Farmer'),
      personId
    })
    expect(listAccounts(yearId, { name: 'Ramesh' }).map((r) => r.id)).toContain(acctId)
    expect(listAccounts(yearId, { villageCity: 'Hapur' }).map((r) => r.id)).toContain(acctId)
    expect(listAccounts(yearId, { state: 'UP' }).map((r) => r.id)).toContain(acctId)
    expect(listAccounts(yearId, { phone: '98765' }).map((r) => r.id)).toContain(acctId)
    expect(listAccounts(yearId, { villageCity: 'Nowhere' })).toHaveLength(0)
  })

  it('returns full account detail with person identity and opening flag', () => {
    const personId = createPerson({
      name: 'Ramesh',
      sonOf: 'Suresh',
      villageCity: 'Hapur',
      state: 'UP',
      phone: '9876500000'
    })
    const acctId = createAccount({
      name: 'Ramesh (Kisan)',
      type: 'kisan',
      subgroupId: groupId('Farmer'),
      personId
    })

    const before = getAccountDetail(acctId, yearId)
    expect(before).toMatchObject({
      name: 'Ramesh (Kisan)',
      type: 'kisan',
      subgroupName: 'Farmer',
      personName: 'Ramesh',
      sonOf: 'Suresh',
      villageCity: 'Hapur',
      state: 'UP',
      phone: '9876500000',
      hasOpening: false
    })

    setOpeningBalance(acctId, yearId, 250000, 'dr', '2026-01-01')
    const after = getAccountDetail(acctId, yearId)
    expect(after?.hasOpening).toBe(true)
    expect(after?.balancePaise).toBe(250000)
  })

  it('edits identity fields on the linked person', () => {
    const personId = createPerson({ name: 'Ramesh', villageCity: 'Hapur', phone: '111' })
    const acctId = createAccount({
      name: 'Ramesh (Kisan)',
      type: 'kisan',
      subgroupId: groupId('Farmer'),
      personId
    })
    updateAccountIdentity(acctId, {
      sonOf: 'Suresh',
      villageCity: 'Agra',
      state: 'UP',
      phone: '999'
    })
    expect(getAccountDetail(acctId, yearId)).toMatchObject({
      personId,
      sonOf: 'Suresh',
      villageCity: 'Agra',
      state: 'UP',
      phone: '999'
    })
  })

  it('creates and links a person when editing an account that has none', () => {
    const acctId = makeAccount('Nikhil Kisan', 'kisan', 'Farmer')
    expect(getAccountDetail(acctId, yearId)?.personId).toBeNull()
    updateAccountIdentity(acctId, { villageCity: 'Agra', phone: '999' })
    const d = getAccountDetail(acctId, yearId)
    expect(d?.personId).not.toBeNull()
    expect(d).toMatchObject({ villageCity: 'Agra', phone: '999', personName: 'Nikhil Kisan' })
  })

  it('assigns a type-prefixed account number, with an independent serial per type', () => {
    const k1 = createAccount({ name: 'A', type: 'kisan', subgroupId: groupId('Farmer') }, 2026)
    const v1 = createAccount({ name: 'B', type: 'vyapari', subgroupId: groupId('Farmer') }, 2026)
    const k2 = createAccount({ name: 'C', type: 'kisan', subgroupId: groupId('Farmer') }, 2026)
    const lc1 = createAccount(
      { name: 'D', type: 'loading_contractor', subgroupId: groupId('Farmer') },
      2026
    )
    expect(getAccountDetail(k1, yearId)?.code).toBe('K-26-0001')
    expect(getAccountDetail(v1, yearId)?.code).toBe('V-26-0001')
    expect(getAccountDetail(k2, yearId)?.code).toBe('K-26-0002')
    expect(getAccountDetail(lc1, yearId)?.code).toBe('LC-26-0001')
  })

  it('continues the per-type serial across years (year stamps creation)', () => {
    const k2026 = createAccount({ name: 'A', type: 'kisan', subgroupId: groupId('Farmer') }, 2026)
    const k2027 = createAccount({ name: 'B', type: 'kisan', subgroupId: groupId('Farmer') }, 2027)
    expect(getAccountDetail(k2026, yearId)?.code).toBe('K-26-0001')
    expect(getAccountDetail(k2027, yearId)?.code).toBe('K-27-0002')
  })

  it('backfills codes for pre-existing accounts and is idempotent', () => {
    // A legacy account inserted before codes existed (null code).
    const inserted = db()
      .insert(account)
      .values({
        name: 'Legacy Kisan',
        type: 'kisan',
        subgroupId: groupId('Farmer'),
        createdAt: new Date('2026-03-01')
      })
      .returning({ id: account.id })
      .get()
    expect(getAccountDetail(inserted.id, yearId)?.code).toBeNull()

    backfillAccountCodes()
    expect(getAccountDetail(inserted.id, yearId)?.code).toBe('K-26-0001')

    backfillAccountCodes() // no-op the second time
    expect(getAccountDetail(inserted.id, yearId)?.code).toBe('K-26-0001')
  })

  it('finds an account by its code via the name filter', () => {
    const k1 = createAccount({ name: 'Ramesh', type: 'kisan', subgroupId: groupId('Farmer') }, 2026)
    expect(listAccounts(yearId, { name: 'K-26-0001' }).map((r) => r.id)).toContain(k1)
  })

  it('systemOnly returns just the cold\'s own heads', () => {
    makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
    const rows = listAccounts(yearId, { systemOnly: true })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.isSystem)).toBe(true)
    expect(rows.some((r) => r.name === 'Cash')).toBe(true)
  })

  it('deletes an unused account', () => {
    const acctId = makeAccount('Temp Kisan', 'kisan', 'Farmer')
    deleteAccount(acctId)
    expect(listAccounts(yearId).find((r) => r.id === acctId)).toBeUndefined()
  })

  it('refuses to delete an account with ledger activity', () => {
    const kisan = makeAccount('Active Kisan', 'kisan', 'Farmer')
    setOpeningBalance(kisan, yearId, 250000, 'dr', '2026-01-01')
    expect(() => deleteAccount(kisan)).toThrow(/ledger transactions/)
    expect(listAccounts(yearId).find((r) => r.id === kisan)).toBeDefined()
  })

  it('refuses to delete a system account', () => {
    const cash = listAccounts(yearId, { includeSystem: true }).find((r) => r.name === 'Cash')!
    expect(() => deleteAccount(cash.id)).toThrow(/System accounts/)
  })
})
