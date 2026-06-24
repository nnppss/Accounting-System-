import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { createAamad, getAamad, listAamad } from './aamad'

let yearId: number
let kisan: number
let kisan2: number

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
  kisan2 = makeAccount('Suresh Kisan', 'kisan', 'Farmer')
})
afterEach(() => closeDb())

describe('Aamad (stock-in)', () => {
  it('creates an aamad with location lines and reads it back', () => {
    const id = createAamad(yearId, {
      serial: 1,
      date: '2026-02-10',
      kisanAccountId: kisan,
      totalPackets: 150,
      locations: [
        { room: 1, floor: 1, rack: 1, packets: 100 },
        { room: 1, floor: 1, rack: 2, packets: 50 }
      ]
    })
    const detail = getAamad(id)!
    expect(detail.no).toBe('2026-1') // YYYY (working year) + serial
    expect(detail.kisanName).toBe('Ramesh Kisan')
    expect(detail.totalPackets).toBe(150)
    expect(detail.locations).toHaveLength(2)
  })

  it('rejects a duplicate serial within the same year', () => {
    const mk = (serial: number): number =>
      createAamad(yearId, {
        serial,
        date: '2026-02-10',
        kisanAccountId: kisan,
        totalPackets: 10,
        locations: [{ room: 1, floor: 1, rack: 1, packets: 10 }]
      })
    mk(7)
    expect(() => mk(7)).toThrow(/2026-7 already exists/i)
  })

  it('rejects a non-positive serial', () => {
    expect(() =>
      createAamad(yearId, {
        serial: 0,
        date: '2026-02-10',
        kisanAccountId: kisan,
        totalPackets: 10,
        locations: [{ room: 1, floor: 1, rack: 1, packets: 10 }]
      })
    ).toThrow(/serial must be a positive/i)
  })

  it('rejects a location/total packet mismatch', () => {
    expect(() =>
      createAamad(yearId, {
        serial: 2,
        date: '2026-02-10',
        kisanAccountId: kisan,
        totalPackets: 100,
        locations: [{ room: 1, floor: 1, rack: 1, packets: 90 }]
      })
    ).toThrow(/must equal the total/i)
  })

  it('rejects a location outside the configured store (5×6×160)', () => {
    expect(() =>
      createAamad(yearId, {
        serial: 3,
        date: '2026-02-10',
        kisanAccountId: kisan,
        totalPackets: 10,
        locations: [{ room: 9, floor: 1, rack: 1, packets: 10 }]
      })
    ).toThrow(/Room 9 out of range/i)
  })

  it('searches by kisan with a count + total-packets summary', () => {
    createAamad(yearId, {
      serial: 1,
      date: '2026-02-10',
      kisanAccountId: kisan,
      totalPackets: 100,
      locations: [{ room: 1, floor: 1, rack: 1, packets: 100 }]
    })
    createAamad(yearId, {
      serial: 2,
      date: '2026-02-12',
      kisanAccountId: kisan,
      totalPackets: 60,
      locations: [{ room: 1, floor: 2, rack: 1, packets: 60 }]
    })
    createAamad(yearId, {
      serial: 3,
      date: '2026-02-15',
      kisanAccountId: kisan2,
      totalPackets: 40,
      locations: [{ room: 2, floor: 1, rack: 1, packets: 40 }]
    })

    const all = listAamad(yearId)
    expect(all.count).toBe(3)
    expect(all.totalPackets).toBe(200)

    const justRamesh = listAamad(yearId, { kisanAccountId: kisan })
    expect(justRamesh.count).toBe(2)
    expect(justRamesh.totalPackets).toBe(160)
  })
})
