import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../data/db'
import { account, financialYear, openingBalance } from '../data/schema'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { createAamad } from '../services/aamad'
import { accrueRent } from './bhada'
import { createLoan, getLoanComposition, listLoans } from '../services/loans'
import { setOpeningBalance } from '../services/accounts'
import { recordCheque } from './cheque-clearing'
import { getAccountBalance, getTrialBalance } from '../services/ledger'
import { getMap } from '../services/maps'
import { closeYear, getCloseStatus, previewClose, rollbackClose } from './close-year'

const LAKH = 10000000 // ₹1,00,000 in paise

/**
 * Close-Year engine (software.md §3.13). A 2026 year with a kisan owing rent, a vyapari with a
 * direct loan, and a creditor with an opening credit. Closing should: capitalise the loan, carry
 * every balance into 2027, turn dues into indirect loans, flag defaulters, report leftover stock —
 * and roll back cleanly. Trial balance nets to zero throughout.
 */
let yearId: number
let kisan: number
let vyapari: number
let creditor: number

function nextYearId(): number {
  return db().select().from(financialYear).where(eq(financialYear.year, 2027)).get()!.id
}
function isDefaulter(id: number): boolean {
  return db().select({ d: account.isDefaulter }).from(account).where(eq(account.id, id)).get()!.d
}
function openingRows(yId: number): Array<typeof openingBalance.$inferSelect> {
  return db().select().from(openingBalance).where(eq(openingBalance.yearId, yId)).all()
}

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026, 1000) // ₹10 / packet / year rent
  kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
  vyapari = makeAccount('Suresh Vyapari', 'vyapari', 'Sundry Debtors')
  creditor = makeAccount('Mohan Supplier', 'other', 'Sundry Creditors')

  // Kisan stores 200 packets → owes ₹2,000 full-year rent (Dr 200,000 paise).
  createAamad(yearId, {
    serial: 1,
    date: '2026-01-08',
    kisanAccountId: kisan,
    totalPackets: 200,
    locations: [{ room: 1, floor: 1, rack: 1, packets: 200 }]
  })
  accrueRent(kisan, yearId, '2026-06-30')

  // Vyapari takes a ₹1,00,000 direct loan on 1 Jan → capitalises to +₹18,000 at 1 Jan 2027.
  createLoan(yearId, {
    category: 'vyapari',
    accountId: vyapari,
    date: '2026-01-01',
    amountPaise: LAKH,
    mode: 'cash',
    nature: 'direct'
  })

  // Creditor: the cold owes him ₹5,000 (opening credit).
  setOpeningBalance(creditor, yearId, 500000, 'cr', '2026-01-01')
})
afterEach(() => closeDb())

describe('previewClose — the dry run', () => {
  it('projects the post-capitalisation numbers without posting', () => {
    const before = getTrialBalance(yearId)
    const p = previewClose(yearId)

    expect(p.alreadyClosed).toBe(false)
    // Capitalisation is projected but NOT posted — the books are untouched by a preview.
    expect(getTrialBalance(yearId).totalDr).toBe(before.totalDr)
    expect(p.summary.accountsCarried).toBe(4) // kisan + vyapari + creditor + Cash (loan paid out in cash)
    expect(p.summary.totalDuesPaise).toBe(LAKH + 1800000 + 200000) // vyapari 1,18,000 + kisan 2,000
    expect(p.summary.totalCreditsPaise).toBe(500000)
    expect(p.summary.loansCapitalised).toBe(1)
    expect(p.summary.interestCapitalisedPaise).toBe(1800000)
    expect(p.summary.indirectLoans).toBe(2) // the two owing parties
    expect(p.summary.indirectLoanTotalPaise).toBe(LAKH + 1800000 + 200000)
    expect(p.summary.newDefaulters).toBe(2)
    expect(p.summary.leftoverPackets).toBe(200)
    // A creditor (Cr balance) shows up as an exception.
    expect(p.exceptions.some((e) => e.kind === 'credit_balance' && e.accountId === creditor)).toBe(true)
    expect(p.exceptions.some((e) => e.kind === 'leftover_stock')).toBe(true)
  })
})

