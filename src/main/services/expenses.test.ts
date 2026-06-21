import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { getAccountBalance, getTrialBalance } from './ledger'
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
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })
})

describe('Loading-contractor charges (year fields + payments)', () => {
  it('upserts per-year charges and labourer counts', () => {
    const contractor = makeAccount('Singh Loaders', 'loading_contractor', 'Direct Expense')
    setLoadingContractorYear(yearId, {
      accountId: contractor,
      loadingChargePaise: 500,
      unloadingChargePaise: 400,
      labourersLoading: 6,
      labourersUnloading: 4
    })
    const row = getLoadingContractorYear(contractor, yearId)
    expect(row.loadingChargePaise).toBe(500)
    expect(row.labourersLoading).toBe(6)

    // Re-saving replaces (no duplicate rows).
    setLoadingContractorYear(yearId, {
      accountId: contractor,
      loadingChargePaise: 600,
      unloadingChargePaise: 450,
      labourersLoading: 8,
      labourersUnloading: 5
    })
    expect(getLoadingContractorYear(contractor, yearId).loadingChargePaise).toBe(600)
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
