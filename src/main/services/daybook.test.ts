import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { createPayment, createReceipt } from './vouchers'
import { getDayBook } from './daybook'

let yearId: number
let cash: number
let kisan: number

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  cash = getSystemAccountId(SYSTEM_ACCOUNTS.CASH)
  kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
})
afterEach(() => closeDb())

describe('Day Book', () => {
  it('returns only the chosen day, grouped by voucher, with tied Dr/Cr totals', () => {
    createReceipt({ yearId, date: '2026-06-02', partyAccountId: kisan, cashBankAccountId: cash, amountPaise: 80000 })
    createPayment({ yearId, date: '2026-06-02', partyAccountId: kisan, cashBankAccountId: cash, amountPaise: 30000 })
    createReceipt({ yearId, date: '2026-06-03', partyAccountId: kisan, cashBankAccountId: cash, amountPaise: 50000 })

    const day = getDayBook(yearId, '2026-06-02')
    expect(day.vouchers).toHaveLength(2) // the 2nd only, not the 3rd
    // Each voucher carries both its posting legs.
    expect(day.vouchers[0].entries).toHaveLength(2)
    // Books tie: Σdr == Σcr == 80000 + 30000.
    expect(day.totalDrPaise).toBe(110000)
    expect(day.totalCrPaise).toBe(110000)
  })

  it('is empty on a day with no postings', () => {
    expect(getDayBook(yearId, '2026-06-05').vouchers).toHaveLength(0)
  })
})
