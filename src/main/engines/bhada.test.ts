import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { createAamad } from '../services/aamad'
import { createNikasi, deleteNikasi } from '../services/nikasi'
import { post } from '../services/posting'
import { getAccountBalance, getTrialBalance } from '../services/ledger'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import {
  accrueAllRent,
  accrueRent,
  getRentReport,
  getShippedPackets,
  getStandingBhada,
  getStoredPackets,
  setRentRate
} from './bhada'

let yearId: number
let kisan: number
let vyapari: number
let lot1: number // kisan's 100 packets at R1/F1/Rack1

const RENT = 1500 // ₹15.00 per packet per year (paise)

/** Self-withdraw `packets` of lot1 — a physical nikasi that ships stock (and auto-accrues rent). */
function ship(packets: number, date = '2026-05-01'): number {
  return createNikasi(yearId, {
    date,
    deliveredToType: 'kisan',
    deliveredToAccountId: kisan,
    lines: [{ aamadId: lot1, packets, ratePaise: 0 }]
  }).nikasiId
}

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026, RENT)
  kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
  vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
  lot1 = createAamad(yearId, {
    date: '2026-02-10',
    kisanAccountId: kisan,
    totalPackets: 100,
    locations: [{ room: 1, floor: 1, rack: 1, packets: 100 }]
  })
})
afterEach(() => closeDb())

describe('Bhada engine', () => {
  it('intake alone accrues no rent — rent follows shipped stock', () => {
    // 100 packets stored but nothing shipped yet → no rent on his books.
    expect(getStoredPackets(kisan, yearId)).toBe(100)
    expect(getShippedPackets(kisan, yearId)).toBe(0)
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(0)
    expect(getAccountBalance(kisan, yearId)).toBe(0)
  })

  it('accrues rent as stock ships (shipped × rate), automatically — no manual accrue', () => {
    ship(30)
    expect(getShippedPackets(kisan, yearId)).toBe(30)
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(30 * RENT)
    ship(20, '2026-06-01')
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(50 * RENT)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('year-end (stored basis) bills the full stored quantity even if unshipped', () => {
    ship(30) // only 30 shipped, 70 still in storage
    const res = accrueRent(kisan, yearId, '2026-12-31', undefined, 'stored')!
    expect(res.amountPaise).toBe(100 * RENT) // all 100, not just the 30 shipped
    expect(getAccountBalance(kisan, yearId)).toBe(100 * RENT)
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(100 * RENT)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('nets recovery: sale proceeds credit offsets the rent debit in the kisan balance', () => {
    accrueRent(kisan, yearId, '2026-12-31', undefined, 'stored') // Dr kisan ₹1,500
    // Sale proceeds to the kisan (Dr Vyapari / Cr Kisan ₹50,000), tagged trade.
    post({
      yearId,
      type: 'journal',
      date: '2026-06-01',
      entries: [
        { accountId: vyapari, drPaise: 5000000, crPaise: 0, tag: 'trade' },
        { accountId: kisan, drPaise: 0, crPaise: 5000000, tag: 'trade' }
      ]
    })
    // Kisan net = rent 1,500 Dr − proceeds 50,000 Cr = 48,500 Cr (the cold owes him, rent recovered).
    expect(getAccountBalance(kisan, yearId)).toBe(150000 - 5000000)
    // Standing bhada (rent tag) is unchanged by the trade credit.
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(150000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('rent report: billed − paid across turns, totals sum over kisans', () => {
    accrueRent(kisan, yearId, '2026-12-31', undefined, 'stored') // billed ₹1,500 (150000 paise)
    const cash = getSystemAccountId(SYSTEM_ACCOUNTS.CASH)
    // Two rent payments (turns): ₹400 then ₹600 — Dr Cash / Cr Kisan, tagged rent.
    for (const [date, paise] of [['2026-05-01', 40000], ['2026-08-01', 60000]] as const) {
      post({
        yearId,
        type: 'receipt',
        date,
        entries: [
          { accountId: cash, drPaise: paise, crPaise: 0, tag: 'rent' },
          { accountId: kisan, drPaise: 0, crPaise: paise, tag: 'rent' }
        ]
      })
    }
    const rep = getRentReport(yearId)
    expect(rep.totalBilledPaise).toBe(150000)
    expect(rep.totalCollectedPaise).toBe(100000) // 40000 + 60000
    expect(rep.totalDuePaise).toBe(50000)
    // Cash (system) is excluded — only the kisan shows up.
    expect(rep.kisans).toHaveLength(1)
    const k = rep.kisans[0]
    expect(k.accountId).toBe(kisan)
    expect(k.duePaise).toBe(50000)
    expect(k.payments.map((p) => p.amountPaise)).toEqual([40000, 60000]) // both turns, in date order
  })

  it('re-accrues idempotently when more stock is stored (stored basis, no double charge)', () => {
    accrueRent(kisan, yearId, '2026-12-31', undefined, 'stored')
    expect(getAccountBalance(kisan, yearId)).toBe(150000)
    // 50 more packets stored, then re-accrue.
    createAamad(yearId, {
      date: '2026-03-01',
      kisanAccountId: kisan,
      totalPackets: 50,
      locations: [{ room: 1, floor: 2, rack: 1, packets: 50 }]
    })
    const res = accrueRent(kisan, yearId, '2026-12-31', undefined, 'stored')!
    expect(res.amountPaise).toBe(150 * RENT) // ₹2,250
    expect(getAccountBalance(kisan, yearId)).toBe(225000) // not 150000 + 225000
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(225000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('re-prices the shipped rent when the rate is changed mid-year', () => {
    ship(100) // all shipped → rent ₹15/pkt → ₹1,500
    expect(getAccountBalance(kisan, yearId)).toBe(150000)
    // Rate revised in April to ₹20/pkt — re-prices every kisan, no double charge.
    setRentRate(yearId, 2000, '2026-04-15')
    expect(getStandingBhada(kisan, yearId).ratePaise).toBe(2000)
    expect(getAccountBalance(kisan, yearId)).toBe(200000) // 100 × ₹20, not stacked on the old ₹1,500
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(200000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('keeps rent live automatically as nikasi ships and reverses on delete', () => {
    const n1 = ship(40, '2026-05-01')
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(40 * RENT)
    const n2 = ship(10, '2026-06-01')
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(50 * RENT) // ship bumped it

    deleteNikasi(yearId, n2)
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(40 * RENT) // delete re-priced down
    deleteNikasi(yearId, n1)
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(0) // all shipments gone
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('year-end accrues for every kisan who stored stock (stored basis)', () => {
    const kisan2 = makeAccount('Suresh Kisan', 'kisan', 'Farmer')
    createAamad(yearId, {
      date: '2026-02-12',
      kisanAccountId: kisan2,
      totalPackets: 40,
      locations: [{ room: 2, floor: 1, rack: 1, packets: 40 }]
    })
    const summary = accrueAllRent(yearId, '2026-12-31', undefined, 'stored')
    expect(summary.kisans).toBe(2)
    expect(summary.totalPaise).toBe((100 + 40) * RENT)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })
})
