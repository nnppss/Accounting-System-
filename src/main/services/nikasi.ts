import { aliasedTable, and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, type Db } from '../data/db'
import { aamad, aamadLocation, account, nikasi, nikasiLine, voucher } from '../data/schema'
import type {
  CreateNikasiResult,
  LotRemaining,
  NikasiDetail,
  NikasiInput,
  NikasiListFilter,
  NikasiListRow
} from '../../shared/contracts'
import { writeAudit } from '../audit/audit'
import { lotNoOf } from './aamad'
import { currentStockAtRack } from './maps'
import { nextSeries, postCore } from './posting'

/**
 * Nikasi (stock-out / gate pass) — software.md §Nikasi, posting map architecture.md §6.
 *   • delivered to a vyapari → a SALE: Dr Vyapari / Cr each Kisan (proceeds = packets × rate),
 *     posted atomically with the gate pass (tag 'trade'). A vyapari can buy from many kisans.
 *   • delivered to the kisan himself (self-withdrawal) → physical only, no posting.
 * Weight is recorded but never drives money; bhada recovered is informational (recovery nets
 * through the kisan's running balance, per the posting map — not a separate entry).
 */
export type {
  CreateNikasiResult,
  NikasiDetail,
  NikasiInput,
  NikasiListRow
} from '../../shared/contracts'

/**
 * Nikasi money basis: the vyapari and kisan agree a rate per ~105 kg unit (2 packets, ~50 kg each) —
 * e.g. ₹931 per 105 kg — so amount = (deliveredWeightKg / 105) × rate, driven by weight not packets.
 * Rounded to whole paise.
 */
const NIKASI_RATE_UNIT_KG = 105
const nikasiAmountPaise = (weightKg: number, ratePaise: number): number =>
  Math.round((weightKg / NIKASI_RATE_UNIT_KG) * ratePaise)

/**
 * Spread `packets` of one lot across the racks it occupies, in (room, floor, rack) order. Runs
 * inside the caller's tx so it sees lines inserted for earlier gate-pass lines. Each rack draw is
 * capped by BOTH the lot's own placed-minus-shipped there AND the rack's true current stock for
 * this kisan (`currentStockAtRack`, which counts every nikasi line — including legacy rows with no
 * aamad_id). That second cap is what guarantees out ≤ in at every rack, so stock can never go
 * negative. Throws if the lot cannot cover the request.
 * ponytail: rack-order greedy; switch to FIFO-by-date if which physical stock leaves matters.
 */
function allocateLot(
  tx: Db,
  yearId: number,
  kisanAccountId: number,
  aamadId: number,
  lotNo: string,
  packets: number
): Array<{ room: number; floor: number; rack: number; packets: number }> {
  const placed = tx
    .select({ room: aamadLocation.room, floor: aamadLocation.floor, rack: aamadLocation.rack, packets: aamadLocation.packets })
    .from(aamadLocation)
    .where(eq(aamadLocation.aamadId, aamadId))
    .orderBy(asc(aamadLocation.room), asc(aamadLocation.floor), asc(aamadLocation.rack))
    .all()
  const shipped = tx
    .select({ room: nikasiLine.room, floor: nikasiLine.floor, rack: nikasiLine.rack, packets: sql<number>`sum(${nikasiLine.packets})` })
    .from(nikasiLine)
    .where(eq(nikasiLine.aamadId, aamadId))
    .groupBy(nikasiLine.room, nikasiLine.floor, nikasiLine.rack)
    .all()
  const shippedAt = new Map(shipped.map((s) => [`${s.room}:${s.floor}:${s.rack}`, s.packets]))

  const out: Array<{ room: number; floor: number; rack: number; packets: number }> = []
  let left = packets
  for (const p of placed) {
    if (left <= 0) break
    const lotAvail = p.packets - (shippedAt.get(`${p.room}:${p.floor}:${p.rack}`) ?? 0)
    const rackAvail = currentStockAtRack(yearId, kisanAccountId, p.room, p.floor, p.rack)
    const avail = Math.min(lotAvail, rackAvail)
    if (avail <= 0) continue
    const take = Math.min(avail, left)
    out.push({ room: p.room, floor: p.floor, rack: p.rack, packets: take })
    left -= take
  }
  if (left > 0) {
    throw new Error(
      `Lot ${lotNo}: only ${packets - left} packets are available in its racks — reduce the quantity`
    )
  }
  return out
}

