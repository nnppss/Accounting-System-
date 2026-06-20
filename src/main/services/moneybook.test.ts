import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { setOpeningBalance } from './accounts'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { createReceipt, createPayment } from './vouchers'
import { getCashBankAccounts, getDetail, getSummary } from './moneybook'

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

describe('Money Book', () => {
  it('lists Cash plus any bank accounts', () => {
    makeAccount('SBI Current', 'other', 'Cash and Bank')
    const names = getCashBankAccounts().map((a) => a.name)
    expect(names).toContain('Cash')
    expect(names).toContain('SBI Current')
  })

  it('shows a receipt in the right month and carries the balance forward', () => {
    createReceipt({ yearId, date: '2026-03-10', partyAccountId: kisan, cashBankAccountId: cash, amountPaise: 80000 })
    const summary = getSummary(cash, yearId)
    const march = summary.months.find((m) => m.month === 3)!
    expect(march.receiptsPaise).toBe(80000)
    expect(march.closingPaise).toBe(80000)
    // April opens with March's closing
    expect(summary.months.find((m) => m.month === 4)!.openingPaise).toBe(80000)
    expect(summary.closingPaise).toBe(80000)
  })

  it('treats an opening balance as the opening column, not a receipt', () => {
    setOpeningBalance(cash, yearId, 500000, 'dr', '2026-01-01')
    const summary = getSummary(cash, yearId)
    expect(summary.openingPaise).toBe(500000)
    expect(summary.months.find((m) => m.month === 1)!.openingPaise).toBe(500000)
    expect(summary.months.find((m) => m.month === 1)!.receiptsPaise).toBe(0)
  })

  it('nets receipts and payments across the year', () => {
    createReceipt({ yearId, date: '2026-03-10', partyAccountId: kisan, cashBankAccountId: cash, amountPaise: 80000 })
    createPayment({ yearId, date: '2026-04-05', partyAccountId: kisan, cashBankAccountId: cash, amountPaise: 30000 })
    expect(getSummary(cash, yearId).closingPaise).toBe(50000)
    const detail = getDetail(cash, yearId, 4)
    expect(detail).toHaveLength(1)
    expect(detail[0].paymentPaise).toBe(30000)
    expect(detail[0].counterparty).toBe('Ramesh Kisan')
  })
})
