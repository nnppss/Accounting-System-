import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../data/db'
import { loanEvent, voucher } from '../data/schema'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { outstandingAsOf } from '../engines/interest'
import { getAccountBalance, getTrialBalance } from './ledger'
import { createLoan, recordPayment, undoPayment } from './loans'
import { post } from './posting'
import {
  createPayment,
  createReceipt,
  listVouchers,
  updateManualVoucher,
  voidManualVoucher
} from './vouchers'

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

describe('updateManualVoucher', () => {
  it('voids the old voucher and re-posts a corrected one', () => {
    const { voucherId } = createReceipt({
      yearId,
      date: '2026-03-10',
      partyAccountId: kisan,
      cashBankAccountId: cash,
      amountPaise: 100000
    })
    const res = updateManualVoucher(yearId, voucherId, {
      type: 'receipt',
      date: '2026-03-11',
      partyAccountId: kisan,
      cashBankAccountId: cash,
      amountPaise: 250000
    })
    // old one is voided out of balances; only the new one is listed, with the corrected total.
    expect(db().select().from(voucher).all().find((v) => v.id === voucherId)!.voidedAt).not.toBeNull()
    const list = listVouchers(yearId)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(res.voucherId)
    expect(list[0].totalPaise).toBe(250000)
    expect(list[0].date).toBe('2026-03-11')
  })

  it('exposes Dr and Cr account names in the list', () => {
    createReceipt({
      yearId,
      date: '2026-03-10',
      partyAccountId: kisan,
      cashBankAccountId: cash,
      amountPaise: 100000
    })
    const [row] = listVouchers(yearId)
    expect(row.drName).toBe('Cash Drawer') // receipt: Dr Cash/Bank
    expect(row.crName).toBe('Ramesh Kisan') // Cr Party
  })

  it('refuses to edit a module-raised voucher', () => {
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
    expect(() =>
      updateManualVoucher(yearId, voucherId, {
        type: 'payment',
        date: '2026-03-10',
        partyAccountId: kisan,
        cashBankAccountId: cash,
        amountPaise: 9999
      })
    ).toThrow(/own screen/i)
    expect(db().select().from(voucher).all()[0].voidedAt).toBeNull()
  })
})

/**
 * A 'loan' tag is a link to one loan, not a label. The Loans screen reads `loan_event`, so a
 * loan-tagged receipt that merely posted to the ledger would move the party's balance and leave
 * the loan's outstanding untouched — the bug these guards exist to prevent.
 */
