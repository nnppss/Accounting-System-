import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { groupId, makeAccount, makeYear, setupDb } from '../test-utils'
import { createAccount, createPerson } from '../services/accounts'
import { createAamad } from '../services/aamad'
import { createNikasi } from '../services/nikasi'
import { createLoan } from '../services/loans'
import { accrueRent } from '../engines/bhada'
import { getTrialBalance } from '../services/ledger'
import { getBill, listBillSubjects } from '../services/bills'
import { searchParty } from '../services/party'

/**
 * Phase 5 capstone — the read layers over a multi-role person:
 *   one human is both a kisan (stores + sells) and a vyapari (takes a loan). The Bill must show a
 *   section per role, live loan interest, and a single combined net; Party search must find them.
 *   Phase 5 posts nothing, so the trial balance stays net-zero throughout.
 */
describe('Phase 5 done/verify — Bills + Party over a multi-role person', () => {
  beforeEach(() => setupDb())
  afterEach(() => closeDb())

  it('produces a correct multi-role bill, combined net, and party hit', () => {
    const yearId = makeYear(2026, 1000) // ₹10 / packet rent
    const personId = createPerson({ name: 'Hari', villageCity: 'Kasganj', phone: '70001' })
    const kisan = createAccount({ name: 'Hari (K)', type: 'kisan', subgroupId: groupId('Farmer'), personId })
    const vyapari = createAccount({
      name: 'Hari (V)',
      type: 'vyapari',
      subgroupId: groupId('Sundry Debtors'),
      personId
    })
    const buyer = makeAccount('Gopal Vyapari', 'vyapari', 'Sundry Debtors')

    // Kisan stores 200, charged full-year rent (₹2,000), sells 80 @ ₹400 (= ₹32,000 proceeds).
    const lot = createAamad(yearId, {
      date: '2026-01-08',
      kisanAccountId: kisan,
      totalPackets: 200,
      locations: [{ room: 1, floor: 1, rack: 1, packets: 200 }]
    })
    accrueRent(kisan, yearId, '2026-06-30')
    createNikasi(yearId, {
      date: '2026-04-15',
      deliveredToType: 'vyapari',
      deliveredToAccountId: buyer,
      // Rate is per 105 kg; 80 × 105 kg keeps proceeds = 80 × ₹400 = ₹32,000.
      lines: [{ aamadId: lot, packets: 80, weightKg: 80 * 105, ratePaise: 40000 }]
    })
    expect(getTrialBalance(yearId).balanced).toBe(true)

    // Vyapari side: a ₹20,000 direct loan on 1 Jan.
    createLoan(yearId, {
      category: 'vyapari',
      accountId: vyapari,
      date: '2026-01-01',
      amountPaise: 2000000,
      mode: 'cash',
      nature: 'direct'
    })
    expect(getTrialBalance(yearId).balanced).toBe(true)

    const bill = getBill(vyapari, yearId, '2026-07-01')!
    expect(bill.sections).toHaveLength(2)
    const k = bill.sections.find((s) => s.role === 'kisan')!
    const v = bill.sections.find((s) => s.role === 'vyapari')!

    // Kisan net = ₹2,000 rent − ₹32,000 proceeds = −₹30,000.
    expect(k.standingBhadaPaise).toBe(200000)
    expect(k.netPaise).toBe(-3000000)
    // Vyapari net = ₹20,000 principal + 6 months simple interest (₹1,800) = ₹21,800.
    expect(v.unpostedInterestPaise).toBe(180000)
    expect(v.netPaise).toBe(2180000)
    // Combined = −30,000 + 21,800 = −₹8,200.
    expect(bill.combinedNetPaise).toBe(-820000)

    // The Bills index groups both roles under Hari.
    const subjects = listBillSubjects(yearId, '2026-07-01')
    const hari = subjects.find((s) => s.personId === personId)!
    expect(hari.roles.sort()).toEqual(['kisan', 'vyapari'])
    expect(hari.netPaise).toBe(-820000)

    // Party search finds Hari's vyapari account by its live loan outstanding.
    const withLoan = searchParty(yearId, { hasLoan: true }, '2026-07-01')
    expect(withLoan.rows.map((r) => r.accountId)).toContain(vyapari)
    expect(withLoan.rows.find((r) => r.accountId === vyapari)!.loanOutstandingPaise).toBe(2180000)

    // Phase 5 itself posted nothing — books still tie.
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })
})
