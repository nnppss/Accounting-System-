import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { aamad, aamadLocation, account, financialYear, nikasiLine } from '../data/schema'
import type {
  AamadDetail,
  AamadInput,
  AamadListResult,
  AamadListRow,
  AamadSearchFilter
} from '../../shared/contracts'
import { writeAudit } from '../audit/audit'
import { currentStockAtRack } from './maps'
import { assertLocationInBounds } from './store'

/** Aamad (stock-in) — header + Room/Floor/Rack location lines. Physical only; posts nothing. */
export type {
  AamadDetail,
  AamadInput,
  AamadListResult,
  AamadListRow,
  AamadSearchFilter
} from '../../shared/contracts'

/** Serial embedded in an aamad `no` (`YYYY-serial`), and the lot no. shown to parties. */
export const serialOf = (no: string): number => Number(no.slice(no.indexOf('-') + 1))
export const lotNoOf = (no: string, totalPackets: number): string =>
  `${serialOf(no)}/${totalPackets}`

/**
 * Shared create/update checks. Locations are optional (at peak season the consignment is booked
 * by total only and placed later) and may cover only part of the total — but never more.
 */
function validateInput(input: AamadInput): void {
  if (!Number.isInteger(input.totalPackets) || input.totalPackets <= 0) {
    throw new Error('Total packets must be a positive whole number')
  }
  const kisan = db().select().from(account).where(eq(account.id, input.kisanAccountId)).get()
  if (!kisan) throw new Error(`Kisan account ${input.kisanAccountId} not found`)

  let locSum = 0
  for (const l of input.locations) {
    if (!Number.isInteger(l.packets) || l.packets <= 0) {
      throw new Error('Each location must have a positive whole number of packets')
    }
    assertLocationInBounds(l.room, l.floor, l.rack)
    locSum += l.packets
  }
  if (locSum > input.totalPackets) {
    throw new Error(`Location packets (${locSum}) exceed the total (${input.totalPackets})`)
  }
}

export function createAamad(yearId: number, input: AamadInput, userId?: number): number {
  validateInput(input)
  // Aamad no. = `YYYY-serial`; the serial auto-increments per storage year (year is the working
  // year, not the entry date, so early-next-year entries still join this season's series).
  const fy = db().select().from(financialYear).where(eq(financialYear.id, yearId)).get()
  if (!fy) throw new Error(`Financial year ${yearId} not found`)
  return db().transaction((tx) => {
    const existing = tx.select({ no: aamad.no }).from(aamad).where(eq(aamad.yearId, yearId)).all()
    const serial = existing.reduce((m, r) => Math.max(m, serialOf(r.no)), 0) + 1
    const no = `${fy.year}-${serial}`
    const header = tx
      .insert(aamad)
      .values({
        yearId,
        no,
        date: input.date,
        kisanAccountId: input.kisanAccountId,
        totalPackets: input.totalPackets
      })
      .returning({ id: aamad.id })
      .get()
    for (const l of input.locations) {
      tx.insert(aamadLocation)
        .values({ aamadId: header.id, room: l.room, floor: l.floor, rack: l.rack, packets: l.packets })
        .run()
    }
    writeAudit({ userId, action: 'create', entity: 'aamad', entityId: header.id, after: input }, tx)
    return header.id
  })
}

/**
 * Edit an aamad in place — header fields and the full set of location lines are replaced.
 * Editing keeps the same aamad id (and audit history) rather than delete + recreate, so a
 * wrong-kisan entry made in season rush can be corrected without renumbering.
 */
/**
 * Guard for update/delete: nikasi availability was checked against this aamad's stock when the
 * gate passes were created, so shrinking, moving, or removing it must not leave any rack with
 * less stock than has already been shipped out. Runs inside the caller's transaction AFTER the
 * change is applied (same SQLite connection, so it sees the uncommitted state) — a violation
 * throws and rolls the whole change back.
 */
function assertNothingOversold(
  yearId: number,
  kisanAccountId: number,
  locations: Array<{ room: number; floor: number; rack: number }>,
  what: string
): void {
  const seen = new Set<string>()
  for (const l of locations) {
    const k = `${l.room}:${l.floor}:${l.rack}`
    if (seen.has(k)) continue
    seen.add(k)
    const left = currentStockAtRack(yearId, kisanAccountId, l.room, l.floor, l.rack)
    if (left < 0) {
      throw new Error(
        `${what}: ${-left} of its packets at R${l.room}/F${l.floor}/Rack${l.rack} have already left ` +
          `through nikasi — delete those gate passes first`
      )
    }
  }
}

