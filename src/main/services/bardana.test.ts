import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { getAccountBalance, getAccountLedger, getTrialBalance } from './ledger'
import { getSummary } from './moneybook'
import { listVouchers } from './vouchers'
import { createBardana, deliverBardana, getBardanaAccount } from './bardana'

let yearId: number
let cash: number
let bardanaPurchase: number
let bardanaSales: number

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  cash = getSystemAccountId(SYSTEM_ACCOUNTS.CASH)
  bardanaPurchase = getSystemAccountId(SYSTEM_ACCOUNTS.BARDANA_PURCHASE)
  bardanaSales = getSystemAccountId(SYSTEM_ACCOUNTS.BARDANA_SALES)
})
afterEach(() => closeDb())

describe('Bardana sub-ledger (software.md §3.7)', () => {
  it('purchase posts Dr Bardana Purchase / Cr Cash; amount = rate × qty', () => {
    // 100 pcs @ ₹20 = ₹2,000.
    createBardana(yearId, { direction: 'purchase', date: '2026-02-01', ratePaise: 2000, qty: 100, mode: 'cash' })
    expect(getAccountBalance(bardanaPurchase, yearId)).toBe(200000) // expense Dr
    expect(getAccountBalance(cash, yearId)).toBe(-200000) // cash went out
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('issue posts Dr Cash / Cr Bardana Sales', () => {
    // 60 pcs @ ₹40 = ₹2,400.
    createBardana(yearId, { direction: 'issue', date: '2026-03-01', ratePaise: 4000, qty: 60, mode: 'cash' })
    expect(getAccountBalance(cash, yearId)).toBe(240000) // money in
    expect(getAccountBalance(bardanaSales, yearId)).toBe(-240000) // income Cr
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('A/C: stock count = Σpurchased − Σissued; profit = sales − purchases', () => {
    createBardana(yearId, { direction: 'purchase', date: '2026-02-01', ratePaise: 2000, qty: 100, mode: 'cash' })
    createBardana(yearId, { direction: 'issue', date: '2026-03-01', ratePaise: 4000, qty: 60, mode: 'cash' })
    const acct = getBardanaAccount(yearId)
    expect(acct.purchases).toHaveLength(1)
    expect(acct.issues).toHaveLength(1)
    expect(acct.totalPurchasesPaise).toBe(200000)
    expect(acct.totalSalesPaise).toBe(240000)
    expect(acct.stockCount).toBe(40) // 100 bought − 60 sold
    expect(acct.profitPaise).toBe(40000) // ₹2,400 − ₹2,000 = ₹400
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('a bank-settled bardana hits the bank money book, not cash', () => {
    const bank = makeAccount('HDFC Bank', 'bank', 'Cash and Bank')
    createBardana(yearId, {
      direction: 'issue',
      date: '2026-04-01',
      ratePaise: 5000,
      qty: 10,
      mode: 'bank',
      bankAccountId: bank
    })
    expect(getSummary(bank, yearId).closingPaise).toBe(50000) // ₹500 into the bank
    expect(getAccountBalance(cash, yearId)).toBe(0) // cash untouched
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('a fully-paid deal still shows on the party ledger (sale + payment legs, net 0)', () => {
    const vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
    createBardana(yearId, {
      direction: 'issue',
      date: '2026-04-02',
      partyAccountId: vyapari,
      ratePaise: 3000,
      qty: 20,
      mode: 'cash'
    })
    const acct = getBardanaAccount(yearId)
    expect(acct.issues[0].partyName).toBe('Mohan Vyapari')
    // The full deal is documented on the buyer's ledger: Dr ₹600 (goods) and Cr ₹600 (paid now).
    const lines = getAccountLedger(vyapari, yearId)
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => [l.drPaise, l.crPaise])).toEqual([
      [60000, 0],
      [0, 60000]
    ])
    expect(getAccountBalance(vyapari, yearId)).toBe(0) // fully paid → nothing outstanding
    expect(getAccountBalance(cash, yearId)).toBe(60000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('rejects a bank settlement with no bank account, and non-positive quantity', () => {
    expect(() =>
      createBardana(yearId, { direction: 'purchase', date: '2026-02-01', ratePaise: 2000, qty: 5, mode: 'bank' })
    ).toThrow()
    expect(() =>
      createBardana(yearId, { direction: 'purchase', date: '2026-02-01', ratePaise: 2000, qty: 0, mode: 'cash' })
    ).toThrow()
  })

  it('credit purchase: nothing paid → Dr Bardana Purchase / Cr Supplier (no cash)', () => {
    const supplier = makeAccount('Suresh Supplier', 'vyapari', 'Sundry Creditors')
    // 50 pcs @ ₹20 = ₹1,000, fully on credit.
    createBardana(yearId, {
      direction: 'purchase',
      date: '2026-02-01',
      partyAccountId: supplier,
      ratePaise: 2000,
      qty: 50,
      mode: 'cash',
      paidPaise: 0
    })
    expect(getAccountBalance(bardanaPurchase, yearId)).toBe(100000) // full goods value Dr
    expect(getAccountBalance(supplier, yearId)).toBe(-100000) // we owe the supplier (Cr)
    expect(getAccountBalance(cash, yearId)).toBe(0) // no cash moved
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('remark lands in the voucher narration (readable rate, free-text note)', () => {
    const supplier = makeAccount('Suresh Supplier', 'vyapari', 'Sundry Creditors')
    createBardana(yearId, {
      direction: 'purchase',
      date: '2026-02-01',
      partyAccountId: supplier,
      ratePaise: 5000,
      qty: 1000,
      mode: 'cash',
      paidPaise: 0,
      remark: 'against advance paid 01/07'
    })
    const [v] = listVouchers(yearId)
    expect(v.narration).toBe('Bardana purchase — 1000 pcs @ ₹50/pc — against advance paid 01/07')
  })

  it('partial issue: part cash now, rest owed by the buyer', () => {
    const vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
    // 20 pcs @ ₹30 = ₹600; buyer pays ₹250 now, owes ₹350.
    createBardana(yearId, {
      direction: 'issue',
      date: '2026-04-02',
      partyAccountId: vyapari,
      ratePaise: 3000,
      qty: 20,
      mode: 'cash',
      paidPaise: 25000
    })
    expect(getAccountBalance(cash, yearId)).toBe(25000) // ₹250 received now
    expect(getAccountBalance(vyapari, yearId)).toBe(35000) // ₹350 owed by buyer (Dr)
    expect(getAccountBalance(bardanaSales, yearId)).toBe(-60000) // full ₹600 booked as sales
    const acct = getBardanaAccount(yearId)
    expect(acct.totalSalesPaise).toBe(60000) // A/C aggregates the goods value, not the cash
    expect(acct.issues[0].paidPaise).toBe(25000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('pre-booking: posts like a normal issue, reserves the qty until delivered', () => {
    const kisan = makeAccount('Ram Kisan', 'kisan', 'Sundry Debtors')
    // Stock is zero; kisan pre-books 1000 pcs @ ₹30 fully paid.
    const { bardanaId } = createBardana(yearId, {
      direction: 'issue',
      date: '2026-02-01',
      partyAccountId: kisan,
      ratePaise: 3000,
      qty: 1000,
      mode: 'cash',
      prebooked: true
    })
    expect(getAccountBalance(cash, yearId)).toBe(3000000) // money is real at booking
    let acct = getBardanaAccount(yearId)
    expect(acct.reservedQty).toBe(1000)
    expect(acct.issues[0].prebooked).toBe(true)
    expect(acct.stockCount).toBe(-1000) // owed against future purchases

    deliverBardana(yearId, bardanaId)
    acct = getBardanaAccount(yearId)
    expect(acct.reservedQty).toBe(0)
    expect(acct.issues[0].prebooked).toBe(false)
    expect(getAccountBalance(cash, yearId)).toBe(3000000) // delivery is physical only
    expect(getTrialBalance(yearId).balanced).toBe(true)
    // Can't deliver twice.
    expect(() => deliverBardana(yearId, bardanaId)).toThrow()
  })

  it('rejects a pre-booked purchase, and a pre-booking without a party', () => {
    expect(() =>
      createBardana(yearId, { direction: 'purchase', date: '2026-02-01', ratePaise: 2000, qty: 5, mode: 'cash', prebooked: true })
    ).toThrow()
    expect(() =>
      createBardana(yearId, { direction: 'issue', date: '2026-02-01', ratePaise: 2000, qty: 5, mode: 'cash', prebooked: true })
    ).toThrow()
  })

  it('rejects an unpaid bardana with no party, and paid > amount', () => {
    expect(() =>
      createBardana(yearId, { direction: 'purchase', date: '2026-02-01', ratePaise: 2000, qty: 5, mode: 'cash', paidPaise: 0 })
    ).toThrow()
    expect(() =>
      createBardana(yearId, { direction: 'issue', date: '2026-02-01', ratePaise: 2000, qty: 5, mode: 'cash', paidPaise: 999999 })
    ).toThrow()
  })
})
