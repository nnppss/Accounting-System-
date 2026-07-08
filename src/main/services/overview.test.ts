import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { createAamad } from './aamad'
import { createNikasi, listNikasi } from './nikasi'
import { getAccountOverview } from './overview'

let yearId: number
let kisan: number
let kisan2: number
let vyapari: number

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
  kisan2 = makeAccount('Suresh Kisan', 'kisan', 'Farmer')
  vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
  const lot1 = createAamad(yearId, {
    date: '2026-02-10',
    kisanAccountId: kisan,
    totalPackets: 100,
    locations: [{ room: 1, floor: 1, rack: 1, packets: 100 }]
  })
  const lot2 = createAamad(yearId, {
    date: '2026-02-11',
    kisanAccountId: kisan2,
    totalPackets: 80,
    locations: [{ room: 1, floor: 1, rack: 2, packets: 80 }]
  })
  // One gate pass to the vyapari buying from both kisans.
  createNikasi(yearId, {
    date: '2026-05-03',
    deliveredToType: 'vyapari',
    deliveredToAccountId: vyapari,
    lines: [
      { aamadId: lot1, packets: 40, ratePaise: 50000 },
      { aamadId: lot2, packets: 20, ratePaise: 60000 }
    ]
  })
})
afterEach(() => closeDb())

describe('account overview', () => {
  it('kisan: stock in/out/balance + trade proceeds as a credit', () => {
    const o = getAccountOverview(kisan, yearId)
    expect(o.stock.aamadPackets).toBe(100)
    expect(o.stock.aamadCount).toBe(1)
    expect(o.stock.nikasiOutPackets).toBe(40)
    expect(o.stock.balancePackets).toBe(60)
    expect(o.stock.purchasedPackets).toBe(0)
    // Sale credits the kisan (cold owes them): trade net is negative.
    expect(o.money.tradePaise).toBe(-(40 * 50000))
    expect(o.money.balancePaise).toBe(-(40 * 50000))
  })

  it('vyapari: purchased packets + trade debit', () => {
    const o = getAccountOverview(vyapari, yearId)
    expect(o.stock.purchasedPackets).toBe(60) // 40 + 20 across the gate pass
    expect(o.stock.aamadPackets).toBe(0)
    // Vyapari owes the cold: trade net is positive = sum of proceeds.
    expect(o.money.tradePaise).toBe(40 * 50000 + 20 * 60000)
    expect(o.money.balancePaise).toBe(40 * 50000 + 20 * 60000)
  })

  it('nikasi list filters by party, scoping kisan totals to their own packets', () => {
    const forVyapari = listNikasi(yearId, { deliveredToAccountId: vyapari })
    expect(forVyapari).toHaveLength(1)
    expect(forVyapari[0].totalPackets).toBe(60) // whole gate pass

    const forKisan = listNikasi(yearId, { fromKisanAccountId: kisan })
    expect(forKisan).toHaveLength(1)
    expect(forKisan[0].totalPackets).toBe(40) // only this kisan's line
    expect(forKisan[0].totalAmountPaise).toBe(40 * 50000)

    expect(listNikasi(yearId, { fromKisanAccountId: vyapari })).toHaveLength(0)
  })
})