export function updateAamad(yearId: number, id: number, input: AamadInput, userId?: number): void {
  const before = db()
    .select()
    .from(aamad)
    .where(and(eq(aamad.id, id), eq(aamad.yearId, yearId)))
    .get()
  if (!before) throw new Error(`Aamad ${id} not found`)
  validateInput(input) // no. (and its serial) never changes on edit
  db().transaction((tx) => {
    const beforeLocations = tx.select().from(aamadLocation).where(eq(aamadLocation.aamadId, id)).all()
    tx.update(aamad)
      .set({
        date: input.date,
        kisanAccountId: input.kisanAccountId,
        totalPackets: input.totalPackets
      })
      .where(eq(aamad.id, id))
      .run()
    tx.delete(aamadLocation).where(eq(aamadLocation.aamadId, id)).run()
    for (const l of input.locations) {
      tx.insert(aamadLocation)
        .values({ aamadId: id, room: l.room, floor: l.floor, rack: l.rack, packets: l.packets })
        .run()
    }
    // Only the racks the aamad previously occupied can lose stock in this change.
    assertNothingOversold(
      yearId,
      before.kisanAccountId,
      beforeLocations,
      `Aamad ${before.no} cannot be changed`
    )
    writeAudit(
      {
        userId,
        action: 'update',
        entity: 'aamad',
        entityId: id,
        before: { ...before, locations: beforeLocations },
        after: input
      },
      tx
    )
  })
}

/**
 * Delete an aamad (stock-in) along with its location lines. Aamad posts nothing, so there is no
 * voucher to reverse. Refused if nikasi already shipped more from any of its racks than the rest
 * of the stock covers. Scoped to the year and done in one transaction; the change is audited.
 */
export function deleteAamad(yearId: number, id: number, userId?: number): void {
  db().transaction((tx) => {
    const header = tx
      .select()
      .from(aamad)
      .where(and(eq(aamad.id, id), eq(aamad.yearId, yearId)))
      .get()
    if (!header) throw new Error(`Aamad ${id} not found`)
    // Nikasi lines reference this lot (aamad_id), so the header delete would fail on the FK with a
    // cryptic message — check first and give the same "already left" guard the shrink path gives.
    const shipped = tx
      .select({ n: sql<number>`coalesce(sum(${nikasiLine.packets}), 0)` })
      .from(nikasiLine)
      .where(eq(nikasiLine.aamadId, id))
      .get()
    if ((shipped?.n ?? 0) > 0) {
      throw new Error(
        `Aamad ${header.no} cannot be deleted: ${shipped!.n} of its packets have already left ` +
          `through nikasi — delete those gate passes first`
      )
    }
    const locations = tx.select().from(aamadLocation).where(eq(aamadLocation.aamadId, id)).all()
    tx.delete(aamadLocation).where(eq(aamadLocation.aamadId, id)).run()
    tx.delete(aamad).where(eq(aamad.id, id)).run()
    assertNothingOversold(
      yearId,
      header.kisanAccountId,
      locations,
      `Aamad ${header.no} cannot be deleted`
    )
    writeAudit({ userId, action: 'delete', entity: 'aamad', entityId: id, before: header }, tx)
  })
}

export function listAamad(yearId: number, filter: AamadSearchFilter = {}): AamadListResult {
  const conds = [eq(aamad.yearId, yearId)]
  if (filter.kisanAccountId) conds.push(eq(aamad.kisanAccountId, filter.kisanAccountId))
  if (filter.fromDate) conds.push(gte(aamad.date, filter.fromDate))
  if (filter.toDate) conds.push(lte(aamad.date, filter.toDate))

  const rows: AamadListRow[] = db()
    .select({
      id: aamad.id,
      no: aamad.no,
      date: aamad.date,
      kisanAccountId: aamad.kisanAccountId,
      kisanName: account.name,
      totalPackets: aamad.totalPackets,
      assignedPackets: sql<number>`coalesce(sum(${aamadLocation.packets}), 0)`
    })
    .from(aamad)
    .innerJoin(account, eq(aamad.kisanAccountId, account.id))
    .leftJoin(aamadLocation, eq(aamadLocation.aamadId, aamad.id))
    .where(and(...conds))
    .groupBy(aamad.id)
    .orderBy(desc(aamad.date), desc(aamad.id))
    .all()

  return {
    rows,
    count: rows.length,
    totalPackets: rows.reduce((s, r) => s + r.totalPackets, 0)
  }
}

export function getAamad(aamadId: number): AamadDetail | null {
  const header = db()
    .select({
      id: aamad.id,
      no: aamad.no,
      date: aamad.date,
      kisanAccountId: aamad.kisanAccountId,
      kisanName: account.name,
      totalPackets: aamad.totalPackets
    })
    .from(aamad)
    .innerJoin(account, eq(aamad.kisanAccountId, account.id))
    .where(eq(aamad.id, aamadId))
    .get()
  if (!header) return null
  const locations = db()
    .select({
      id: aamadLocation.id,
      room: aamadLocation.room,
      floor: aamadLocation.floor,
      rack: aamadLocation.rack,
      packets: aamadLocation.packets
    })
    .from(aamadLocation)
    .where(eq(aamadLocation.aamadId, aamadId))
    .orderBy(asc(aamadLocation.room), asc(aamadLocation.floor), asc(aamadLocation.rack))
    .all()
  return { ...header, assignedPackets: locations.reduce((s, l) => s + l.packets, 0), locations }
}
