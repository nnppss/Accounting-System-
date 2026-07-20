import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../data/db'
import { loanEvent, voucher } from '../data/schema'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { getAccountBalance, getTrialBalance } from '../services/ledger'
import { createLoan, getStandingLoan, recordPayment } from '../services/loans'
import {
  accrue,
  accruedForPayment,
  capitaliseLoan,
  fixLoanInterest,
  fixPartyInterest,
  monthsBetween,
  outstandingAsOf
} from './interest'

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

  it('fixing the interest: the figure holds to the date set, and the meter is off until then', () => {
    // ₹1,00,000 to Nitesh Lalu on 2 Feb 2026 at 2%/month. The cold tells him: your interest is
    // ₹10,800 up to the year-end — that is the figure, whatever the rate would work out.
    const { loanId } = createLoan(yearId, {
      category: 'kisan',
      accountId: kisan,
      date: '2026-02-02',
      amountPaise: LAKH,
      mode: 'cash',
      nature: 'direct',
      monthlyRateBps: 200
    })
    fixLoanInterest(loanId, '2026-12-31', 1080000)

    // Nothing more accrues anywhere inside that stretch — not in July, not in October.
    expect(outstandingAsOf(loanId, '2026-07-15').outstandingPaise).toBe(11080000)
    expect(outstandingAsOf(loanId, '2026-10-31').outstandingPaise).toBe(11080000)
    expect(outstandingAsOf(loanId, '2026-12-31').outstandingPaise).toBe(11080000)
    expect(accruedForPayment(loanId, '2026-10-31').interestPaise).toBe(0)
    expect(getStandingLoan(kisan, yearId).standingPaise).toBe(11080000)
    expect(getTrialBalance(yearId).balanced).toBe(true)

    // A payment inside the stretch settles against ₹1,10,800 and is charged no extra interest.
    const r = recordPayment(loanId, 11080000, '2026-09-01', 'cash', undefined)
    expect(r.interestPaise).toBe(0)
    expect(outstandingAsOf(loanId, '2026-12-31').outstandingPaise).toBe(0)
    expect(getStandingLoan(kisan, yearId).standingPaise).toBe(0)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('fixing the interest: re-editable, ₹0 sticks, and interest resumes past the date', () => {
    const { loanId } = createLoan(yearId, {
      category: 'kisan',
      accountId: kisan,
      date: '2026-02-02',
      amountPaise: LAKH,
      mode: 'cash',
      nature: 'direct',
      monthlyRateBps: 200
    })
    fixLoanInterest(loanId, '2026-12-31', 1080000)

    // Interest runs again from the date set, on the fixed base and at the loan's own rate — still
    // folding at 1 Jan, so the day between 31 Dec and the new year compounds like any other.
    const atNewYear = 11080000 + accrue(11080000, '2026-12-31', '2027-01-01', 200)
    const expected = atNewYear + accrue(atNewYear, '2027-01-01', '2027-03-01', 200)
    expect(expected).toBeGreaterThan(11080000)
    expect(outstandingAsOf(loanId, '2027-03-01').outstandingPaise).toBe(expected)

    // Re-fixing the same date replaces the earlier figure rather than charging twice.
    fixLoanInterest(loanId, '2026-12-31', 1000000)
    expect(getStandingLoan(kisan, yearId).standingPaise).toBe(11000000)
    expect(outstandingAsOf(loanId, '2026-12-31').outstandingPaise).toBe(11000000)
    expect(getTrialBalance(yearId).balanced).toBe(true)

    // And so does re-fixing on a *different* date in the same year: it is one figure for the year,
    // not another ₹10,000 stacked on the last one.
    fixLoanInterest(loanId, '2026-07-15', 1000000)
    expect(getStandingLoan(kisan, yearId).standingPaise).toBe(11000000)

    // ₹0 is a real answer — no interest at all for the stretch — and it sticks.
    fixLoanInterest(loanId, '2026-12-31', 0)
    expect(outstandingAsOf(loanId, '2026-12-31').outstandingPaise).toBe(LAKH)
    expect(getStandingLoan(kisan, yearId).standingPaise).toBe(LAKH)
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

    // …including a second payment the same day, which must settle against what the first left.
    recordPayment(loanId, 10000000, '2026-07-01', 'cash', undefined)
    expect(() => recordPayment(loanId, 1000000, '2026-07-01', 'cash', undefined)).toThrow()
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

/**
 * Person-level interest: the cold settles what a party owes as one agreed figure, not loan by
 * loan. The loans underneath keep their own rates and start dates — there is no single accrual to
 * compute — so the typed total is split back across them pro-rata to what each actually earned.
 * Modelled on the real case: ₹1,00,000 @2% from Feb, ₹50,000 @1.5% from July.
 */
describe('fixPartyInterest', () => {
  let big: number // ₹1,00,000 @ 2%/mo from 2026-02-02
  let small: number // ₹50,000 @ 1.5%/mo from 2026-07-15

  beforeEach(() => {
    big = createLoan(yearId, {
      category: 'kisan',
      accountId: kisan,
      date: '2026-02-02',
      amountPaise: LAKH,
      mode: 'cash',
      nature: 'direct',
      monthlyRateBps: 200
    }).loanId
    small = createLoan(yearId, {
      category: 'kisan',
      accountId: kisan,
      date: '2026-07-15',
      amountPaise: 5000000,
      mode: 'cash',
      nature: 'direct',
      monthlyRateBps: 150
    }).loanId
  })

  it('posts ONE voucher for the party and splits it across his loans pro-rata', () => {
    // To 31 Dec: big = ₹1,00,000 × 2% × 10.967… mo ≈ ₹21,935; small = ₹50,000 × 1.5% × 5.516… ≈ ₹4,137.
    const bigAccrued = accruedForPayment(big, '2026-12-31').interestPaise
    const smallAccrued = accruedForPayment(small, '2026-12-31').interestPaise
    expect(bigAccrued).toBeGreaterThan(smallAccrued) // the 2% loan earns the larger share

    const r = fixPartyInterest(kisan, yearId, '2026-12-31', 2000000) // agreed: ₹20,000 all-in

    // The shares are proportional to what each loan actually earned…
    expect(r.shares).toHaveLength(2)
    const byLoan = Object.fromEntries(r.shares.map((s) => [s.loanId, s.interestPaise]))
    const expectBig = Math.round((2000000 * bigAccrued) / (bigAccrued + smallAccrued))
    expect(byLoan[big]).toBeCloseTo(expectBig, -1)
    // …and they add up to the agreed figure to the paise, with nothing lost in rounding.
    expect(byLoan[big] + byLoan[small]).toBe(2000000)

    // ONE voucher carries the lot — the party's ledger shows a single interest row.
    expect(r.voucherId).not.toBeNull()
    const events = db()
      .select()
      .from(loanEvent)
      .where(eq(loanEvent.type, 'interest_fix'))
      .all()
    expect(events).toHaveLength(2)
    expect(new Set(events.map((e) => e.voucherId))).toEqual(new Set([r.voucherId]))
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('holds the agreed figure: the party owes exactly principal + what was fixed', () => {
    fixPartyInterest(kisan, yearId, '2026-12-31', 2000000)
    const owed =
      outstandingAsOf(big, '2026-12-31').outstandingPaise +
      outstandingAsOf(small, '2026-12-31').outstandingPaise
    expect(owed).toBe(LAKH + 5000000 + 2000000) // ₹1,50,000 principal + the ₹20,000 agreed
    expect(getAccountBalance(kisan, yearId)).toBe(owed)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('re-fixing replaces the earlier figure and leaves one live voucher, not two', () => {
    const first = fixPartyInterest(kisan, yearId, '2026-12-31', 2000000)
    const second = fixPartyInterest(kisan, yearId, '2026-12-31', 1500000)
    // The first voucher is voided — not voided twice, though both loans pointed at it.
    const live = db().select().from(voucher).all().filter((v) => v.voidedAt === null)
    expect(live.map((v) => v.id)).toContain(second.voucherId)
    expect(live.map((v) => v.id)).not.toContain(first.voucherId)
    const owed =
      outstandingAsOf(big, '2026-12-31').outstandingPaise +
      outstandingAsOf(small, '2026-12-31').outstandingPaise
    expect(owed).toBe(LAKH + 5000000 + 1500000) // the new figure replaced the old, never added
    expect(getAccountBalance(kisan, yearId)).toBe(owed)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('a fixed ₹0 sticks and posts nothing', () => {
    const r = fixPartyInterest(kisan, yearId, '2026-12-31', 0)
    expect(r.voucherId).toBeNull()
    const owed =
      outstandingAsOf(big, '2026-12-31').outstandingPaise +
      outstandingAsOf(small, '2026-12-31').outstandingPaise
    expect(owed).toBe(LAKH + 5000000) // principal only — the accountant waived the interest
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('splits by what each loan carries when nothing has accrued anywhere yet', () => {
    // On the day the second loan is taken, neither has earned at 0 elapsed months for it and the
    // fix date is its start — so there is no accrual to be proportional to. ₹90 splits 2:1 by size.
    const zero = makeAccount('Zero Rate Kisan', 'kisan', 'Farmer')
    const a = createLoan(yearId, {
      category: 'kisan', accountId: zero, date: '2026-03-01', amountPaise: LAKH,
      mode: 'cash', nature: 'direct', monthlyRateBps: 0
    }).loanId
    const b = createLoan(yearId, {
      category: 'kisan', accountId: zero, date: '2026-03-01', amountPaise: 5000000,
      mode: 'cash', nature: 'direct', monthlyRateBps: 0
    }).loanId
    const r = fixPartyInterest(zero, yearId, '2026-12-31', 9000)
    const byLoan = Object.fromEntries(r.shares.map((s) => [s.loanId, s.interestPaise]))
    expect(byLoan[a]).toBe(6000) // ₹1,00,000 of ₹1,50,000
    expect(byLoan[b]).toBe(3000) // ₹50,000 of ₹1,50,000
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('refuses a date before any loan has started earning', () => {
    expect(() => fixPartyInterest(kisan, yearId, '2026-01-01', 1000)).toThrow(/interest running/i)
  })

  it('only counts the loans already running on the date', () => {
    // 1 Mar: the July loan does not exist yet, so the whole figure belongs to the Feb one.
    const r = fixPartyInterest(kisan, yearId, '2026-03-01', 500000)
    expect(r.shares).toHaveLength(1)
    expect(r.shares[0]).toEqual({ loanId: big, interestPaise: 500000 })
  })
})
