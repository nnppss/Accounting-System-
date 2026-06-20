import { and, asc, desc, eq, gte, lte } from 'drizzle-orm'
import { db } from '../data/db'
import { aamad, aamadLocation, account } from '../data/schema'
import type {
  AamadDetail,
  AamadInput,
  AamadListResult,
  AamadListRow,
  AamadSearchFilter
} from '../../shared/contracts'
import { writeAudit } from '../audit/audit'
import { assertLocationInBounds } from './store'

/** Aamad (stock-in) — header + Room/Floor/Rack location lines. Physical only; posts nothing. */
export type {
  AamadDetail,
  AamadInput,
  AamadListResult,
  AamadListRow,
  AamadSearchFilter
} from '../../shared/contracts'

export function createAamad(yearId: number, input: AamadInput, userId?: number): number {
  if (!input.no.trim()) throw new Error('Aamad number is required')
  if (input.locations.length === 0) throw new Error('Aamad needs at least one location line')
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
  if (locSum !== input.totalPackets) {
    throw new Error(`Location packets (${locSum}) must equal the total (${input.totalPackets})`)
  }

  return db().transaction((tx) => {
    const header = tx
      .insert(aamad)
      .values({
        yearId,
        no: input.no.trim(),
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
      totalPackets: aamad.totalPackets
    })
    .from(aamad)
    .innerJoin(account, eq(aamad.kisanAccountId, account.id))
    .where(and(...conds))
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
  return { ...header, locations }
}
