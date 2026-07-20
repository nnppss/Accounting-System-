import { aliasedTable, and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db, type Db } from '../data/db'
import { aamad, aamadLocation, account, nikasi, nikasiLine, person, voucher } from '../data/schema'
import { accrueRent } from '../engines/bhada'
import type {
  CreateNikasiResult,
  LotRemaining,
  NikasiDetail,
  NikasiInput,
  NikasiListFilter,
  NikasiListRow,
  NikasiWeighmentView
} from '../../shared/contracts'
import { formatINR } from '../../shared/money'
import { writeAudit } from '../audit/audit'
import { lotNoOf } from './aamad'
import { currentStockAtRack } from './maps'
import { nextSeries, postCore } from './posting'

/**
 * Nikasi (stock-out / gate pass) — software.md §Nikasi, posting map architecture.md §6.
 *   • delivered to a vyapari → a SALE: one voucher PER kisan, Dr Vyapari / Cr Kisan (proceeds =
 *     weight ÷ 105 × rate), posted atomically with the gate pass (tag 'trade'). One truck is filled
 *     off many kisans, several lots apiece, at a rate agreed lot by lot; a voucher each keeps every
 *     party's ledger line to just their own deal (rate is private) and spells that deal out
 *     ("Nikasi #12 · UP32 AB 1234 — Mohan. Lot 7/60: 30 pkt, 1500 kg @ ₹980.00 per 105kg; …").
 *   • delivered to the kisan himself (self-withdrawal) → no SALE voucher.
 * Either way the shipped packets accrue the kisan's storage rent (bhada re-prices to shipped ×
 * rate — see engines/bhada.ts), so rent hits his ledger piecemeal as his stock leaves.
 * Each kisan's weight is his own (it settles his money); the vehicle's load is their sum, and only
 * ever a total (NikasiDetail.totalWeightKg). Bhada recovered is informational (recovery nets
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
export const NIKASI_RATE_UNIT_KG = 105
const nikasiAmountPaise = (weightKg: number, ratePaise: number): number =>
  Math.round((weightKg / NIKASI_RATE_UNIT_KG) * ratePaise)

/**
 * A WEIGHMENT (तौल) is the real unit of a gate pass, not the lot. Lots of one kisan sold at one
 * agreed rate go on the scale together and come off as a single reading — Ajay's 18/215 and 17/200
 * weighed as one 21,040 kg at ₹900 — while a lot priced on its own (a different variety, say) is
 * weighed on its own. So weight and rate belong to a GROUP of lots. Only the group's total weight
 * is ever a real number; splitting it back over the lots would be invention.
 *
 * ponytail: the group key is (kisan, rate), which needs no column — the lots' own rows already
 * carry both. The ceiling: two separate weighings of ONE kisan at an IDENTICAL rate read back
 * merged into one (same packets, same weight, same money — only the fact that the scale ran twice
 * is lost). Add a weighment_no column to nikasi_line if that ever has to survive.
 */
const weighmentKey = (kisanAccountId: number, ratePaise: number): string =>
  `${kisanAccountId}:${ratePaise}`

/**
 * One weighment's slice of a kisan's ledger narration — "Lots 18/215 + 17/200: 414 pkt, 21040 kg
 * @ ₹900.00 per 105kg". The kisan opens his ledger to check which deal earned which money, so each
 * weighing is spelled out; a single summed line across his weighments would hide the rates apart.
 */