export function createNikasi(
  yearId: number,
  input: NikasiInput,
  userId?: number
): CreateNikasiResult {
  if (input.lines.length === 0) throw new Error('Nikasi needs at least one line')
  const deliveredTo = db().select().from(account).where(eq(account.id, input.deliveredToAccountId)).get()
  if (!deliveredTo) throw new Error(`Delivery account ${input.deliveredToAccountId} not found`)

  const isSale = input.deliveredToType === 'vyapari'

  for (const l of input.lines) {
    if (!Number.isInteger(l.packets) || l.packets <= 0) {
      throw new Error('Each line must have a positive whole number of packets')
    }
    if (l.ratePaise < 0) throw new Error('Rate cannot be negative')
    // Weight drives the sale amount, so a vyapari sale can't post without it.
    if (isSale && !(l.weightKg && l.weightKg > 0)) {
      throw new Error('Each sale line needs a delivered weight (the rate is per 105 kg)')
    }
  }

  return db().transaction((tx) => {
    const billNo = nextSeries(tx, yearId, 'nikasi')

    const header = tx
      .insert(nikasi)
      .values({
        yearId,
        billNo,
        date: input.date,
        vehicleNo: input.vehicleNo ?? null,
        deliveredToType: input.deliveredToType,
        deliveredToAccountId: input.deliveredToAccountId,
        receivedBy: input.receivedBy ?? null,
        bhadaRecoveredPaise: input.bhadaRecoveredPaise ?? 0,
        voucherId: null
      })
      .returning({ id: nikasi.id })
      .get()

    // Each input line = one lot + packets; explode it into rack-level lines. Proceeds are per
    // kisan (the lot's owner), so a sale posts Dr Vyapari / Cr each Kisan on packets × rate.
    const proceedsByKisan = new Map<number, number>()
    for (const l of input.lines) {
      const lot = tx
        .select({ no: aamad.no, totalPackets: aamad.totalPackets, kisanAccountId: aamad.kisanAccountId })
        .from(aamad)
        .where(and(eq(aamad.id, l.aamadId), eq(aamad.yearId, yearId)))
        .get()
      if (!lot) throw new Error(`Lot ${l.aamadId} not found`)
      const allocations = allocateLot(
        tx,
        yearId,
        lot.kisanAccountId,
        l.aamadId,
        lotNoOf(lot.no, lot.totalPackets),
        l.packets
      )
      allocations.forEach((a, i) => {
        tx.insert(nikasiLine)
          .values({
            nikasiId: header.id,
            aamadId: l.aamadId,
            fromKisanAccountId: lot.kisanAccountId,
            room: a.room,
            floor: a.floor,
            rack: a.rack,
            packets: a.packets,
            // ponytail: whole weight on the first rack line; split proportionally if it must be exact.
            weightKg: i === 0 ? l.weightKg ?? null : null,
            ratePaise: l.ratePaise
          })
          .run()
      })
      proceedsByKisan.set(
        lot.kisanAccountId,
        (proceedsByKisan.get(lot.kisanAccountId) ?? 0) + nikasiAmountPaise(l.weightKg ?? 0, l.ratePaise)
      )
    }

    let voucherId: number | null = null
    if (isSale) {
      const total = [...proceedsByKisan.values()].reduce((s, v) => s + v, 0)
      if (total > 0) {
        const entries = [
          { accountId: input.deliveredToAccountId, drPaise: total, crPaise: 0, tag: 'trade' as const },
          ...[...proceedsByKisan.entries()].map(([kisanId, amount]) => ({
            accountId: kisanId,
            drPaise: 0,
            crPaise: amount,
            tag: 'trade' as const
          }))
        ]
        const res = postCore(tx, {
          yearId,
          type: 'journal',
          date: input.date,
          narration: `Nikasi sale — gate pass #${billNo}`,
          accountantUserId: userId,
          sourceModule: 'nikasi',
          sourceId: header.id,
          isAuto: true,
          entries
        })
        voucherId = res.voucherId
        tx.update(nikasi).set({ voucherId }).where(eq(nikasi.id, header.id)).run()
      }
    }

    writeAudit(
      { userId, action: 'create', entity: 'nikasi', entityId: header.id, after: { billNo, ...input } },
      tx
    )
    return { nikasiId: header.id, billNo, voucherId }
  })
}

