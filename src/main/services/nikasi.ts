import { aliasedTable, and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { account, nikasi, nikasiLine, voucher } from '../data/schema'
import type {
  CreateNikasiResult,
  NikasiDetail,
  NikasiInput,
  NikasiListRow
} from '../../shared/contracts'
import { writeAudit } from '../audit/audit'
import { nextSeries, postCore } from './posting'
import { assertLocationInBounds } from './store'
import { currentStockAtRack } from './maps'

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

const locKey = (kisan: number, room: number, floor: number, rack: number): string =>
  `${kisan}:${room}:${floor}:${rack}`

export function createNikasi(
  yearId: number,
  input: NikasiInput,
  userId?: number
): CreateNikasiResult {
  if (input.lines.length === 0) throw new Error('Nikasi needs at least one line')
  const deliveredTo = db().select().from(account).where(eq(account.id, input.deliveredToAccountId)).get()
  if (!deliveredTo) throw new Error(`Delivery account ${input.deliveredToAccountId} not found`)

  // Validate lines and check stock availability (cumulative per location within this gate pass).
  const requested = new Map<string, number>()
  for (const l of input.lines) {
    if (!Number.isInteger(l.packets) || l.packets <= 0) {
      throw new Error('Each line must have a positive whole number of packets')
    }
    if (l.ratePaise < 0) throw new Error('Rate cannot be negative')
    assertLocationInBounds(l.room, l.floor, l.rack)
    const k = locKey(l.fromKisanAccountId, l.room, l.floor, l.rack)
    requested.set(k, (requested.get(k) ?? 0) + l.packets)
  }
  for (const l of input.lines) {
    const k = locKey(l.fromKisanAccountId, l.room, l.floor, l.rack)
    const need = requested.get(k)
    if (need === undefined) continue
    const available = currentStockAtRack(yearId, l.fromKisanAccountId, l.room, l.floor, l.rack)
    if (need > available) {
      throw new Error(
        `Not enough stock at R${l.room}/F${l.floor}/Rack${l.rack} for kisan ${l.fromKisanAccountId}: need ${need}, have ${available}`
      )
    }
    requested.delete(k) // check each location once
  }

  const isSale = input.deliveredToType === 'vyapari'

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

    for (const l of input.lines) {
      tx.insert(nikasiLine)
        .values({
          nikasiId: header.id,
          fromKisanAccountId: l.fromKisanAccountId,
          room: l.room,
          floor: l.floor,
          rack: l.rack,
          packets: l.packets,
          weightKg: l.weightKg ?? null,
          ratePaise: l.ratePaise
        })
        .run()
    }

    let voucherId: number | null = null
    if (isSale) {
      // Proceeds per kisan = Σ(packets × rate); Dr Vyapari total / Cr each Kisan.
      const proceedsByKisan = new Map<number, number>()
      for (const l of input.lines) {
        const amount = l.packets * l.ratePaise
        proceedsByKisan.set(
          l.fromKisanAccountId,
          (proceedsByKisan.get(l.fromKisanAccountId) ?? 0) + amount
        )
      }
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

export function listNikasi(yearId: number): NikasiListRow[] {
  const headers = db()
    .select({
      id: nikasi.id,
      billNo: nikasi.billNo,
      date: nikasi.date,
      deliveredToType: nikasi.deliveredToType,
      deliveredToName: account.name,
      voucherId: nikasi.voucherId
    })
    .from(nikasi)
    .innerJoin(account, eq(nikasi.deliveredToAccountId, account.id))
    .where(eq(nikasi.yearId, yearId))
    .orderBy(desc(nikasi.date), desc(nikasi.billNo))
    .all()

  return headers.map((h) => {
    const agg = db()
      .select({
        packets: sql<number>`coalesce(sum(${nikasiLine.packets}), 0)`,
        amount: sql<number>`coalesce(sum(${nikasiLine.packets} * ${nikasiLine.ratePaise}), 0)`
      })
      .from(nikasiLine)
      .where(eq(nikasiLine.nikasiId, h.id))
      .get()
    return {
      id: h.id,
      billNo: h.billNo,
      date: h.date,
      deliveredToType: h.deliveredToType,
      deliveredToName: h.deliveredToName,
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

  const kisan = aliasedTable(account, 'from_kisan')
  const lines = db()
    .select({
      id: nikasiLine.id,
      fromKisanAccountId: nikasiLine.fromKisanAccountId,
      fromKisanName: kisan.name,
      room: nikasiLine.room,
      floor: nikasiLine.floor,
      rack: nikasiLine.rack,
      packets: nikasiLine.packets,
      weightKg: nikasiLine.weightKg,
      ratePaise: nikasiLine.ratePaise
    })
    .from(nikasiLine)
    .innerJoin(kisan, eq(nikasiLine.fromKisanAccountId, kisan.id))
    .where(eq(nikasiLine.nikasiId, nikasiId))
    .all()

  return {
    ...header,
    lines: lines.map((l) => ({
      id: l.id,
      fromKisanAccountId: l.fromKisanAccountId,
      fromKisanName: l.fromKisanName,
      room: l.room,
      floor: l.floor,
      rack: l.rack,
      packets: l.packets,
      weightKg: l.weightKg ?? undefined,
      ratePaise: l.ratePaise,
      amountPaise: l.packets * l.ratePaise
    }))
  }
}
