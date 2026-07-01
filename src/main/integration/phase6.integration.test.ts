import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../data/db'
import { financialYear } from '../data/schema'
import { groupId, makeAccount, makeYear, setupDb } from '../test-utils'
import { createAccount, createPerson } from '../services/accounts'
import { createAamad } from '../services/aamad'
import { createNikasi } from '../services/nikasi'
import { createLoan, listLoans } from '../services/loans'
import { accrueRent } from '../engines/bhada'
import { getAccountBalance, getTrialBalance } from '../services/ledger'
import { closeYear, getCloseStatus, rollbackClose } from '../engines/close-year'

/**
 * Phase 6 capstone — a full operating year then a year-end close, an undo, and a re-close. A kisan
 * stores and sells to a vyapari, a loan runs alongside; closing capitalises the loan, carries every
 * balance into 2027, reclassifies dues as indirect loans, and flags defaulters. The **trial balance
 * nets to zero at every checkpoint**, in both years, and a rollback restores the prior state.
 */
describe('Phase 6 done/verify — close a worked year, roll it back, re-close', () => {
  beforeEach(() => setupDb())
  afterEach(() => closeDb())

  function nextYearId(): number {
    return db().select().from(financialYear).where(eq(financialYear.year, 2027)).get()!.id
  }

  it('carries balances forward, capitalises, makes indirect loans, and reverses cleanly', () => {
    const yearId = makeYear(2026, 1000) // ₹10 / packet rent
    const personId = createPerson({ name: 'Hari', villageCity: 'Kasganj' })
    const kisan = createAccount({ name: 'Hari (K)', type: 'kisan', subgroupId: groupId('Farmer'), personId })
    const hariVyapari = createAccount({
      name: 'Hari (V)',
      type: 'vyapari',
      subgroupId: groupId('Sundry Debtors'),
      personId
    })
    const gopal = makeAccount('Gopal Vyapari', 'vyapari', 'Sundry Debtors')

    // Kisan stores 200 packets (₹2,000 rent), sells 80 @ ₹400 to Gopal (₹32,000 proceeds).
    createAamad(yearId, {
      serial: 1,
      date: '2026-01-08',
      kisanAccountId: kisan,
      totalPackets: 200,
      locations: [{ room: 1, floor: 1, rack: 1, packets: 200 }]
    })
    accrueRent(kisan, yearId, '2026-06-30')
    createNikasi(yearId, {
      date: '2026-04-15',
      deliveredToType: 'vyapari',
      deliveredToAccountId: gopal,
      lines: [{ fromKisanAccountId: kisan, room: 1, floor: 1, rack: 1, packets: 80, ratePaise: 40000 }]
    })
    // Hari (as a vyapari) takes a ₹20,000 direct loan on 1 Jan.
    createLoan(yearId, {
      category: 'vyapari',
      accountId: hariVyapari,
      date: '2026-01-01',
      amountPaise: 2000000,
      mode: 'cash',
      nature: 'direct'
    })
    expect(getTrialBalance(yearId).balanced).toBe(true)

    // --- Close 2026 ---
    const res = closeYear(yearId)
    const ny = nextYearId()

    // Loan interest capitalised: ₹3,600 (12 × 1.5% of ₹20,000).
    expect(res.summary.interestCapitalisedPaise).toBe(360000)
    expect(getAccountBalance(hariVyapari, yearId)).toBe(2360000)

    // Four non-zero accounts carried (the 3 parties + Cash, overdrawn ₹20,000 from the cash loan);
    // dues = Gopal ₹32,000 + Hari(V) ₹23,600; credit (trade parties) = Hari(K) ₹30,000.
    expect(res.summary.accountsCarried).toBe(4)
    expect(res.summary.totalDuesPaise).toBe(3200000 + 2360000)
    expect(res.summary.totalCreditsPaise).toBe(3000000)
    expect(res.summary.indirectLoans).toBe(2)
    expect(res.summary.newDefaulters).toBe(2)
    expect(res.summary.leftoverPackets).toBe(120) // 200 stored − 80 sold

    // Both years' books tie after the close.
    expect(getTrialBalance(yearId).balanced).toBe(true)
    expect(getTrialBalance(ny).balanced).toBe(true)
    // Carried opening reproduces the closing balances in the new year.
    expect(getAccountBalance(gopal, ny)).toBe(3200000)
    expect(getAccountBalance(kisan, ny)).toBe(-3000000)
    expect(listLoans(ny)).toHaveLength(2)

    // --- Roll it back ---
    rollbackClose(yearId)
    expect(getCloseStatus(yearId)).toBeNull()
    expect(getAccountBalance(hariVyapari, yearId)).toBe(2000000) // capitalisation undone
    expect(listLoans(ny)).toHaveLength(0)
    expect(getTrialBalance(yearId).balanced).toBe(true)
    expect(getTrialBalance(ny).totalDr).toBe(0)

    // --- Re-close: a fresh, identical close ---
    const res2 = closeYear(yearId)
    expect(res2.summary.totalDuesPaise).toBe(3200000 + 2360000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
    expect(getTrialBalance(nextYearId()).balanced).toBe(true)
  })
})
