import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { createAamad } from './aamad'
import { createNikasi } from './nikasi'
import { getMap, getRackStock, kisanStockLocations } from './maps'

let yearId: number
let kisan: number
let vyapari: number
let lot1: number

function cell(map: ReturnType<typeof getMap>, room: number, floor: number): number {
  return map.cells.find((c) => c.room === room && c.floor === floor)?.packets ?? 0
}

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
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

describe('Maps', () => {
  it('Current Stock = Aamad − Nikasi at all times', () => {
    // Before any nikasi: current == aamad.
    expect(cell(getMap(yearId, 'aamad'), 1, 1)).toBe(100)
    expect(cell(getMap(yearId, 'nikasi'), 1, 1)).toBe(0)
    expect(cell(getMap(yearId, 'current'), 1, 1)).toBe(100)

    // Withdraw 30 packets.
    createNikasi(yearId, {
      date: '2026-05-02',
      deliveredToType: 'vyapari',
      deliveredToAccountId: vyapari,
      lines: [{ aamadId: lot1, packets: 30, weightKg: 1500, ratePaise: 50000 }]
    })

    expect(cell(getMap(yearId, 'aamad'), 1, 1)).toBe(100) // aamad map is unchanged
    expect(cell(getMap(yearId, 'nikasi'), 1, 1)).toBe(30)
    expect(cell(getMap(yearId, 'current'), 1, 1)).toBe(70) // 100 − 30
    expect(getMap(yearId, 'current').totalPackets).toBe(70)
  })

  it('drills a cell to rack-level current stock, per kisan', () => {
    createNikasi(yearId, {
      date: '2026-05-02',
      deliveredToType: 'vyapari',
      deliveredToAccountId: vyapari,
      lines: [{ aamadId: lot1, packets: 40, weightKg: 2000, ratePaise: 50000 }]
    })
    const racks = getRackStock(yearId, 1, 1, 'current')
    expect(racks).toHaveLength(1)
    expect(racks[0].rack).toBe(1)
    expect(racks[0].kisanName).toBe('Ramesh Kisan')
    expect(racks[0].packets).toBe(60) // 100 − 40
  })

  it('lists a kisan’s remaining lots per rack, dropping emptied ones', () => {
    const lot2 = createAamad(yearId, {
      date: '2026-02-11',
      kisanAccountId: kisan,
      totalPackets: 50,
      locations: [{ room: 2, floor: 1, rack: 3, packets: 50 }]
    })
    // Empty the first lot entirely, take a partial from the second.
    createNikasi(yearId, {
      date: '2026-05-02',
      deliveredToType: 'vyapari',
      deliveredToAccountId: vyapari,
      lines: [
        { aamadId: lot1, packets: 100, weightKg: 5000, ratePaise: 50000 },
        { aamadId: lot2, packets: 20, weightKg: 1000, ratePaise: 50000 }
      ]
    })
    expect(kisanStockLocations(yearId, kisan)).toEqual([
      { room: 2, floor: 1, rack: 3, packets: 30 }
    ])
    // Another kisan has no lots.
    const other = makeAccount('Suresh Kisan', 'kisan', 'Farmer')
    expect(kisanStockLocations(yearId, other)).toEqual([])
  })
})