/**
 * Delete a nikasi (gate pass) with its lines. If it was a vyapari sale, its auto-posted voucher is
 * voided first (no hard ledger deletes) so the sale reverses out of every balance; the voided
 * voucher stays for the audit trail. Self-withdrawals have no voucher. Scoped to the year, atomic,
 * and audited.
 */
export function deleteNikasi(yearId: number, id: number, userId?: number): void {
  db().transaction((tx) => {
    const header = tx
      .select()
      .from(nikasi)
      .where(and(eq(nikasi.id, id), eq(nikasi.yearId, yearId)))
      .get()
    if (!header) throw new Error(`Nikasi ${id} not found`)

    if (header.voucherId) {
      const v = tx.select().from(voucher).where(eq(voucher.id, header.voucherId)).get()
      if (v && !v.voidedAt) {
        tx.update(voucher)
          .set({ voidedAt: new Date(), voidedReason: `Nikasi gate pass #${header.billNo} deleted` })
          .where(eq(voucher.id, header.voucherId))
          .run()
        writeAudit({ userId, action: 'void', entity: 'voucher', entityId: header.voucherId, before: v }, tx)
      }
    }

    tx.delete(nikasiLine).where(eq(nikasiLine.nikasiId, id)).run()
    tx.delete(nikasi).where(eq(nikasi.id, id)).run()
    writeAudit({ userId, action: 'delete', entity: 'nikasi', entityId: id, before: header }, tx)
  })
}

export function listNikasi(yearId: number, filter: NikasiListFilter = {}): NikasiListRow[] {
  const headerConds = [eq(nikasi.yearId, yearId)]
  if (filter.deliveredToAccountId)
    headerConds.push(eq(nikasi.deliveredToAccountId, filter.deliveredToAccountId))

  // Kisan drill-down: only gate passes carrying a line from this kisan.
  if (filter.fromKisanAccountId) {
    const ids = db()
      .selectDistinct({ id: nikasiLine.nikasiId })
      .from(nikasiLine)
      .innerJoin(nikasi, eq(nikasiLine.nikasiId, nikasi.id))
      .where(
        and(eq(nikasi.yearId, yearId), eq(nikasiLine.fromKisanAccountId, filter.fromKisanAccountId))
      )
      .all()
      .map((r) => r.id)
    if (ids.length === 0) return []
    headerConds.push(inArray(nikasi.id, ids))
  }

  const headers = db()
    .select({
      id: nikasi.id,
      billNo: nikasi.billNo,
      date: nikasi.date,
      deliveredToType: nikasi.deliveredToType,
      deliveredToAccountId: nikasi.deliveredToAccountId,
      deliveredToName: account.name,
      vehicleNo: nikasi.vehicleNo,
      voucherId: nikasi.voucherId
    })
    .from(nikasi)
    .innerJoin(account, eq(nikasi.deliveredToAccountId, account.id))
    .where(and(...headerConds))
    .orderBy(desc(nikasi.date), desc(nikasi.billNo))
    .all()

  return headers.map((h) => {
    // Scope the per-gate-pass total to the kisan's own packets when drilling down by kisan.
    const lineConds = [eq(nikasiLine.nikasiId, h.id)]
    if (filter.fromKisanAccountId)
      lineConds.push(eq(nikasiLine.fromKisanAccountId, filter.fromKisanAccountId))
    const agg = db()
      .select({
        packets: sql<number>`coalesce(sum(${nikasiLine.packets}), 0)`,
        amount: sql<number>`coalesce(round(sum(${nikasiLine.weightKg} * ${nikasiLine.ratePaise}) / 105.0), 0)`
      })
      .from(nikasiLine)
      .where(and(...lineConds))
      .get()
    return {
      id: h.id,
      billNo: h.billNo,
      date: h.date,
      deliveredToType: h.deliveredToType,
      deliveredToAccountId: h.deliveredToAccountId,
      deliveredToName: h.deliveredToName,
      vehicleNo: h.vehicleNo,
      totalPackets: agg?.packets ?? 0,
      totalAmountPaise: agg?.amount ?? 0,
      isPosted: h.voucherId !== null
    }
  })
}

