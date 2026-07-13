import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, db } from '../data/db'
import { voucher } from '../data/schema'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { post } from './posting'
import { createReceipt, voidManualVoucher } from './vouchers'

let yearId: number
let kisan: number
let cash: number

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
  cash = makeAccount('Cash Drawer', 'bank', 'Cash and Bank')
})
afterEach(() => closeDb())

describe('voidManualVoucher', () => {
  it('voids a manually-entered voucher and records the reason', () => {
    const { voucherId } = createReceipt({
      yearId,
      date: '2026-03-10',
      partyAccountId: kisan,
      cashBankAccountId: cash,
      amountPaise: 100000
    })
    voidManualVoucher(yearId, voucherId, '  wrong amount  ')
    const row = db().select().from(voucher).all()[0]
    expect(row.voidedAt).not.toBeNull()
    expect(row.voidedReason).toBe('wrong amount') // trimmed
  })

  it('refuses to void a module-raised voucher', () => {
    const { voucherId } = post({
      yearId,
      type: 'payment',
      date: '2026-03-10',
      sourceModule: 'nikasi',
      entries: [
        { accountId: kisan, drPaise: 5000, crPaise: 0 },
        { accountId: cash, drPaise: 0, crPaise: 5000 }
      ]
    })
    expect(() => voidManualVoucher(yearId, voucherId, 'nope')).toThrow(/own screen/i)
    expect(db().select().from(voucher).all()[0].voidedAt).toBeNull()
  })

  it('requires a non-empty reason', () => {
    const { voucherId } = createReceipt({
      yearId,
      date: '2026-03-10',
      partyAccountId: kisan,
      cashBankAccountId: cash,
      amountPaise: 100000
    })
    expect(() => voidManualVoucher(yearId, voucherId, '   ')).toThrow(/reason/i)
    expect(db().select().from(voucher).all()[0].voidedAt).toBeNull()
  })
})
