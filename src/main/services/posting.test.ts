import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, db } from '../data/db'
import { voucher } from '../data/schema'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { post, voidVoucher } from './posting'

let yearId: number
let kisan: number
let cash: number

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
  cash = makeAccount('Cash Drawer', 'other', 'Cash and Bank')
})
afterEach(() => closeDb())

function balancedReceipt(amount = 100000) {
  return {
    yearId,
    type: 'receipt' as const,
    date: '2026-03-10',
    entries: [
      { accountId: cash, drPaise: amount, crPaise: 0 },
      { accountId: kisan, drPaise: 0, crPaise: amount }
    ]
  }
}

describe('PostingService.post', () => {
  it('writes a balanced voucher and returns ids', () => {
    const res = post(balancedReceipt())
    expect(res.voucherId).toBeGreaterThan(0)
    expect(res.voucherNo).toBe(1)
    expect(db().select().from(voucher).all()).toHaveLength(1)
  })

  it('refuses an unbalanced voucher (Σdr ≠ Σcr) and writes nothing', () => {
    expect(() =>
      post({
        yearId,
        type: 'receipt',
        date: '2026-03-10',
        entries: [
          { accountId: cash, drPaise: 100000, crPaise: 0 },
          { accountId: kisan, drPaise: 0, crPaise: 99999 }
        ]
      })
    ).toThrow(/unbalanced/i)
    expect(db().select().from(voucher).all()).toHaveLength(0)
  })

  it('refuses a single-entry voucher', () => {
    expect(() =>
      post({ yearId, type: 'journal', date: '2026-03-10', entries: [{ accountId: cash, drPaise: 1, crPaise: 0 }] })
    ).toThrow(/two entries/i)
  })

  it('refuses an entry that is both Dr and Cr', () => {
    expect(() =>
      post({
        yearId,
        type: 'journal',
        date: '2026-03-10',
        entries: [
          { accountId: cash, drPaise: 100, crPaise: 100 },
          { accountId: kisan, drPaise: 0, crPaise: 0 }
        ]
      })
    ).toThrow(/both Dr and Cr/i)
  })

  it('increments number_series per (year, type)', () => {
    expect(post(balancedReceipt()).voucherNo).toBe(1)
    expect(post(balancedReceipt()).voucherNo).toBe(2)
    // a different type restarts its own series
    const payment = post({
      yearId,
      type: 'payment',
      date: '2026-03-11',
      entries: [
        { accountId: kisan, drPaise: 5000, crPaise: 0 },
        { accountId: cash, drPaise: 0, crPaise: 5000 }
      ]
    })
    expect(payment.voucherNo).toBe(1)
  })

  it('rolls back fully on a mid-transaction failure (FK violation), incrementing nothing', () => {
    expect(() =>
      post({
        yearId,
        type: 'receipt',
        date: '2026-03-10',
        entries: [
          { accountId: cash, drPaise: 100000, crPaise: 0 },
          { accountId: 999999, drPaise: 0, crPaise: 100000 } // non-existent account → FK error
        ]
      })
    ).toThrow()
    expect(db().select().from(voucher).all()).toHaveLength(0)
    // the rolled-back series increment did not stick → next real post is still #1
    expect(post(balancedReceipt()).voucherNo).toBe(1)
  })

  it('voids a voucher without hard-deleting it', () => {
    const { voucherId } = post(balancedReceipt())
    voidVoucher(voucherId, 'entered by mistake')
    const row = db().select().from(voucher).all()[0]
    expect(row.voidedAt).not.toBeNull()
    expect(row.voidedReason).toBe('entered by mistake')
    expect(() => voidVoucher(voucherId, 'again')).toThrow(/already voided/i)
  })
})
