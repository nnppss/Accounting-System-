import { and, eq, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { aamad, aamadLocation, account, nikasi, nikasiLine } from '../data/schema'
import type {
  KisanStockLocation,
  MapCell,
  MapType,
  RackKisanStock,
  StockMap
} from '../../shared/contracts'
import { getStoreConfig } from './store'

/**
 * The three Maps (software.md §Map) — pure read models over Aamad and Nikasi:
 *   Aamad (stock-in) · Nikasi (stock-out) · Current Stock (= Aamad − Nikasi).
 * Cells are Room × Floor totals; drill a cell to rack-level, broken down by kisan.
 */
export type { MapCell, MapType, RackKisanStock, StockMap } from '../../shared/contracts'

function aamadCells(yearId: number): MapCell[] {
  return db()
    .select({
      room: aamadLocation.room,
      floor: aamadLocation.floor,
      packets: sql<number>`sum(${aamadLocation.packets})`
    })
    .from(aamadLocation)
    .innerJoin(aamad, eq(aamadLocation.aamadId, aamad.id))
    .where(eq(aamad.yearId, yearId))
    .groupBy(aamadLocation.room, aamadLocation.floor)
    .all()
}

function nikasiCells(yearId: number): MapCell[] {
  return db()
    .select({
      room: nikasiLine.room,
      floor: nikasiLine.floor,
      packets: sql<number>`sum(${nikasiLine.packets})`
    })
    .from(nikasiLine)
    .innerJoin(nikasi, eq(nikasiLine.nikasiId, nikasi.id))
    .where(eq(nikasi.yearId, yearId))
    .groupBy(nikasiLine.room, nikasiLine.floor)
    .all()
}

const key = (room: number, floor: number): string => `${room}:${floor}`

export function getMap(yearId: number, type: MapType): StockMap {
  const cfg = getStoreConfig()
  const totals = new Map<string, MapCell>()
  const add = (cells: MapCell[], sign: number): void => {
    for (const c of cells) {
      const k = key(c.room, c.floor)
      const cur = totals.get(k) ?? { room: c.room, floor: c.floor, packets: 0 }
      cur.packets += sign * c.packets
      totals.set(k, cur)
    }
  }

  if (type === 'aamad') add(aamadCells(yearId), 1)
  else if (type === 'nikasi') add(nikasiCells(yearId), 1)
  else {
    add(aamadCells(yearId), 1)
    add(nikasiCells(yearId), -1)
  }

  const cells = [...totals.values()].filter((c) => c.packets !== 0)
  cells.sort((a, b) => a.room - b.room || a.floor - b.floor)
  const totalPackets = cells.reduce((s, c) => s + c.packets, 0)
  return { type, rooms: cfg.rooms, floors: cfg.floors, cells, totalPackets }
}

function aamadRackKisan(yearId: number, room: number, floor: number): RackKisanStock[] {
  return db()
    .select({
      rack: aamadLocation.rack,
      kisanAccountId: aamad.kisanAccountId,
      kisanName: account.name,
      packets: sql<number>`sum(${aamadLocation.packets})`
    })
    .from(aamadLocation)
    .innerJoin(aamad, eq(aamadLocation.aamadId, aamad.id))
    .innerJoin(account, eq(aamad.kisanAccountId, account.id))
    .where(and(eq(aamad.yearId, yearId), eq(aamadLocation.room, room), eq(aamadLocation.floor, floor)))
    .groupBy(aamadLocation.rack, aamad.kisanAccountId)
    .all()
}

function nikasiRackKisan(yearId: number, room: number, floor: number): RackKisanStock[] {
  return db()
    .select({
      rack: nikasiLine.rack,
      kisanAccountId: nikasiLine.fromKisanAccountId,
      kisanName: account.name,
      packets: sql<number>`sum(${nikasiLine.packets})`
    })
    .from(nikasiLine)
    .innerJoin(nikasi, eq(nikasiLine.nikasiId, nikasi.id))
    .innerJoin(account, eq(nikasiLine.fromKisanAccountId, account.id))
    .where(and(eq(nikasi.yearId, yearId), eq(nikasiLine.room, room), eq(nikasiLine.floor, floor)))
    .groupBy(nikasiLine.rack, nikasiLine.fromKisanAccountId)
    .all()
}

/** Rack-level drill of one Map cell, per kisan. Current = Aamad − Nikasi (zero rows dropped). */
export function getRackStock(
  yearId: number,
  room: number,
  floor: number,
  type: MapType
): RackKisanStock[] {
  if (type === 'aamad') return aamadRackKisan(yearId, room, floor).sort(sortRack)
  if (type === 'nikasi') return nikasiRackKisan(yearId, room, floor).sort(sortRack)

  const byKey = new Map<string, RackKisanStock>()
  const merge = (rows: RackKisanStock[], sign: number): void => {
    for (const r of rows) {
      const k = `${r.rack}:${r.kisanAccountId}`
      const cur = byKey.get(k) ?? { ...r, packets: 0 }
      cur.packets += sign * r.packets
      byKey.set(k, cur)
    }
  }
  merge(aamadRackKisan(yearId, room, floor), 1)
  merge(nikasiRackKisan(yearId, room, floor), -1)
  return [...byKey.values()].filter((r) => r.packets !== 0).sort(sortRack)
}

const sortRack = (a: RackKisanStock, b: RackKisanStock): number =>
  a.rack - b.rack || a.kisanName.localeCompare(b.kisanName)

/** Every rack where a kisan still has stock (Aamad − Nikasi > 0), for the Nikasi line picker. */
export function kisanStockLocations(yearId: number, kisanAccountId: number): KisanStockLocation[] {
  const totals = new Map<string, KisanStockLocation>()
  const merge = (rows: KisanStockLocation[], sign: 1 | -1): void => {
    for (const r of rows) {
      const k = `${r.room}:${r.floor}:${r.rack}`
      const cur = totals.get(k) ?? { room: r.room, floor: r.floor, rack: r.rack, packets: 0 }
      cur.packets += sign * r.packets
      totals.set(k, cur)
    }
  }
  merge(
    db()
      .select({
        room: aamadLocation.room,
        floor: aamadLocation.floor,
        rack: aamadLocation.rack,
        packets: sql<number>`sum(${aamadLocation.packets})`
      })
      .from(aamadLocation)
      .innerJoin(aamad, eq(aamadLocation.aamadId, aamad.id))
      .where(and(eq(aamad.yearId, yearId), eq(aamad.kisanAccountId, kisanAccountId)))
      .groupBy(aamadLocation.room, aamadLocation.floor, aamadLocation.rack)
      .all(),
    1
  )
  merge(
    db()
      .select({
        room: nikasiLine.room,
        floor: nikasiLine.floor,
        rack: nikasiLine.rack,
        packets: sql<number>`sum(${nikasiLine.packets})`
      })
      .from(nikasiLine)
      .innerJoin(nikasi, eq(nikasiLine.nikasiId, nikasi.id))
      .where(and(eq(nikasi.yearId, yearId), eq(nikasiLine.fromKisanAccountId, kisanAccountId)))
      .groupBy(nikasiLine.room, nikasiLine.floor, nikasiLine.rack)
      .all(),
    -1
  )
  return [...totals.values()]
    .filter((l) => l.packets > 0)
    .sort((a, b) => a.room - b.room || a.floor - b.floor || a.rack - b.rack)
}

/** Packets still on hand for one kisan at one exact rack = his Aamad − Nikasi there. */
export function currentStockAtRack(
  yearId: number,
  kisanAccountId: number,
  room: number,
  floor: number,
  rack: number
): number {
  const inn = db()
    .select({ n: sql<number>`coalesce(sum(${aamadLocation.packets}), 0)` })
    .from(aamadLocation)
    .innerJoin(aamad, eq(aamadLocation.aamadId, aamad.id))
    .where(
      and(
        eq(aamad.yearId, yearId),
        eq(aamad.kisanAccountId, kisanAccountId),
        eq(aamadLocation.room, room),
        eq(aamadLocation.floor, floor),
        eq(aamadLocation.rack, rack)
      )
    )
    .get()
  const out = db()
    .select({ n: sql<number>`coalesce(sum(${nikasiLine.packets}), 0)` })
    .from(nikasiLine)
    .innerJoin(nikasi, eq(nikasiLine.nikasiId, nikasi.id))
    .where(
      and(
        eq(nikasi.yearId, yearId),
        eq(nikasiLine.fromKisanAccountId, kisanAccountId),
        eq(nikasiLine.room, room),
        eq(nikasiLine.floor, floor),
        eq(nikasiLine.rack, rack)
      )
    )
    .get()
  return (inn?.n ?? 0) - (out?.n ?? 0)
}
