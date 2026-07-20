import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { createJournal, createPayment, createReceipt } from './vouchers'
import { getDayBook } from './daybook'

let yearId: number
let cash: number
let bank: number
let kisan: number

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  cash = getSystemAccountId(SYSTEM_ACCOUNTS.CASH)
  bank = makeAccount('HDFC Bank', 'bank', 'Cash and Bank')
  kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
})
afterEach(() => closeDb())

describe('Day Book', () => {
  it('groups the day into one section per cash/bank account, with a running balance', () => {
    createReceipt({ yearId, date: '2026-06-01', partyAccountId: kisan, cashBankAccountId: cash, amountPaise: 20000 })
    createReceipt({ yearId, date: '2026-06-02', partyAccountId: kisan, cashBankAccountId: cash, amountPaise: 80000 })
    createPayment({ yearId, date: '2026-06-02', partyAccountId: kisan, cashBankAccountId: cash, amountPaise: 30000 })
    createReceipt({ yearId, date: '2026-06-02', partyAccountId: kisan, cashBankAccountId: bank, amountPaise: 50000 })
    createReceipt({ yearId, date: '2026-06-03', partyAccountId: kisan, cashBankAccountId: cash, amountPaise: 90000 })

    const day = getDayBook(yearId, '2026-06-02')
    expect(day.sections.map((s) => s.accountName)).toEqual(['Cash', 'HDFC Bank'])

    const [cashSection, bankSection] = day.sections
    // Opens with the 1st's receipt, not zero, and the balance walks each transaction.
    // Rows are newest-first, so the balances read latest → earliest.
    expect(cashSection.openingPaise).toBe(20000)
    expect(cashSection.rows.map((r) => r.balancePaise)).toEqual([70000, 100000])
    expect(cashSection.closingPaise).toBe(70000)
    // Each book keeps its own balance; the 3rd's receipt is not in it.
    expect(bankSection.rows).toHaveLength(1)
    expect(bankSection.openingPaise).toBe(0)
    expect(bankSection.closingPaise).toBe(50000)

    expect(day.totalReceiptPaise).toBe(130000)
    expect(day.totalPaymentPaise).toBe(30000)
    // Who the money moved to/from, for the ledger link.
    expect(cashSection.rows[0].counterparties).toEqual([{ id: kisan, name: 'Ramesh Kisan' }])
  })

  it('leaves out a journal that moves no money, and days with no movement', () => {
    const rent = getSystemAccountId(SYSTEM_ACCOUNTS.RENT_INCOME)
    createJournal({
      yearId,
      date: '2026-06-02',
      entries: [
        { accountId: kisan, drPaise: 130000, crPaise: 0 },
        { accountId: rent, drPaise: 0, crPaise: 130000 }
      ]
    })
    expect(getDayBook(yearId, '2026-06-02').sections).toHaveLength(0)
    expect(getDayBook(yearId, '2026-06-05').sections).toHaveLength(0)
  })
})