describe('closeYear — the real close', () => {
  it('capitalises, carries forward, creates indirect loans, flags defaulters, reports leftover', () => {
    const res = closeYear(yearId)

    // Summary matches the preview projection to the paise.
    expect(res.summary.accountsCarried).toBe(4)
    expect(res.summary.totalDuesPaise).toBe(LAKH + 1800000 + 200000)
    expect(res.summary.totalCreditsPaise).toBe(500000)
    expect(res.summary.loansCapitalised).toBe(1)
    expect(res.summary.interestCapitalisedPaise).toBe(1800000)
    expect(res.summary.indirectLoans).toBe(2)
    expect(res.summary.indirectLoanTotalPaise).toBe(LAKH + 1800000 + 200000)
    expect(res.summary.newDefaulters).toBe(2)
    expect(res.summary.leftoverPackets).toBe(200)

    // Capitalisation posted into the closing year: vyapari now owes ₹1,18,000.
    expect(getAccountBalance(vyapari, yearId)).toBe(LAKH + 1800000)
    // Both years' books still tie.
    expect(getTrialBalance(yearId).balanced).toBe(true)
    const ny = nextYearId()
    expect(getTrialBalance(ny).balanced).toBe(true)

    // Carry-forward: an opening_balance row per non-zero balance-sheet account in the new year
    // (the 3 parties + Cash, which is overdrawn ₹1,00,000 from paying the loan out in cash).
    const rows = openingRows(ny)
    expect(rows).toHaveLength(4)
    const kisanOpen = rows.find((r) => r.accountId === kisan)!
    expect(kisanOpen.amountPaise).toBe(200000)
    expect(kisanOpen.drCr).toBe('dr')
    const vyapariOpen = rows.find((r) => r.accountId === vyapari)!
    expect(vyapariOpen.amountPaise).toBe(LAKH + 1800000)
    expect(vyapariOpen.drCr).toBe('dr')
    const creditorOpen = rows.find((r) => r.accountId === creditor)!
    expect(creditorOpen.amountPaise).toBe(500000)
    expect(creditorOpen.drCr).toBe('cr')
    // Cash (a system account) carries forward too — its balance is real money on hand.
    const cashId = db().select({ id: account.id }).from(account).where(eq(account.name, 'Cash')).get()!.id
    const cashOpen = rows.find((r) => r.accountId === cashId)!
    expect(cashOpen.amountPaise).toBe(LAKH)
    expect(cashOpen.drCr).toBe('cr')
    // The carried opening reproduces the closing balance in the new year.
    expect(getAccountBalance(vyapari, ny)).toBe(LAKH + 1800000)

    // Indirect loans for the new year: interest-free this year, accruing from 1 Jan 2027.
    const newLoans = listLoans(ny)
    expect(newLoans).toHaveLength(2)
    for (const l of newLoans) {
      expect(l.nature).toBe('indirect')
      expect(l.interestStartDate).toBe('2027-01-01')
    }
    expect(newLoans.find((l) => l.accountId === vyapari)!.principalPaise).toBe(LAKH + 1800000)
    expect(newLoans.find((l) => l.accountId === kisan)!.principalPaise).toBe(200000)

    // Defaulters: the two owing parties, not the creditor.
    expect(isDefaulter(kisan)).toBe(true)
    expect(isDefaulter(vyapari)).toBe(true)
    expect(isDefaulter(creditor)).toBe(false)

    // The new year's maps are empty (no aamad/nikasi carried).
    expect(getMap(ny, 'current').totalPackets).toBe(0)

    // The year is now flagged closed.
    expect(getCloseStatus(yearId)!.status).toBe('closed')
    expect(db().select().from(financialYear).where(eq(financialYear.id, yearId)).get()!.status).toBe('closed')
  })

  it('refuses to close an already-closed year', () => {
    closeYear(yearId)
    expect(() => closeYear(yearId)).toThrow(/already closed/)
  })
})

describe('rollbackClose — the undo', () => {
  it('restores the pre-close state exactly', () => {
    const before = getTrialBalance(yearId)
    const beforeVyapariBalance = getAccountBalance(vyapari, yearId) // ₹1,00,000 (no interest yet)

    closeYear(yearId)
    const ny = nextYearId()
    expect(openingRows(ny)).toHaveLength(4) // 3 parties + Cash
    expect(listLoans(ny)).toHaveLength(2)

    rollbackClose(yearId)

    // The year reopened; no active close remains.
    expect(getCloseStatus(yearId)).toBeNull()
    expect(db().select().from(financialYear).where(eq(financialYear.id, yearId)).get()!.status).toBe('open')

    // Carry-forwards, indirect loans, capitalisation and defaulter flags are all reversed.
    expect(openingRows(ny)).toHaveLength(0)
    expect(listLoans(ny)).toHaveLength(0)
    expect(getAccountBalance(vyapari, yearId)).toBe(beforeVyapariBalance) // capitalisation undone
    expect(isDefaulter(kisan)).toBe(false)
    expect(isDefaulter(vyapari)).toBe(false)

    // Both years tie again, and the closing year matches its pre-close total.
    expect(getTrialBalance(yearId).balanced).toBe(true)
    expect(getTrialBalance(yearId).totalDr).toBe(before.totalDr)
    expect(getTrialBalance(ny).balanced).toBe(true)
    expect(getTrialBalance(ny).totalDr).toBe(0)
  })

  it('can re-close after a rollback', () => {
    closeYear(yearId)
    rollbackClose(yearId)
    const res = closeYear(yearId) // fresh close + plan
    expect(res.summary.accountsCarried).toBe(4)
    expect(getCloseStatus(yearId)!.status).toBe('closed')
    expect(getTrialBalance(yearId).balanced).toBe(true)
    expect(getTrialBalance(nextYearId()).balanced).toBe(true)
  })
})

