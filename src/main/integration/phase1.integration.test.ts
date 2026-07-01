import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { createAccount, setOpeningBalance } from '../services/accounts'
import { groupId } from '../test-utils'
import { createReceipt } from '../services/vouchers'
import { getTrialBalance } from '../services/ledger'
import { getSummary } from '../services/moneybook'

/**
 * Phase 1 capstone — the §6 done/verify checklist as one end-to-end scenario:
 * create accounts → post a receipt → net-zero trial balance → money book matches.
 * This is the proof the books tie before any Phase 2 stock feature sits on top.
 */
describe('Phase 1 done/verify', () => {
  beforeEach(() => setupDb())
  afterEach(() => closeDb())

  it('creates accounts, posts a receipt, and ties the trial balance + money book', () => {
    const yearId = makeYear(2026)

    // Accounts: a Kisan, a Vyapari, and the seeded Cash book.
    const kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
    const vyapari = createAccount({
      name: 'Mohan Vyapari',
      type: 'vyapari',
      subgroupId: groupId('Sundry Debtors')
    })
    const cash = getSystemAccountId(SYSTEM_ACCOUNTS.CASH)

    // Opening balances: kisan owes nothing yet; give the cash book a float.
    setOpeningBalance(cash, yearId, 1000000, 'dr', '2026-01-01') // ₹10,000 opening cash
    setOpeningBalance(kisan, yearId, 500000, 'dr', '2026-01-01') // kisan carried ₹5,000 Dr

    // A vyapari pays the cold ₹25,000 cash → Cash Dr / Vyapari Cr.
    createReceipt({
      yearId,
      date: '2026-03-12',
      partyAccountId: vyapari,
      cashBankAccountId: cash,
      amountPaise: 2500000
    })

    // Trial balance must net to zero.
    const tb = getTrialBalance(yearId)
    expect(tb.balanced).toBe(true)
    expect(tb.totalDr).toBe(tb.totalCr)

    // Money book: opening float shows in the opening column; the receipt lands in March.
    const book = getSummary(cash, yearId)
    expect(book.openingPaise).toBe(1000000)
    const march = book.months.find((m) => m.month === 3)!
    expect(march.receiptsPaise).toBe(2500000)
    // Cash closing = opening 10,000 + receipt 25,000 = ₹35,000.
    expect(book.closingPaise).toBe(3500000)
  })
})
