import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { createAamad } from '../services/aamad'
import { post } from '../services/posting'
import { getAccountBalance, getTrialBalance } from '../services/ledger'
import { accrueAllRent, accrueRent, getStandingBhada, getStoredPackets } from './bhada'

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
    no: 'A-1',
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

  it('re-accrues idempotently when more stock is added (no double charge)', () => {
    accrueRent(kisan, yearId, '2026-12-31')
    expect(getAccountBalance(kisan, yearId)).toBe(150000)
    // 50 more packets stored, then re-accrue.
    createAamad(yearId, {
      no: 'A-2',
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

  it('accrues for every kisan who stored stock', () => {
    const kisan2 = makeAccount('Suresh Kisan', 'kisan', 'Farmer')
    createAamad(yearId, {
      no: 'A-3',
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
