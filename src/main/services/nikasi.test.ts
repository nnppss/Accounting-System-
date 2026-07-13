import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, db } from '../data/db'
import { nikasiLine } from '../data/schema'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { createAamad } from './aamad'
import { createNikasi } from './nikasi'
import { currentStockAtRack } from './maps'
import { getAccountBalance, getTrialBalance } from './ledger'

let yearId: number
let kisan: number
let kisan2: number
let vyapari: number
let lot1: number // kisan's 100 packets at R1/F1/Rack1
let lot2: number // kisan2's 80 packets at R1/F1/Rack2

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
  kisan2 = makeAccount('Suresh Kisan', 'kisan', 'Farmer')
  vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
  lot1 = createAamad(yearId, {
    date: '2026-02-10',
    kisanAccountId: kisan,
    totalPackets: 100,
    locations: [{ room: 1, floor: 1, rack: 1, packets: 100 }]
  })
  lot2 = createAamad(yearId, {
    date: '2026-02-11',
    kisanAccountId: kisan2,
    totalPackets: 80,
    locations: [{ room: 1, floor: 1, rack: 2, packets: 80 }]
  })
})
afterEach(() => closeDb())

describe('Nikasi (stock-out)', () => {
  it('a kisan self-withdrawal is physical only — no posting', () => {
    const res = createNikasi(yearId, {
      date: '2026-05-01',
      deliveredToType: 'kisan',
      deliveredToAccountId: kisan,
      lines: [{ aamadId: lot1, packets: 20, ratePaise: 0 }]
    })
    expect(res.voucherId).toBeNull()
    expect(getAccountBalance(kisan, yearId)).toBe(0) // nothing posted
  })

  it('a vyapari sale posts Dr Vyapari / Cr Kisan for the proceeds', () => {
    const res = createNikasi(yearId, {
      date: '2026-05-02',
      deliveredToType: 'vyapari',
      deliveredToAccountId: vyapari,
      // Rate is per 105 kg: 1050 kg / 105 × ₹500 = ₹5,000.
      lines: [{ aamadId: lot1, packets: 30, weightKg: 1050, ratePaise: 50000 }]
    })
    expect(res.voucherId).not.toBeNull()
    const proceeds = Math.round((1050 / 105) * 50000) // ₹5,000
    expect(getAccountBalance(vyapari, yearId)).toBe(proceeds) // vyapari owes the cold (Dr)
    expect(getAccountBalance(kisan, yearId)).toBe(-proceeds) // cold owes kisan (Cr)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('refuses to withdraw more than the lot has placed', () => {
    expect(() =>
      createNikasi(yearId, {
        date: '2026-05-02',
        deliveredToType: 'vyapari',
        deliveredToAccountId: vyapari,
        lines: [{ aamadId: lot1, packets: 130, weightKg: 6500, ratePaise: 50000 }]
      })
    ).toThrow(/only 100 packets are available/i)
  })

  it('a vyapari buying from many kisans credits each kisan their own proceeds', () => {
    createNikasi(yearId, {
      date: '2026-05-03',
      deliveredToType: 'vyapari',
      deliveredToAccountId: vyapari,
      lines: [
        { aamadId: lot1, packets: 40, weightKg: 2100, ratePaise: 50000 },
        { aamadId: lot2, packets: 20, weightKg: 1050, ratePaise: 60000 }
      ]
    })
    const fromKisan = Math.round((2100 / 105) * 50000) // ₹10,000
    const fromKisan2 = Math.round((1050 / 105) * 60000) // ₹6,000
    expect(getAccountBalance(kisan, yearId)).toBe(-fromKisan)
    expect(getAccountBalance(kisan2, yearId)).toBe(-fromKisan2)
    expect(getAccountBalance(vyapari, yearId)).toBe(fromKisan + fromKisan2)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('deducts a lot spread across racks greedily in rack order', () => {
    // 150 packets on racks of their own: 60 at R3/F1/Rack1, 90 at R4/F1/Rack1.
    const spread = createAamad(yearId, {
      date: '2026-02-12',
      kisanAccountId: kisan,
      totalPackets: 150,
      locations: [
        { room: 3, floor: 1, rack: 1, packets: 60 },
        { room: 4, floor: 1, rack: 1, packets: 90 }
      ]
    })
    createNikasi(yearId, {
      date: '2026-05-04',
      deliveredToType: 'kisan',
      deliveredToAccountId: kisan,
      lines: [{ aamadId: spread, packets: 100, ratePaise: 0 }]
    })
    // First rack drained (60), remainder (40) taken from the second.
    expect(currentStockAtRack(yearId, kisan, 3, 1, 1)).toBe(0)
    expect(currentStockAtRack(yearId, kisan, 4, 1, 1)).toBe(50)
  })

  it('never over-ships a rack already drained by a legacy (no aamad_id) line', () => {
    // Ship 80 of lot1's 100, then blank its aamad_id to mimic a pre-feature nikasi row.
    createNikasi(yearId, {
      date: '2026-05-01',
      deliveredToType: 'kisan',
      deliveredToAccountId: kisan,
      lines: [{ aamadId: lot1, packets: 80, ratePaise: 0 }]
    })
    db().update(nikasiLine).set({ aamadId: null }).where(eq(nikasiLine.aamadId, lot1)).run()
    // Lot-level accounting now thinks lot1 is untouched, but only 20 are physically left.
    expect(() =>
      createNikasi(yearId, {
        date: '2026-05-02',
        deliveredToType: 'kisan',
        deliveredToAccountId: kisan,
        lines: [{ aamadId: lot1, packets: 50, ratePaise: 0 }]
      })
    ).toThrow(/only 20 packets are available/i)
    expect(currentStockAtRack(yearId, kisan, 1, 1, 1)).toBe(20) // still non-negative
  })

  it('allocates per-year bill numbers in sequence', () => {
    const a = createNikasi(yearId, {
      date: '2026-05-01',
      deliveredToType: 'kisan',
      deliveredToAccountId: kisan,
      lines: [{ aamadId: lot1, packets: 10, ratePaise: 0 }]
    })
    const b = createNikasi(yearId, {
      date: '2026-05-02',
      deliveredToType: 'kisan',
      deliveredToAccountId: kisan2,
      lines: [{ aamadId: lot2, packets: 10, ratePaise: 0 }]
    })
    expect(a.billNo).toBe(1)
    expect(b.billNo).toBe(2)
  })
})
