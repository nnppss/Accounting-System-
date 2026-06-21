import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { getAccountBalance, getTrialBalance } from './ledger'
import { getSummary } from './moneybook'
import { createBardana, getBardanaAccount } from './bardana'

let yearId: number
let cash: number
let bardanaPurchase: number
let bardanaSales: number

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  cash = getSystemAccountId(SYSTEM_ACCOUNTS.CASH)
  bardanaPurchase = getSystemAccountId(SYSTEM_ACCOUNTS.BARDANA_PURCHASE)
  bardanaSales = getSystemAccountId(SYSTEM_ACCOUNTS.BARDANA_SALES)
})
afterEach(() => closeDb())

describe('Bardana sub-ledger (software.md §3.7)', () => {
  it('purchase posts Dr Bardana Purchase / Cr Cash; amount = rate × qty', () => {
    // 100 pcs @ ₹20 = ₹2,000.
    createBardana(yearId, { direction: 'purchase', date: '2026-02-01', ratePaise: 2000, qty: 100, mode: 'cash' })
    expect(getAccountBalance(bardanaPurchase, yearId)).toBe(200000) // expense Dr
    expect(getAccountBalance(cash, yearId)).toBe(-200000) // cash went out
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('issue posts Dr Cash / Cr Bardana Sales', () => {
    // 60 pcs @ ₹40 = ₹2,400.
    createBardana(yearId, { direction: 'issue', date: '2026-03-01', ratePaise: 4000, qty: 60, mode: 'cash' })
    expect(getAccountBalance(cash, yearId)).toBe(240000) // money in
    expect(getAccountBalance(bardanaSales, yearId)).toBe(-240000) // income Cr
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('A/C: stock count = Σpurchased − Σissued; profit = sales − purchases', () => {
    createBardana(yearId, { direction: 'purchase', date: '2026-02-01', ratePaise: 2000, qty: 100, mode: 'cash' })
    createBardana(yearId, { direction: 'issue', date: '2026-03-01', ratePaise: 4000, qty: 60, mode: 'cash' })
    const acct = getBardanaAccount(yearId)
    expect(acct.purchases).toHaveLength(1)
    expect(acct.issues).toHaveLength(1)
    expect(acct.totalPurchasesPaise).toBe(200000)
    expect(acct.totalSalesPaise).toBe(240000)
    expect(acct.stockCount).toBe(40) // 100 bought − 60 sold
    expect(acct.profitPaise).toBe(40000) // ₹2,400 − ₹2,000 = ₹400
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('a bank-settled bardana hits the bank money book, not cash', () => {
    const bank = makeAccount('HDFC Bank', 'other', 'Cash and Bank')
    createBardana(yearId, {
      direction: 'issue',
      date: '2026-04-01',
      ratePaise: 5000,
      qty: 10,
      mode: 'bank',
      bankAccountId: bank
    })
    expect(getSummary(bank, yearId).closingPaise).toBe(50000) // ₹500 into the bank
    expect(getAccountBalance(cash, yearId)).toBe(0) // cash untouched
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('records the named buyer/supplier but settles to cash/bank', () => {
    const vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
    createBardana(yearId, {
      direction: 'issue',
      date: '2026-04-02',
      partyAccountId: vyapari,
      ratePaise: 3000,
      qty: 20,
      mode: 'cash'
    })
    const acct = getBardanaAccount(yearId)
    expect(acct.issues[0].partyName).toBe('Mohan Vyapari')
    expect(getAccountBalance(vyapari, yearId)).toBe(0) // the name is recorded, not posted to
  })

  it('rejects a bank settlement with no bank account, and non-positive quantity', () => {
    expect(() =>
      createBardana(yearId, { direction: 'purchase', date: '2026-02-01', ratePaise: 2000, qty: 5, mode: 'bank' })
    ).toThrow()
    expect(() =>
      createBardana(yearId, { direction: 'purchase', date: '2026-02-01', ratePaise: 2000, qty: 0, mode: 'cash' })
    ).toThrow()
  })
})
