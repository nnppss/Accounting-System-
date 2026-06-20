import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { createAamad } from './aamad'
import { createNikasi } from './nikasi'
import { getAccountBalance, getTrialBalance } from './ledger'

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
  // Stock: kisan has 100 packets at R1/F1/Rack1; kisan2 has 80 at R1/F1/Rack2.
  createAamad(yearId, {
    no: 'A-1',
    date: '2026-02-10',
    kisanAccountId: kisan,
    totalPackets: 100,
    locations: [{ room: 1, floor: 1, rack: 1, packets: 100 }]
  })
  createAamad(yearId, {
    no: 'A-2',
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
      lines: [{ fromKisanAccountId: kisan, room: 1, floor: 1, rack: 1, packets: 20, ratePaise: 0 }]
    })
    expect(res.voucherId).toBeNull()
    expect(getAccountBalance(kisan, yearId)).toBe(0) // nothing posted
  })

  it('a vyapari sale posts Dr Vyapari / Cr Kisan for the proceeds', () => {
    const res = createNikasi(yearId, {
      date: '2026-05-02',
      deliveredToType: 'vyapari',
      deliveredToAccountId: vyapari,
      lines: [{ fromKisanAccountId: kisan, room: 1, floor: 1, rack: 1, packets: 30, ratePaise: 50000 }]
    })
    expect(res.voucherId).not.toBeNull()
    const proceeds = 30 * 50000 // ₹15,000
    expect(getAccountBalance(vyapari, yearId)).toBe(proceeds) // vyapari owes the cold (Dr)
    expect(getAccountBalance(kisan, yearId)).toBe(-proceeds) // cold owes kisan (Cr)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('refuses to withdraw more than the kisan has at that rack', () => {
    expect(() =>
      createNikasi(yearId, {
        date: '2026-05-02',
        deliveredToType: 'vyapari',
        deliveredToAccountId: vyapari,
        lines: [
          { fromKisanAccountId: kisan, room: 1, floor: 1, rack: 1, packets: 130, ratePaise: 50000 }
        ]
      })
    ).toThrow(/not enough stock/i)
  })

  it('a vyapari buying from many kisans credits each kisan their own proceeds', () => {
    createNikasi(yearId, {
      date: '2026-05-03',
      deliveredToType: 'vyapari',
      deliveredToAccountId: vyapari,
      lines: [
        { fromKisanAccountId: kisan, room: 1, floor: 1, rack: 1, packets: 40, ratePaise: 50000 },
        { fromKisanAccountId: kisan2, room: 1, floor: 1, rack: 2, packets: 20, ratePaise: 60000 }
      ]
    })
    const fromKisan = 40 * 50000 // ₹20,000
    const fromKisan2 = 20 * 60000 // ₹12,000
    expect(getAccountBalance(kisan, yearId)).toBe(-fromKisan)
    expect(getAccountBalance(kisan2, yearId)).toBe(-fromKisan2)
    expect(getAccountBalance(vyapari, yearId)).toBe(fromKisan + fromKisan2)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('allocates per-year bill numbers in sequence', () => {
    const a = createNikasi(yearId, {
      date: '2026-05-01',
      deliveredToType: 'kisan',
      deliveredToAccountId: kisan,
      lines: [{ fromKisanAccountId: kisan, room: 1, floor: 1, rack: 1, packets: 10, ratePaise: 0 }]
    })
    const b = createNikasi(yearId, {
      date: '2026-05-02',
      deliveredToType: 'kisan',
      deliveredToAccountId: kisan2,
      lines: [{ fromKisanAccountId: kisan2, room: 1, floor: 1, rack: 2, packets: 10, ratePaise: 0 }]
    })
    expect(a.billNo).toBe(1)
    expect(b.billNo).toBe(2)
  })
})
