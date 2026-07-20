import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { groupId, makeAccount, makeYear, setupDb } from '../test-utils'
import { createAccount, createPerson } from './accounts'
import { createAamad } from './aamad'
import { createNikasi } from './nikasi'
import { createLoan } from './loans'
import { accrueRent } from '../engines/bhada'
import { getTrialBalance } from './ledger'
import { getBill, listBillSubjects } from './bills'

let yearId: number
let personId: number
let kisan: number
let vyapari: number
let buyer: number

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026, 1000) // ₹10 / packet / year rent
  personId = createPerson({ name: 'Ram', villageCity: 'Etah', phone: '99990' })
  kisan = createAccount({ name: 'Ram (Kisan)', type: 'kisan', subgroupId: groupId('Farmer'), personId })
  vyapari = createAccount({
    name: 'Ram (Vyapari)',
    type: 'vyapari',
    subgroupId: groupId('Sundry Debtors'),
    personId
  })
  buyer = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
})
afterEach(() => closeDb())

describe('Bills — person-wise statement (software.md §3.11)', () => {
  function seed(): void {
    // Ram-kisan stores 100 packets, sells 50 @ ₹500, then is charged full-year rent (₹1,000).
    const lot = createAamad(yearId, {
      date: '2026-01-10',
      kisanAccountId: kisan,
      totalPackets: 100,
      locations: [{ room: 1, floor: 1, rack: 1, packets: 100 }]
    })
    createNikasi(yearId, {
      date: '2026-05-01',
      deliveredToType: 'vyapari',
      deliveredToAccountId: buyer,
      // Rate is per 105 kg; 50 × 105 kg keeps proceeds = 50 × ₹500 = ₹25,000.
      lines: [{ aamadId: lot, packets: 50, weightKg: 50 * 105, ratePaise: 50000 }]
    })
    // The nikasi accrued rent on the 50 shipped; the year-end catch-up bills the other 50 too, so
    // the full ₹1,000 rent sits on his books (stored basis).
    accrueRent(kisan, yearId, '2026-06-30', undefined, 'stored')
    // Ram-vyapari takes a direct loan ₹10,000 on 1 Jan (interest accrues from then).
    createLoan(yearId, {
      category: 'vyapari',
      accountId: vyapari,
      date: '2026-01-01',
      amountPaise: 1000000,
      mode: 'cash',
      nature: 'direct'
    })
  }

  it('builds one section per role, with live (un-posted) loan interest, and a combined net', () => {
    seed()
    const bill = getBill(kisan, yearId, '2026-07-01')!
    expect(bill).not.toBeNull()
    expect(bill.personId).toBe(personId)
    expect(bill.name).toBe('Ram')
    expect(bill.subjectKey).toBe(`person:${personId}`)
    expect(bill.sections).toHaveLength(2)

    const kisanSec = bill.sections.find((s) => s.role === 'kisan')!
    const vyapariSec = bill.sections.find((s) => s.role === 'vyapari')!

    // Kisan: +₹1,000 rent − ₹25,000 proceeds = −₹24,000 (the cold owes him); rent still on books.
    expect(kisanSec.postedBalancePaise).toBe(-2400000)
    expect(kisanSec.standingBhadaPaise).toBe(100000)
    expect(kisanSec.unpostedInterestPaise).toBe(0)
    expect(kisanSec.netPaise).toBe(-2400000)

    // Vyapari: ₹10,000 principal posted + 6 months simple interest (₹900) live, not yet capitalised.
    expect(vyapariSec.postedBalancePaise).toBe(1000000)
    expect(vyapariSec.loans).toHaveLength(1)
    expect(vyapariSec.unpostedInterestPaise).toBe(90000) // 10,00,000 × 1.5% × 6
    expect(vyapariSec.loans[0].liveOutstandingPaise).toBe(1090000)
    expect(vyapariSec.netPaise).toBe(1090000)

    // Combined net = −24,000 + 10,900 = −₹13,100.
    expect(bill.combinedNetPaise).toBe(-1310000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('is reachable from any of the person’s role-accounts (same bill)', () => {
    seed()
    const fromKisan = getBill(kisan, yearId, '2026-07-01')!
    const fromVyapari = getBill(vyapari, yearId, '2026-07-01')!
    expect(fromVyapari.subjectKey).toBe(fromKisan.subjectKey)
    expect(fromVyapari.combinedNetPaise).toBe(fromKisan.combinedNetPaise)
    expect(fromVyapari.sections).toHaveLength(2)
  })

  it('treats an account with no person as its own single-section bill', () => {
    const bill = getBill(buyer, yearId)!
    expect(bill.personId).toBeNull()
    expect(bill.subjectKey).toBe(`account:${buyer}`)
    expect(bill.sections).toHaveLength(1)
    expect(bill.sections[0].role).toBe('vyapari')
  })

  it('lists subjects grouping role-accounts per person, with combined net', () => {
    seed()
    const subjects = listBillSubjects(yearId, '2026-07-01')
    const ram = subjects.find((s) => s.subjectKey === `person:${personId}`)!
    expect(ram).toBeTruthy()
    expect(ram.roles.sort()).toEqual(['kisan', 'vyapari'])
    expect(ram.netPaise).toBe(-1310000) // matches the bill's combined net
    // Mohan (no person) is his own subject.
    expect(subjects.some((s) => s.subjectKey === `account:${buyer}`)).toBe(true)
  })
})