const weighmentNarration = (
  lotNos: string[],
  packets: number,
  weightKg: number,
  ratePaise: number
): string => {
  const label = lotNos.length > 1 ? `Lots ${lotNos.join(' + ')}` : `Lot ${lotNos[0]}`
  const weight = weightKg ? `, ${weightKg} kg` : ''
  return `${label}: ${packets} pkt${weight} @ ${formatINR(ratePaise)} per ${NIKASI_RATE_UNIT_KG}kg`
}

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
    // Weight is NOT checked per lot — it is weighed per weighment, so lots that shared a scale
    // reading carry it on whichever of them the caller put it on. Checked per group inside the tx.
  }

  const result = db().transaction((tx) => {
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
        remark: input.remark ?? null,
        voucherId: null
      })
      .returning({ id: nikasi.id })
      .get()

    // Each input line = one lot + packets; explode it into rack-level lines. The lots are then
    // gathered into weighments (one kisan, one rate, one scale reading — see weighmentKey): that is
    // what the money and the ledger are built from, because that is what actually happened at the
    // gate. One truck carries several kisans' weighments; each kisan's stay his own.
    const byWeighment = new Map<
      string,
      {
        kisanAccountId: number
        kisanName: string
        ratePaise: number
        packets: number
        weightKg: number
        lotNos: string[]
      }
    >()
    for (const l of input.lines) {
      const lot = tx
        .select({
          no: aamad.no,
          totalPackets: aamad.totalPackets,
          kisanAccountId: aamad.kisanAccountId,
          kisanName: account.name
        })
        .from(aamad)
        .innerJoin(account, eq(aamad.kisanAccountId, account.id))
        .where(and(eq(aamad.id, l.aamadId), eq(aamad.yearId, yearId)))
        .get()
      if (!lot) throw new Error(`Lot ${l.aamadId} not found`)
      const lotNo = lotNoOf(lot.no, lot.totalPackets)
      const allocations = allocateLot(tx, yearId, lot.kisanAccountId, l.aamadId, lotNo, l.packets)
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
      const key = weighmentKey(lot.kisanAccountId, l.ratePaise)
      const w = byWeighment.get(key) ?? {
        kisanAccountId: lot.kisanAccountId,
        kisanName: lot.kisanName,
        ratePaise: l.ratePaise,
        packets: 0,
        weightKg: 0,
        lotNos: []
      }
      w.packets += l.packets
      // The scale ran once for the whole group, so the caller may hang its weight off any lot in
      // the group (the form puts it on the first). Summing is what reassembles the reading.
      w.weightKg += l.weightKg ?? 0
      w.lotNos.push(lotNo)
      byWeighment.set(key, w)
    }

    // Weight is the sale's money, and it is agreed per weighing — so a weighing, not a lot, is what
    // has to have one. Checked here (not up front) because the lots' kisan is only known now.
    if (isSale) {
      for (const w of byWeighment.values()) {
        if (w.weightKg > 0) continue
        throw new Error(
          `${w.kisanName}'s lots at ${formatINR(w.ratePaise)} (${w.lotNos.join(', ')}) need a delivered weight — the rate is per ${NIKASI_RATE_UNIT_KG} kg`
        )
      }
    }

    // Proceeds roll weighments up per kisan: he sells at his own rates but is credited once, so his
    // ledger carries one line for the whole truck. Rounded per weighing — one deal, one amount.
    const byKisan = new Map<number, { packets: number; weightKg: number; amountPaise: number; parts: string[] }>()
    for (const w of byWeighment.values()) {
      const tally = byKisan.get(w.kisanAccountId) ?? { packets: 0, weightKg: 0, amountPaise: 0, parts: [] }
      tally.packets += w.packets
      tally.weightKg += w.weightKg
      tally.amountPaise += nikasiAmountPaise(w.weightKg, w.ratePaise)
      tally.parts.push(weighmentNarration(w.lotNos, w.packets, w.weightKg, w.ratePaise))
      byKisan.set(w.kisanAccountId, tally)
    }

    // A sale posts one voucher per kisan so each party's ledger shows only their own deal, named
    // and legible. nikasi.voucherId keeps the first (marks the gate pass posted); delete voids all.
    let voucherId: number | null = null
    if (isSale) {
      const vyapariName = deliveredTo.name
      for (const [kisanId, tally] of byKisan) {
        if (tally.amountPaise <= 0) continue
        // The whole gate pass, readable off the one ledger row: which truck, whose deal, and each
        // weighing he put on it with its lots, packets, weight and rate. The counterparty column
        // names the other party and the Dr/Cr column the amount, so neither is repeated here.
        const vehicle = input.vehicleNo ? ` · ${input.vehicleNo}` : ''
        const total =
          tally.parts.length > 1 ? ` · Total ${tally.packets} pkt, ${tally.weightKg} kg` : ''
        const res = postCore(tx, {
          yearId,
          type: 'journal',
          date: input.date,
          narration: `Nikasi #${billNo}${vehicle} — ${vyapariName}. ${tally.parts.join('; ')}${total}`,
          accountantUserId: userId,
          sourceModule: 'nikasi',
          sourceId: header.id,
          isAuto: true,
          entries: [
            {
              accountId: input.deliveredToAccountId,
              drPaise: tally.amountPaise,
              crPaise: 0,
              tag: 'trade' as const
            },
            { accountId: kisanId, drPaise: 0, crPaise: tally.amountPaise, tag: 'trade' as const }
          ]
        })
        if (voucherId === null) voucherId = res.voucherId
      }
      if (voucherId !== null) tx.update(nikasi).set({ voucherId }).where(eq(nikasi.id, header.id)).run()
    }

    writeAudit(
      { userId, action: 'create', entity: 'nikasi', entityId: header.id, after: { billNo, ...input } },
      tx
    )
    return { nikasiId: header.id, billNo, voucherId, shippingKisans: [...byKisan.keys()] }
  })

  // Shipped packets changed → re-price each shipping kisan's rent to his shipped total. Runs
  // outside the tx (accrueRent opens its own), mirroring how aamad used to accrue.
  for (const kisanId of result.shippingKisans) {
    accrueRent(kisanId, yearId, input.date, userId)
  }
  return { nikasiId: result.nikasiId, billNo: result.billNo, voucherId: result.voucherId }
}

/**
 * Delete a nikasi (gate pass) with its lines. A vyapari sale posts one voucher per kisan; all of
 * them are voided (no hard ledger deletes) so the sale reverses out of every balance, and the
 * voided vouchers stay for the audit trail. Self-withdrawals have none. Every kisan that shipped on
 * this gate pass then re-accrues his rent at the now-lower shipped total. Scoped to the year,
 * atomic, and audited.
 */