export function getNikasi(nikasiId: number): NikasiDetail | null {
  const deliveredTo = aliasedTable(account, 'delivered_to')
  const header = db()
    .select({
      id: nikasi.id,
      billNo: nikasi.billNo,
      date: nikasi.date,
      vehicleNo: nikasi.vehicleNo,
      deliveredToType: nikasi.deliveredToType,
      deliveredToAccountId: nikasi.deliveredToAccountId,
      deliveredToName: deliveredTo.name,
      receivedBy: nikasi.receivedBy,
      bhadaRecoveredPaise: nikasi.bhadaRecoveredPaise,
      voucherNo: voucher.no
    })
    .from(nikasi)
    .innerJoin(deliveredTo, eq(nikasi.deliveredToAccountId, deliveredTo.id))
    .leftJoin(voucher, eq(nikasi.voucherId, voucher.id))
    .where(eq(nikasi.id, nikasiId))
    .get()
  if (!header) return null

  // Group the internal rack split back to one row per lot (aamadId, rate) — what parties see.
  const kisan = aliasedTable(account, 'from_kisan')
  const rows = db()
    .select({
      aamadId: nikasiLine.aamadId,
      lotNo: sql<string | null>`${aamad.no} || '/' || ${aamad.totalPackets}`,
      fromKisanAccountId: nikasiLine.fromKisanAccountId,
      fromKisanName: kisan.name,
      packets: sql<number>`sum(${nikasiLine.packets})`,
      weightKg: sql<number | null>`sum(${nikasiLine.weightKg})`,
      ratePaise: nikasiLine.ratePaise
    })
    .from(nikasiLine)
    .innerJoin(kisan, eq(nikasiLine.fromKisanAccountId, kisan.id))
    .leftJoin(aamad, eq(nikasiLine.aamadId, aamad.id))
    .where(eq(nikasiLine.nikasiId, nikasiId))
    .groupBy(nikasiLine.aamadId, nikasiLine.ratePaise, nikasiLine.fromKisanAccountId)
    .all()

  return {
    ...header,
    lines: rows.map((r) => ({
      aamadId: r.aamadId,
      lotNo: r.lotNo ?? '—',
      fromKisanAccountId: r.fromKisanAccountId,
      fromKisanName: r.fromKisanName,
      packets: r.packets,
      weightKg: r.weightKg ?? undefined,
      ratePaise: r.ratePaise,
      amountPaise: nikasiAmountPaise(r.weightKg ?? 0, r.ratePaise)
    }))
  }
}

/** A kisan's lots (or all lots, when no kisan given) with packets still on hand — for the picker. */
export function lotsWithRemaining(yearId: number, kisanAccountId?: number): LotRemaining[] {
  const conds = [eq(aamad.yearId, yearId)]
  if (kisanAccountId) conds.push(eq(aamad.kisanAccountId, kisanAccountId))
  const rows = db()
    .select({
      aamadId: aamad.id,
      no: aamad.no,
      kisanAccountId: aamad.kisanAccountId,
      kisanName: account.name,
      totalPackets: aamad.totalPackets,
      shipped: sql<number>`coalesce(sum(${nikasiLine.packets}), 0)`
    })
    .from(aamad)
    .innerJoin(account, eq(aamad.kisanAccountId, account.id))
    .leftJoin(nikasiLine, eq(nikasiLine.aamadId, aamad.id))
    .where(and(...conds))
    .groupBy(aamad.id)
    .orderBy(desc(aamad.id))
    .all()
  return rows
    .map((r) => ({
      aamadId: r.aamadId,
      no: r.no,
      lotNo: lotNoOf(r.no, r.totalPackets),
      kisanAccountId: r.kisanAccountId,
      kisanName: r.kisanName,
      totalPackets: r.totalPackets,
      remaining: r.totalPackets - r.shipped
    }))
    .filter((r) => r.remaining > 0)
}
