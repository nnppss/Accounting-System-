import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { createAamad, deleteAamad, updateAamad } from '../services/aamad'
import { post } from '../services/posting'
import { getAccountBalance, getTrialBalance } from '../services/ledger'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import {
  accrueAllRent,
  accrueRent,
  getRentReport,
  getStandingBhada,
  getStoredPackets,
  setRentRate
} from './bhada'

let yearId: number
let kisan: number
let vyapari: number

const RENT = 1500 // ₹15.00 per packet per year (paise)

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026, RENT)
  kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
  vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
  createAamad(yearId, {
    date: '2026-02-10',
    kisanAccountId: kisan,
    totalPackets: 100,
    locations: [{ room: 1, floor: 1, rack: 1, packets: 100 }]
  })
})
afterEach(() => closeDb())

describe('Bhada engine', () => {
  it('accrues full-year rent: stored packets × rate, Dr Kisan / Cr Rent Income', () => {
    const res = accrueRent(kisan, yearId, '2026-12-31')!
    expect(getStoredPackets(kisan, yearId)).toBe(100)
    expect(res.amountPaise).toBe(100 * RENT) // ₹1,500
    expect(getAccountBalance(kisan, yearId)).toBe(150000)
    expect(getStandingBhada(kisan, yearId).accruedRentPaise).toBe(150000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('nets recovery: sale proceeds credit offsets the rent debit in the kisan balance', () => {
    accrueRent(kisan, yearId, '2026-12-31') // Dr kisan ₹1,500
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
    accrueRent(kisan, yearId, '2026-12-31') // billed ₹1,500 (150000 paise)
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

  it('re-accrues idempotently when more stock is added (no double charge)', () => {
    accrueRent(kisan, yearId, '2026-12-31')
    expect(getAccountBalance(kisan, yearId)).toBe(150000)
    // 50 more packets stored, then re-accrue.
    createAamad(yearId, {
      date: '2026-03-01',
      kisanAccountId: kisan,
      totalPackets: 50,
      locations: [{ room: 1, floor: 2, rack: 1, packets: 50 }]
    })
    const res = accrueRent(kisan, yearId, '2026-12-31')!
    expect(res.amountPaise).toBe(150 * RENT) // ₹2,250
    expect(getAccountBalance(kisan, yearId)).toBe(225000) // not 150000 + 225000
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(225000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('re-prices the whole system when the rate is changed mid-year', () => {
    accrueRent(kisan, yearId, '2026-12-31') // ₹15/pkt → ₹1,500
    expect(getAccountBalance(kisan, yearId)).toBe(150000)
    // Rate revised in April to ₹20/pkt — re-prices every kisan, no double charge.
    setRentRate(yearId, 2000, '2026-04-15')
    expect(getStandingBhada(kisan, yearId).ratePaise).toBe(2000)
    expect(getAccountBalance(kisan, yearId)).toBe(200000) // 100 × ₹20, not stacked on the old ₹1,500
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(200000)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('keeps rent live automatically as aamad changes — no manual accrue', () => {
    // beforeEach stored 100 packets → rent is already accrued, without any explicit accrueRent call.
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(100 * RENT)

    const a2 = createAamad(yearId, {
      date: '2026-03-01',
      kisanAccountId: kisan,
      totalPackets: 50,
      locations: [{ room: 1, floor: 2, rack: 1, packets: 50 }]
    })
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(150 * RENT) // create bumped it

    updateAamad(yearId, a2, {
      date: '2026-03-01',
      kisanAccountId: kisan,
      totalPackets: 80,
      locations: [{ room: 1, floor: 2, rack: 1, packets: 80 }]
    })
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(180 * RENT) // update re-priced

    // Move the lot to another kisan → old kisan loses it, new one gains it.
    const kisan2 = makeAccount('Suresh Kisan', 'kisan', 'Farmer')
    updateAamad(yearId, a2, {
      date: '2026-03-01',
      kisanAccountId: kisan2,
      totalPackets: 80,
      locations: [{ room: 1, floor: 2, rack: 1, packets: 80 }]
    })
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(100 * RENT)
    expect(getStandingBhada(kisan2, yearId).standingPaise).toBe(80 * RENT)

    deleteAamad(yearId, a2)
    expect(getStandingBhada(kisan2, yearId).standingPaise).toBe(0) // delete cleared it
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('accrues for every kisan who stored stock', () => {
    const kisan2 = makeAccount('Suresh Kisan', 'kisan', 'Farmer')
    createAamad(yearId, {
      date: '2026-02-12',
      kisanAccountId: kisan2,
      totalPackets: 40,
      locations: [{ room: 2, floor: 1, rack: 1, packets: 40 }]
    })
    const summary = accrueAllRent(yearId, '2026-12-31')
    expect(summary.kisans).toBe(2)
    expect(summary.totalPaise).toBe((100 + 40) * RENT)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })
})