describe('createReceipt tagged loan', () => {
  const LAKH = 10000000 // ₹1,00,000
  let loanId: number

  beforeEach(() => {
    loanId = createLoan(yearId, {
      category: 'kisan',
      accountId: kisan,
      date: '2026-01-01',
      amountPaise: LAKH,
      mode: 'cash',
      nature: 'direct'
    }).loanId
  })

  it('drives the loan itself, not just the ledger', () => {
    const cashAc = getSystemAccountId(SYSTEM_ACCOUNTS.CASH)
    const { voucherNo } = createReceipt({
      yearId,
      date: '2026-01-01', // same day as the loan → no interest yet, so the maths stays obvious
      partyAccountId: kisan,
      cashBankAccountId: cashAc,
      amountPaise: 2500000, // ₹25,000
      tag: 'loan',
      loanId
    })
    expect(voucherNo).toBeGreaterThan(0)
    // The loan moved: ₹1,00,000 − ₹25,000.
    expect(outstandingAsOf(loanId, '2026-01-01').outstandingPaise).toBe(7500000)
    // …and so did the books, in step.
    expect(getAccountBalance(kisan, yearId)).toBe(7500000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('refuses a loan tag with no loan named', () => {
    expect(() =>
      createReceipt({
        yearId,
        date: '2026-02-01',
        partyAccountId: kisan,
        cashBankAccountId: cash,
        amountPaise: 2500000,
        tag: 'loan'
      })
    ).toThrow(/which loan/i)
  })

  it("refuses a loan belonging to a different party", () => {
    const other = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
    expect(() =>
      createReceipt({
        yearId,
        date: '2026-02-01',
        partyAccountId: other,
        cashBankAccountId: getSystemAccountId(SYSTEM_ACCOUNTS.CASH),
        amountPaise: 2500000,
        tag: 'loan',
        loanId
      })
    ).toThrow(/different party/i)
  })

  it('refuses money lent out as a payment voucher — that is a disbursement', () => {
    expect(() =>
      createPayment({
        yearId,
        date: '2026-02-01',
        partyAccountId: kisan,
        cashBankAccountId: cash,
        amountPaise: 2500000,
        tag: 'loan'
      })
    ).toThrow(/Loans screen/i)
  })

  it('refuses to re-tag an existing manual receipt as Loan', () => {
    const { voucherId } = createReceipt({
      yearId,
      date: '2026-02-01',
      partyAccountId: kisan,
      cashBankAccountId: cash,
      amountPaise: 2500000
    })
    expect(() =>
      updateManualVoucher(yearId, voucherId, {
        type: 'receipt',
        date: '2026-02-01',
        partyAccountId: kisan,
        cashBankAccountId: cash,
        amountPaise: 2500000,
        tag: 'loan'
      })
    ).toThrow(/Loans screen/i)
    expect(db().select().from(voucher).all().find((v) => v.id === voucherId)!.voidedAt).toBeNull()
  })
})

/**
 * Undo is the "reverse this from its own screen" that `voidManualVoucher` points at. The loan must
 * land exactly where it started — both in the engine's outstanding and in the books.
 */
describe('undoPayment', () => {
  const LAKH = 10000000 // ₹1,00,000
  let loanId: number
  let cashAc: number

  beforeEach(() => {
    cashAc = getSystemAccountId(SYSTEM_ACCOUNTS.CASH)
    loanId = createLoan(yearId, {
      category: 'kisan',
      accountId: kisan,
      date: '2026-01-01',
      amountPaise: LAKH,
      mode: 'cash',
      nature: 'direct'
    }).loanId
  })

  const pay = (date: string, amountPaise: number): number => {
    createReceipt({
      yearId,
      date,
      partyAccountId: kisan,
      cashBankAccountId: cashAc,
      amountPaise,
      tag: 'loan',
      loanId
    })
    const events = db().select().from(loanEvent).where(eq(loanEvent.loanId, loanId)).all()
    return events.reduce((a, e) => (e.id > a.id ? e : a)).id
  }

  it('puts the loan and the books back exactly as they were', () => {
    // A payment two months in, so real interest is folded and has to come back out too.
    const before = outstandingAsOf(loanId, '2026-03-01').outstandingPaise
    const beforeCash = getAccountBalance(cashAc, yearId)
    const eventId = pay('2026-03-01', 2500000) // ₹25,000
    expect(outstandingAsOf(loanId, '2026-03-01').outstandingPaise).not.toBe(before)

    undoPayment(eventId)

    expect(outstandingAsOf(loanId, '2026-03-01').outstandingPaise).toBe(before)
    expect(getAccountBalance(kisan, yearId)).toBe(LAKH) // owes the full principal again
    expect(getAccountBalance(cashAc, yearId)).toBe(beforeCash) // the money never arrived
    expect(getTrialBalance(yearId).balanced).toBe(true)
    // The event is gone, but the voucher survives voided — the audit trail keeps its entries.
    expect(db().select().from(loanEvent).where(eq(loanEvent.id, eventId)).get()).toBeUndefined()
    const voided = db().select().from(voucher).all().filter((v) => v.voidedAt !== null)
    expect(voided).toHaveLength(1)
    expect(voided[0].voidedReason).toMatch(/undone/i)
  })

  it('interest keeps running from the base it had before, as if the payment never happened', () => {
    const eventId = pay('2026-03-01', 2500000)
    undoPayment(eventId)
    // Untouched loan: ₹1,00,000 at 1.5%/mo simple for 6 months = ₹9,000.
    expect(outstandingAsOf(loanId, '2026-07-01').outstandingPaise).toBe(10900000)
  })

  it('refuses when a later entry was computed on top of it', () => {
    const first = pay('2026-03-01', 2500000)
    pay('2026-04-01', 1000000)
    expect(() => undoPayment(first)).toThrow(/undo those first/i)
    // …and the newest one still comes out cleanly, so undoing newest-first works.
    const newest = db()
      .select()
      .from(loanEvent)
      .where(eq(loanEvent.loanId, loanId))
      .all()
      .reduce((a, e) => (e.id > a.id ? e : a)).id
    undoPayment(newest)
    undoPayment(first)
    expect(outstandingAsOf(loanId, '2026-03-01').outstandingPaise).toBe(
      outstandingAsOf(loanId, '2026-03-01').principalPaise +
        outstandingAsOf(loanId, '2026-03-01').accruedInterestPaise
    )
    expect(getAccountBalance(kisan, yearId)).toBe(LAKH)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('refuses to undo a disbursement — only a payment', () => {
    const disbursement = db()
      .select()
      .from(loanEvent)
      .where(eq(loanEvent.loanId, loanId))
      .all()
      .find((e) => e.type === 'disbursement')!
    expect(() => undoPayment(disbursement.id)).toThrow(/not one/i)
  })

  it('refuses a cheque repayment — that unwinds by bouncing the cheque', () => {
    const bank = makeAccount('HDFC Bank', 'bank', 'Cash and Bank')
    recordPayment(loanId, 2500000, '2026-03-01', 'cheque', bank, undefined, { no: '000123' })
    const eventId = db()
      .select()
      .from(loanEvent)
      .where(eq(loanEvent.loanId, loanId))
      .all()
      .reduce((a, e) => (e.id > a.id ? e : a)).id
    expect(() => undoPayment(eventId)).toThrow(/Cheques screen/i)
  })

  it('refuses to undo the same payment twice', () => {
    const eventId = pay('2026-03-01', 2500000)
    undoPayment(eventId)
    expect(() => undoPayment(eventId)).toThrow(/not found/i)
  })
})
