import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { getAccountBalance, getTrialBalance } from '../services/ledger'
import { createLoan, getStandingLoan, recordPayment } from '../services/loans'
import { accrue, capitaliseLoan, monthsBetween, outstandingAsOf } from './interest'

let yearId: number
let kisan: number

const LAKH = 10000000 // ₹1,00,000 in paise

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
})
afterEach(() => closeDb())

describe('interest math primitives', () => {
  it('counts two consecutive 1-Jans as exactly 12 months', () => {
    expect(monthsBetween('2026-01-01', '2027-01-01').toNumber()).toBe(12)
    expect(monthsBetween('2026-04-01', '2027-01-01').toNumber()).toBe(9)
  })

  it('accrues simple interest to the paise', () => {
    expect(accrue(LAKH, '2026-01-01', '2027-01-01', 150)).toBe(1800000) // 12 × 1.5% = ₹18,000
    expect(accrue(11800000, '2027-01-01', '2028-01-01', 150)).toBe(2124000) // ₹21,240
  })
})

describe('interest engine — worked examples (software.md §3.8)', () => {
  it('full year: ₹1,00,000 → ₹1,18,000 → ₹1,39,240 (simple year 1, compound after)', () => {
    const { loanId } = createLoan(yearId, {
      category: 'kisan',
      accountId: kisan,
      date: '2026-01-01',
      amountPaise: LAKH,
      mode: 'cash',
      nature: 'direct'
    })
    // Pure live figure (posts nothing) reproduces the example to the paise.
    expect(outstandingAsOf(loanId, '2027-01-01').outstandingPaise).toBe(11800000)
    expect(outstandingAsOf(loanId, '2028-01-01').outstandingPaise).toBe(13924000)

    // And posting the capitalisations keeps the ledger equal to the engine.
    expect(capitaliseLoan(loanId, '2027-01-01')!.interestPaise).toBe(1800000)
    expect(getStandingLoan(kisan, yearId).standingPaise).toBe(11800000)
    expect(capitaliseLoan(loanId, '2028-01-01')!.interestPaise).toBe(2124000)
    expect(getStandingLoan(kisan, yearId).standingPaise).toBe(13924000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('mid-year: pro-rated by months to 31 Dec, capitalised 1 Jan', () => {
    const { loanId } = createLoan(yearId, {
      category: 'kisan',
      accountId: kisan,
      date: '2026-04-01',
      amountPaise: LAKH,
      mode: 'cash',
      nature: 'direct'
    })
    // 9 months × 1.5% = ₹13,500 → ₹1,13,500 at 1 Jan 2027.
    expect(outstandingAsOf(loanId, '2027-01-01').outstandingPaise).toBe(11350000)
    expect(capitaliseLoan(loanId, '2027-01-01')!.interestPaise).toBe(1350000)
    expect(getStandingLoan(kisan, yearId).standingPaise).toBe(11350000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('part-payment: clears principal + interest to that day; remainder keeps accruing', () => {
    const { loanId } = createLoan(yearId, {
      category: 'kisan',
      accountId: kisan,
      date: '2026-01-01',
      amountPaise: LAKH,
      mode: 'cash',
      nature: 'direct'
    })
    // Pay ₹50,000 on 1 Jul 2026: 6 months interest = ₹9,000; outstanding before = ₹1,09,000.
    const r = recordPayment(loanId, 5000000, '2026-07-01', 'cash', undefined)
    expect(r.interestPaise).toBe(900000) // ₹9,000 booked
    expect(r.principalPaise).toBe(4100000) // ₹41,000 toward principal

    // Right after payment, ledger and engine agree at ₹59,000.
    expect(getStandingLoan(kisan, yearId).standingPaise).toBe(5900000)
    expect(outstandingAsOf(loanId, '2026-07-01').outstandingPaise).toBe(5900000)

    // The remainder keeps accruing: 6 more months on ₹59,000 → ₹64,310 at 1 Jan 2027.
    expect(outstandingAsOf(loanId, '2027-01-01').outstandingPaise).toBe(6431000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('refuses a payment larger than the outstanding', () => {
    const { loanId } = createLoan(yearId, {
      category: 'kisan',
      accountId: kisan,
      date: '2026-01-01',
      amountPaise: LAKH,
      mode: 'cash',
      nature: 'direct'
    })
    expect(() => recordPayment(loanId, 99900000, '2026-07-01', 'cash', undefined)).toThrow()
  })

  it('an indirect loan accrues interest only from 1 Jan of the next year (and posts no cash)', () => {
    const { loanId, voucherId } = createLoan(yearId, {
      category: 'vyapari',
      accountId: kisan,
      date: '2026-06-01',
      amountPaise: LAKH,
      mode: 'cash',
      nature: 'indirect'
    })
    expect(voucherId).toBeNull() // dues reclassified — no disbursement posted
    // Interest-free through 2026; from 1 Jan 2027 it begins. By 1 Jan 2028 = ₹1,18,000.
    expect(outstandingAsOf(loanId, '2026-12-31').outstandingPaise).toBe(LAKH)
    expect(outstandingAsOf(loanId, '2028-01-01').outstandingPaise).toBe(11800000)
  })

  it('capitalisation is idempotent — re-running 1 Jan does not double-charge', () => {
    const { loanId } = createLoan(yearId, {
      category: 'kisan',
      accountId: kisan,
      date: '2026-01-01',
      amountPaise: LAKH,
      mode: 'cash',
      nature: 'direct'
    })
    capitaliseLoan(loanId, '2027-01-01')
    capitaliseLoan(loanId, '2027-01-01') // re-run
    expect(getStandingLoan(kisan, yearId).standingPaise).toBe(11800000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })
})
