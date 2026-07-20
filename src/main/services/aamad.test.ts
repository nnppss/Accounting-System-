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
      date: '2026-02-10',
      kisanAccountId: kisan,
      totalPackets: 150,
      locations: [
        { room: 1, floor: 1, rack: 1, packets: 100 },
        { room: 1, floor: 1, rack: 2, packets: 50 }
      ]
    })
    const detail = getAamad(id)!
    expect(detail.no).toBe('2026-1') // YYYY (working year) + auto serial
    expect(detail.kisanName).toBe('Ramesh Kisan')
    expect(detail.totalPackets).toBe(150)
    expect(detail.locations).toHaveLength(2)
  })

  it('auto-increments the serial per storage year', () => {
    const mk = (): number =>
      createAamad(yearId, {
        date: '2026-02-10',
        kisanAccountId: kisan,
        totalPackets: 10,
        locations: []
      })
    expect(getAamad(mk())!.no).toBe('2026-1')
    expect(getAamad(mk())!.no).toBe('2026-2')
    expect(getAamad(mk())!.no).toBe('2026-3')
  })

  it('allows no locations or a partial assignment, but never more than the total', () => {
    // Peak season: booked by total only, placed later.
    const bare = createAamad(yearId, {
      date: '2026-02-10',
      kisanAccountId: kisan,
      totalPackets: 200,
      locations: []
    })
    expect(getAamad(bare)!.assignedPackets).toBe(0)

    // Partially placed is fine too.
    const partial = createAamad(yearId, {
      date: '2026-02-10',
      kisanAccountId: kisan,
      totalPackets: 100,
      locations: [{ room: 1, floor: 1, rack: 1, packets: 90 }]
    })
    expect(getAamad(partial)!.assignedPackets).toBe(90)

    expect(() =>
      createAamad(yearId, {
        date: '2026-02-10',
        kisanAccountId: kisan,
        totalPackets: 100,
        locations: [{ room: 1, floor: 1, rack: 1, packets: 110 }]
      })
    ).toThrow(/exceed the total/i)
  })

  it('updates an aamad in place, keeping its no.', () => {
    const id = createAamad(yearId, {
      date: '2026-02-10',
      kisanAccountId: kisan, // wrong kisan entered in season rush
      totalPackets: 200,
      locations: []
    })
    expect(getAamad(id)!.no).toBe('2026-1')
    updateAamad(yearId, id, {
      date: '2026-02-10',
      kisanAccountId: kisan2,
      totalPackets: 200,
      locations: [
        { room: 1, floor: 2, rack: 3, packets: 50 },
        { room: 1, floor: 2, rack: 4, packets: 150 }
      ]
    })
    const d = getAamad(id)!
    expect(d.no).toBe('2026-1') // serial never changes on edit
    expect(d.kisanName).toBe('Suresh Kisan')
    expect(d.assignedPackets).toBe(200)
    expect(d.locations).toHaveLength(2)
  })

  it('rejects a location outside the configured store (5×6×160)', () => {
    expect(() =>
      createAamad(yearId, {
        date: '2026-02-10',
        kisanAccountId: kisan,
        totalPackets: 10,
        locations: [{ room: 9, floor: 1, rack: 1, packets: 10 }]
      })
    ).toThrow(/Room 9 out of range/i)
  })

  it('refuses to delete or shrink an aamad whose stock already left through nikasi', () => {
    const id = createAamad(yearId, {
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
      lines: [{ aamadId: id, packets: 60, weightKg: 3000, ratePaise: 50000 }]
    })

    // 60 of the 100 packets are gone — the aamad can no longer vanish or shrink below 60.
    expect(() => deleteAamad(yearId, id)).toThrow(/already left/i)
    expect(() =>
      updateAamad(yearId, id, {
        date: '2026-02-10',
        kisanAccountId: kisan,
        totalPackets: 50,
        locations: [{ room: 1, floor: 1, rack: 1, packets: 50 }]
      })
    ).toThrow(/already left/i)

    // Shrinking down to exactly what has shipped is still fine (stock reaches zero, not negative).
    updateAamad(yearId, id, {
      date: '2026-02-10',
      kisanAccountId: kisan,
      totalPackets: 60,
      locations: [{ room: 1, floor: 1, rack: 1, packets: 60 }]
    })
    expect(getAamad(id)!.assignedPackets).toBe(60)
  })

  it('reports packets shipped out per lot without the location join inflating the sums', () => {
    const id = createAamad(yearId, {
      date: '2026-02-10',
      kisanAccountId: kisan,
      totalPackets: 230,
      locations: [
        { room: 1, floor: 1, rack: 1, packets: 130 },
        { room: 1, floor: 1, rack: 2, packets: 100 }
      ]
    })
    const vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
    for (const packets of [20, 30]) {
      createNikasi(yearId, {
        date: '2026-06-01',
        deliveredToType: 'vyapari',
        deliveredToAccountId: vyapari,
        lines: [{ aamadId: id, packets, weightKg: packets * 50, ratePaise: 50000 }]
      })
    }

    const row = listAamad(yearId, { kisanAccountId: kisan }).rows.find((r) => r.id === id)!
    expect(row.outPackets).toBe(50)
    expect(row.assignedPackets).toBe(230)
    expect(row.totalPackets - row.outPackets).toBe(180)
  })

  it('searches by kisan with a count + total-packets summary', () => {
    createAamad(yearId, {
      date: '2026-02-10',
      kisanAccountId: kisan,
      totalPackets: 100,
      locations: [{ room: 1, floor: 1, rack: 1, packets: 100 }]
    })
    createAamad(yearId, {
      date: '2026-02-12',
      kisanAccountId: kisan,
      totalPackets: 60,
      locations: [{ room: 1, floor: 2, rack: 1, packets: 60 }]
    })
    createAamad(yearId, {
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