describe('getLoanComposition — what a carried indirect loan is made of', () => {
  it('breaks a carried indirect loan into its source-year tags, summing to the principal', () => {
    closeYear(yearId)
    const ny = nextYearId()
    const loans = listLoans(ny)
    const vyapariLoan = loans.find((l) => l.accountId === vyapari)!
    const kisanLoan = loans.find((l) => l.accountId === kisan)!

    // Vyapari: ₹1,00,000 loan principal + ₹18,000 capitalised interest = ₹1,18,000.
    const vComp = getLoanComposition(vyapariLoan.id)!
    expect(vComp.sourceYear).toBe(2026)
    expect(vComp.totalPaise).toBe(LAKH + 1800000)
    expect(vComp.totalPaise).toBe(vyapariLoan.principalPaise)
    const vByTag = Object.fromEntries(vComp.lines.map((l) => [l.tag, l.paise]))
    expect(vByTag.loan).toBe(LAKH)
    expect(vByTag.interest).toBe(1800000)

    // Kisan: pure ₹2,000 rent.
    const kComp = getLoanComposition(kisanLoan.id)!
    expect(kComp.totalPaise).toBe(200000)
    expect(Object.fromEntries(kComp.lines.map((l) => [l.tag, l.paise])).rent).toBe(200000)
  })

  it('returns null for a manually-created (non-carry-forward) indirect loan', () => {
    const { loanId } = createLoan(yearId, {
      category: 'other',
      accountId: creditor,
      date: '2026-03-01',
      amountPaise: 50000,
      mode: 'cash',
      nature: 'indirect'
    })
    expect(getLoanComposition(loanId)).toBeNull()
  })
})

describe('exceptions', () => {
  it('flags a pending cheque', () => {
    // A received cheque sits in clearing — it is a close-time exception until cleared.
    const bank = makeAccount('HDFC Bank', 'bank', 'Cash and Bank')
    recordCheque(yearId, {
      direction: 'received',
      partyAccountId: vyapari,
      bankAccountId: bank,
      amountPaise: 100000,
      no: 'CHQ-1'
    })
    const p = previewClose(yearId)
    expect(p.exceptions.some((e) => e.kind === 'pending_cheque' && e.accountId === vyapari)).toBe(true)
  })
})

describe('cash & bank carry-forward (regression)', () => {
  // A user-created bank account is non-system but lives in 'Cash and Bank'. The close must carry
  // its balance forward as a plain opening, and must NOT mistake it for an owing party (no indirect
  // loan, no defaulter flag). Cash (a system account) must carry too. Earlier the close keyed off
  // the crude isSystem flag, dropping Cash and turning bank accounts into loans + defaulters.
  it('carries bank/cash balances but never loans or flags them', () => {
    const bank = makeAccount('SBI Current A/c', 'bank', 'Cash and Bank')
    setOpeningBalance(bank, yearId, 5000000, 'dr', '2026-01-01') // ₹50,000 sitting in the bank

    closeYear(yearId)
    const ny = nextYearId()

    // Bank balance carries forward as a Dr opening…
    const bankOpen = openingRows(ny).find((r) => r.accountId === bank)!
    expect(bankOpen.amountPaise).toBe(5000000)
    expect(bankOpen.drCr).toBe('dr')
    // …Cash carries too (overdrawn ₹1,00,000 from the cash loan)…
    const cashId = db().select({ id: account.id }).from(account).where(eq(account.name, 'Cash')).get()!.id
    expect(openingRows(ny).some((r) => r.accountId === cashId)).toBe(true)

    // …but neither bank nor cash becomes an indirect loan or a defaulter.
    expect(listLoans(ny).some((l) => l.accountId === bank)).toBe(false)
    expect(listLoans(ny).some((l) => l.accountId === cashId)).toBe(false)
    expect(isDefaulter(bank)).toBe(false)
    expect(isDefaulter(cashId)).toBe(false)

    // Bank dues don't inflate the dues/indirect-loan totals — still just the 2 real owing parties.
    expect(getCloseStatus(yearId)!.summary.indirectLoans).toBe(2)
    expect(getTrialBalance(ny).balanced).toBe(true)
  })
})
