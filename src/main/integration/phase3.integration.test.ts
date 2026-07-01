import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { getAccountBalance, getTrialBalance } from '../services/ledger'
import { getSummary } from '../services/moneybook'
import { createLoan, getStandingLoan, recordPayment } from '../services/loans'
import { post } from '../services/posting'
import { capitaliseLoan, outstandingAsOf } from '../engines/interest'
import { clearCheque, recordCheque } from '../engines/cheque-clearing'

/**
 * Phase 3 capstone — money depth end-to-end:
 *   loan given → interest capitalised across a 1-Jan boundary → part-payment → cheque clears.
 * The trial balance must stay net-zero at every checkpoint.
 */
describe('Phase 3 done/verify — loans + interest + cheque clearance', () => {
  beforeEach(() => setupDb())
  afterEach(() => closeDb())

  it('runs loan → capitalise → part-payment → cheque clearance and ties throughout', () => {
    const LAKH = 10000000 // ₹1,00,000
    const yearId = makeYear(2026)
    const kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
    const vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
    const bank = makeAccount('HDFC Bank', 'other', 'Cash and Bank')
    const cash = getSystemAccountId(SYSTEM_ACCOUNTS.CASH)

    // 1) Loan given: ₹1,00,000 cash to the kisan on 1 Jan 2026 (Dr Kisan / Cr Cash).
    const { loanId } = createLoan(yearId, {
      category: 'kisan',
      accountId: kisan,
      date: '2026-01-01',
      amountPaise: LAKH,
      mode: 'cash',
      nature: 'direct'
    })
    expect(getAccountBalance(kisan, yearId)).toBe(LAKH) // owes ₹1,00,000
    expect(getAccountBalance(cash, yearId)).toBe(-LAKH) // cash went out
    expect(getTrialBalance(yearId).balanced).toBe(true)

    // 2) Capitalise across the 1-Jan boundary: ₹18,000 interest → standing ₹1,18,000.
    expect(capitaliseLoan(loanId, '2027-01-01')!.interestPaise).toBe(1800000)
    expect(getStandingLoan(kisan, yearId).standingPaise).toBe(11800000)
    expect(getTrialBalance(yearId).balanced).toBe(true)

    // 3) Part-payment ₹50,000 cash on 1 Mar 2027: 2 months interest on ₹1,18,000 = ₹3,540.
    const pay = recordPayment(loanId, 5000000, '2027-03-01', 'cash', undefined)
    expect(pay.interestPaise).toBe(354000)
    // Standing = 1,00,000 + 18,000 + 3,540 − 50,000 = ₹71,540; the engine agrees.
    expect(getStandingLoan(kisan, yearId).standingPaise).toBe(7154000)
    expect(outstandingAsOf(loanId, '2027-03-01').outstandingPaise).toBe(7154000)
    expect(getTrialBalance(yearId).balanced).toBe(true)

    // 4) The vyapari owes the cold ₹40,000 for the kisan's potatoes (a trade sale)…
    post({
      yearId,
      type: 'journal',
      date: '2027-03-05',
      entries: [
        { accountId: vyapari, drPaise: 4000000, crPaise: 0, tag: 'trade' },
        { accountId: kisan, drPaise: 0, crPaise: 4000000, tag: 'trade' }
      ]
    })
    expect(getAccountBalance(vyapari, yearId)).toBe(4000000)

    // …and pays it by cheque — pending stays out of the bank, then clears in and settles him.
    const { chequeId } = recordCheque(yearId, {
      direction: 'received',
      partyAccountId: vyapari,
      bankAccountId: bank,
      amountPaise: 4000000,
      no: 'CHQ-1'
    })
    expect(getAccountBalance(vyapari, yearId)).toBe(0) // cheque settled his account on entry
    expect(getSummary(bank, yearId).closingPaise).toBe(0) // …but it is not in the bank yet
    expect(getTrialBalance(yearId).balanced).toBe(true)

    clearCheque(chequeId, '2027-03-10')
    expect(getSummary(bank, yearId).closingPaise).toBe(4000000) // ₹40,000 now in the bank
    expect(getAccountBalance(vyapari, yearId)).toBe(0) // unchanged by clearance
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })
})
