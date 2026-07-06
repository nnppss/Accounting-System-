import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { createAamad, deleteAamad, getAamad, listAamad, updateAamad } from './aamad'
import { createNikasi } from './nikasi'

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

  it('allows no locations or a partial assignment, but never more than the total', () => {
    // Peak season: booked by total only, placed later.
    const bare = createAamad(yearId, {
      serial: 2,
      date: '2026-02-10',
      kisanAccountId: kisan,
      totalPackets: 200,
      locations: []
    })
    expect(getAamad(bare)!.assignedPackets).toBe(0)

    // Partially placed is fine too.
    const partial = createAamad(yearId, {
      serial: 3,
      date: '2026-02-10',
      kisanAccountId: kisan,
      totalPackets: 100,
      locations: [{ room: 1, floor: 1, rack: 1, packets: 90 }]
    })
    expect(getAamad(partial)!.assignedPackets).toBe(90)

    expect(() =>
      createAamad(yearId, {
        serial: 4,
        date: '2026-02-10',
        kisanAccountId: kisan,
        totalPackets: 100,
        locations: [{ room: 1, floor: 1, rack: 1, packets: 110 }]
      })
    ).toThrow(/exceed the total/i)
  })

  it('updates an aamad in place — kisan, total, and location lines', () => {
    const id = createAamad(yearId, {
      serial: 5,
      date: '2026-02-10',
      kisanAccountId: kisan, // wrong kisan entered in season rush
      totalPackets: 200,
      locations: []
    })
    updateAamad(yearId, id, {
      serial: 5,
      date: '2026-02-10',
      kisanAccountId: kisan2,
      totalPackets: 200,
      locations: [
        { room: 1, floor: 2, rack: 3, packets: 50 },
        { room: 1, floor: 2, rack: 4, packets: 150 }
      ]
    })
    const d = getAamad(id)!
    expect(d.no).toBe('2026-5')
    expect(d.kisanName).toBe('Suresh Kisan')
    expect(d.assignedPackets).toBe(200)
    expect(d.locations).toHaveLength(2)
  })

  it('rejects an update whose serial clashes with another aamad', () => {
    const mk = (serial: number): number =>
      createAamad(yearId, {
        serial,
        date: '2026-02-10',
        kisanAccountId: kisan,
        totalPackets: 10,
        locations: []
      })
    mk(8)
    const id = mk(9)
    // Keeping its own serial is fine; taking a used one is not.
    updateAamad(yearId, id, {
      serial: 9,
      date: '2026-02-11',
      kisanAccountId: kisan,
      totalPackets: 10,
      locations: []
    })
    expect(() =>
      updateAamad(yearId, id, {
        serial: 8,
        date: '2026-02-11',
        kisanAccountId: kisan,
        totalPackets: 10,
        locations: []
      })
    ).toThrow(/2026-8 already exists/i)
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

  it('refuses to delete or shrink an aamad whose stock already left through nikasi', () => {
    const id = createAamad(yearId, {
      serial: 6,
      date: '2026-02-10',
      kisanAccountId: kisan,
      totalPackets: 100,
      locations: [{ room: 1, floor: 1, rack: 1, packets: 100 }]
    })
    const vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
    createNikasi(yearId, {
      date: '2026-06-01',
      deliveredToType: 'vyapari',
      deliveredToAccountId: vyapari,
      lines: [{ fromKisanAccountId: kisan, room: 1, floor: 1, rack: 1, packets: 60, ratePaise: 50000 }]
    })

    // 60 of the 100 packets are gone — the aamad can no longer vanish or shrink below 60.
    expect(() => deleteAamad(yearId, id)).toThrow(/already left/i)
    expect(() =>
      updateAamad(yearId, id, {
        serial: 6,
        date: '2026-02-10',
        kisanAccountId: kisan,
        totalPackets: 50,
        locations: [{ room: 1, floor: 1, rack: 1, packets: 50 }]
      })
    ).toThrow(/already left/i)

    // Shrinking down to exactly what has shipped is still fine (stock reaches zero, not negative).
    updateAamad(yearId, id, {
      serial: 6,
      date: '2026-02-10',
      kisanAccountId: kisan,
      totalPackets: 60,
      locations: [{ room: 1, floor: 1, rack: 1, packets: 60 }]
    })
    expect(getAamad(id)!.assignedPackets).toBe(60)
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
