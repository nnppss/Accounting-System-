import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { getAccountBalance, getAccountLedger, getTrialBalance } from './ledger'
import { getSummary } from './moneybook'
import {
  getLoadingContractorYear,
  listLoadingContractorYears,
  listLoadingRegister,
  listSalaryRegister,
  payLoadingContractor,
  paySalary,
  setLoadingContractorYear
} from './expenses'

let yearId: number
let cash: number
let salaryExpense: number
let loadingExpense: number

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  cash = getSystemAccountId(SYSTEM_ACCOUNTS.CASH)
  salaryExpense = getSystemAccountId(SYSTEM_ACCOUNTS.SALARY_EXPENSE)
  loadingExpense = getSystemAccountId(SYSTEM_ACCOUNTS.LOADING_EXPENSE)
})
afterEach(() => closeDb())

describe('Staff salaries (posting map: Salary | Expense | Cash/Bank)', () => {
  it('posts Dr Salary Expense / Cr Cash and shows in the register + money book', () => {
    const staff = makeAccount('Ravi Staff', 'staff', 'Direct Expense')
    paySalary(yearId, { partyAccountId: staff, amountPaise: 1500000, date: '2026-01-31', mode: 'cash' })
    expect(getAccountBalance(salaryExpense, yearId)).toBe(1500000) // expense Dr
    expect(getAccountBalance(cash, yearId)).toBe(-1500000) // paid out
    expect(getSummary(cash, yearId).months[0].paymentsPaise).toBe(1500000) // January payment

    const reg = listSalaryRegister(yearId)
    expect(reg).toHaveLength(1)
    expect(reg[0].partyName).toBe('Ravi Staff') // attributed to the staff member
    expect(reg[0].amountPaise).toBe(1500000)
    expect(reg[0].narration).toBe('Staff salary — Ravi Staff')

    // The payment is documented on the staff member's own ledger: salary due, then paid (net 0).
    // Ledger is newest-first, so the paid (Dr) row leads and the due (Cr) row follows.
    const lines = getAccountLedger(staff, yearId)
    expect(lines.map((l) => [l.drPaise, l.crPaise])).toEqual([
      [1500000, 0],
      [0, 1500000]
    ])
    expect(getAccountBalance(staff, yearId)).toBe(0)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })
})

describe('Loading-contractor charges (yearly quoted amounts + payments)', () => {
  it('upserts the quoted amounts, allowing one side to stay undecided', () => {
    const contractor = makeAccount('Singh Loaders', 'loading_contractor', 'Direct Expense')
    // Filling season: only the loading amount is settled so far.
    setLoadingContractorYear(yearId, {
      accountId: contractor,
      loadingAmountPaise: 50000000,
      unloadingAmountPaise: null
    })
    let row = getLoadingContractorYear(contractor, yearId)
    expect(row.loadingAmountPaise).toBe(50000000)
    expect(row.unloadingAmountPaise).toBeNull()

    // Later in the year the unloading amount is agreed — re-saving replaces (no duplicate rows).
    setLoadingContractorYear(yearId, {
      accountId: contractor,
      loadingAmountPaise: 50000000,
      unloadingAmountPaise: 40000000
    })
    row = getLoadingContractorYear(contractor, yearId)
    expect(row.loadingAmountPaise).toBe(50000000)
    expect(row.unloadingAmountPaise).toBe(40000000)
    expect(listLoadingContractorYears(yearId)).toHaveLength(1)
  })

  it('posts Dr Loading Expense / Cr Cash and shows in the register', () => {
    const contractor = makeAccount('Singh Loaders', 'loading_contractor', 'Direct Expense')
    payLoadingContractor(yearId, { partyAccountId: contractor, amountPaise: 800000, date: '2026-05-10', mode: 'cash' })
    expect(getAccountBalance(loadingExpense, yearId)).toBe(800000)
    expect(getAccountBalance(cash, yearId)).toBe(-800000)
    const reg = listLoadingRegister(yearId)
    expect(reg).toHaveLength(1)
    expect(reg[0].partyName).toBe('Singh Loaders')
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })
})