export function deleteNikasi(yearId: number, id: number, userId?: number): void {
  const affected = db().transaction((tx) => {
    const header = tx
      .select()
      .from(nikasi)
      .where(and(eq(nikasi.id, id), eq(nikasi.yearId, yearId)))
      .get()
    if (!header) throw new Error(`Nikasi ${id} not found`)

    const shippingKisans = tx
      .selectDistinct({ k: nikasiLine.fromKisanAccountId })
      .from(nikasiLine)
      .where(eq(nikasiLine.nikasiId, id))
      .all()
      .map((r) => r.k)

    // Void every sale voucher this gate pass raised (one per kisan), not just header.voucherId.
    const sales = tx
      .select()
      .from(voucher)
      .where(and(eq(voucher.sourceModule, 'nikasi'), eq(voucher.sourceId, id), isNull(voucher.voidedAt)))
      .all()
    for (const v of sales) {
      tx.update(voucher)
        .set({ voidedAt: new Date(), voidedReason: `Nikasi gate pass #${header.billNo} deleted` })
        .where(eq(voucher.id, v.id))
        .run()
      writeAudit({ userId, action: 'void', entity: 'voucher', entityId: v.id, before: v }, tx)
    }

    tx.delete(nikasiLine).where(eq(nikasiLine.nikasiId, id)).run()
    tx.delete(nikasi).where(eq(nikasi.id, id)).run()
    writeAudit({ userId, action: 'delete', entity: 'nikasi', entityId: id, before: header }, tx)
    return { shippingKisans, date: header.date }
  })

  for (const kisanId of affected.shippingKisans) {
    accrueRent(kisanId, yearId, affected.date, userId)
  }
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
      deliveredToSonOf: person.sonOf,
      vehicleNo: nikasi.vehicleNo,
      voucherId: nikasi.voucherId
    })
    .from(nikasi)
    .innerJoin(account, eq(nikasi.deliveredToAccountId, account.id))
    .leftJoin(person, eq(account.personId, person.id))
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
        weightKg: sql<number>`coalesce(sum(${nikasiLine.weightKg}), 0)`,
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
      deliveredToSonOf: h.deliveredToSonOf,
      vehicleNo: h.vehicleNo,
      totalPackets: agg?.packets ?? 0,
      totalWeightKg: agg?.weightKg ?? 0,
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
      remark: nikasi.remark,
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
      // Raw `no` is `YYYY-serial`; parties know the lot by lotNoOf's `serial/total` — same string
      // the picker and the ledger narration use, so keep them saying the same thing.
      aamadNo: aamad.no,
      aamadTotalPackets: aamad.totalPackets,
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

  // Rebuild the weighments: lots of one kisan at one rate went over the scale together, so they are
  // reported together. Their weights sum back to the reading; no lot claims a share of it, because
  // at the gate no lot ever had one.
  const weighments: NikasiWeighmentView[] = []
  const byKey = new Map<string, NikasiWeighmentView>()
  for (const r of rows) {
    const key = weighmentKey(r.fromKisanAccountId, r.ratePaise)
    let w = byKey.get(key)
    if (!w) {
      w = {
        fromKisanAccountId: r.fromKisanAccountId,
        fromKisanName: r.fromKisanName,
        ratePaise: r.ratePaise,
        packets: 0,
        weightKg: 0,
        amountPaise: 0,
        lots: []
      }
      byKey.set(key, w)
      weighments.push(w)
    }
    w.packets += r.packets
    w.weightKg += r.weightKg ?? 0
    w.lots.push({
      aamadId: r.aamadId,
      lotNo: r.aamadNo ? lotNoOf(r.aamadNo, r.aamadTotalPackets ?? 0) : '—',
      packets: r.packets
    })
  }
  for (const w of weighments) w.amountPaise = nikasiAmountPaise(w.weightKg, w.ratePaise)

  // What actually went out on the truck: every kisan's weighings added up.
  return {
    ...header,
    weighments,
    totalWeightKg: weighments.reduce((s, w) => s + w.weightKg, 0)
  }
}

/**
 * A kisan's lots (or all lots, when no kisan given) with packets still on hand — for the picker.
 * `remaining` is what the kisan is still owed on paper (total − shipped); `inRacks` is what nikasi
 * can actually ship (placed − shipped). They differ when an aamad was booked by total only and its
 * rack placement never followed (see createAamad — locations are optional at peak season), which is
 * why the picker shows both: offering `remaining` alone promises stock allocateLot can't find.
 */
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
      shipped: sql<number>`coalesce(sum(${nikasiLine.packets}), 0)`,
      // Subquery, not a join: joining aamadLocation alongside nikasiLine would fan out and
      // multiply both sums by the other's row count.
      placed: sql<number>`(select coalesce(sum(${aamadLocation.packets}), 0)
        from ${aamadLocation} where ${aamadLocation.aamadId} = ${aamad.id})`
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
      remaining: r.totalPackets - r.shipped,
      inRacks: r.placed - r.shipped
    }))
    .filter((r) => r.remaining > 0)
}
