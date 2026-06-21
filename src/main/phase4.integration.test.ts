import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from './data/db'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from './data/seed'
import { makeAccount, makeYear, setupDb } from './test-utils'
import { getAccountBalance, getTrialBalance } from './services/ledger'
import { getSummary } from './services/moneybook'
import { createBardana, getBardanaAccount } from './services/bardana'
import { paySalary, payLoadingContractor, listSalaryRegister, listLoadingRegister } from './services/expenses'

/**
 * Phase 4 capstone — the side ledgers end-to-end:
 *   bardana purchases + sales (profit + stock count) → staff salary → loading-contractor payment.
 * Every expense posting hits the ledger and the Money Book; the trial balance stays net-zero.
 */
describe('Phase 4 done/verify — bardana + staff/loading expenses', () => {
  beforeEach(() => setupDb())
  afterEach(() => closeDb())

  it('runs bardana trade + salary + loading payment and ties throughout', () => {
    const yearId = makeYear(2026)
    const cash = getSystemAccountId(SYSTEM_ACCOUNTS.CASH)
    const staff = makeAccount('Ravi Staff', 'staff', 'Direct Expense')
    const contractor = makeAccount('Singh Loaders', 'loading_contractor', 'Direct Expense')
    const vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')

    // 1) Buy 500 bags @ ₹18 (₹9,000), then sell 300 @ ₹25 (₹7,500), both for cash.
    createBardana(yearId, { direction: 'purchase', date: '2026-01-15', ratePaise: 1800, qty: 500, mode: 'cash' })
    createBardana(yearId, {
      direction: 'issue',
      date: '2026-02-20',
      partyAccountId: vyapari,
      ratePaise: 2500,
      qty: 300,
      mode: 'cash'
    })
    const acct = getBardanaAccount(yearId)
    expect(acct.stockCount).toBe(200) // 500 − 300
    expect(acct.totalPurchasesPaise).toBe(900000)
    expect(acct.totalSalesPaise).toBe(750000)
    expect(acct.profitPaise).toBe(-150000) // sold less than bought so far → ₹1,500 loss
    expect(getTrialBalance(yearId).balanced).toBe(true)

    // 2) Pay a staff salary ₹12,000 in March.
    paySalary(yearId, { partyAccountId: staff, amountPaise: 1200000, date: '2026-03-31', mode: 'cash' })
    expect(getAccountBalanceForSalary(yearId)).toBe(1200000)
    expect(listSalaryRegister(yearId)).toHaveLength(1)
    expect(getTrialBalance(yearId).balanced).toBe(true)

    // 3) Pay the loading contractor ₹6,000 in April.
    payLoadingContractor(yearId, { partyAccountId: contractor, amountPaise: 600000, date: '2026-04-05', mode: 'cash' })
    expect(listLoadingRegister(yearId)).toHaveLength(1)
    expect(getTrialBalance(yearId).balanced).toBe(true)

    // Money Book (cash) reflects every flow: +9,000 −7,500? No — purchase paid out, sale came in,
    // salary + loading paid out. Net cash = −9,000 + 7,500 − 12,000 − 6,000 = −19,500.
    const cashBook = getSummary(cash, yearId)
    expect(cashBook.closingPaise).toBe(-1950000)
    expect(getAccountBalance(cash, yearId)).toBe(-1950000) // money book agrees with the ledger
  })

  function getAccountBalanceForSalary(yearId: number): number {
    return getAccountBalance(getSystemAccountId(SYSTEM_ACCOUNTS.SALARY_EXPENSE), yearId)
  }
})
