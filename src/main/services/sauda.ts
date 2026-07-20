import { aliasedTable, and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { aamad, account, nikasi, nikasiLine, person, sauda, voucher, voucherEntry } from '../data/schema'
import type { SaudaInput, SaudaListRow, SettleSaudaResult } from '../../shared/contracts'
import { formatINR } from '../../shared/money'
import { writeAudit } from '../audit/audit'
import { lotNoOf } from './aamad'
import { NIKASI_RATE_UNIT_KG } from './nikasi'
import { postCore, voidVoucher } from './posting'

/**
 * Sauda (deal record) — a vyapari agrees a rate (per ~105 kg) with a kisan (software.md §Sauda).
 * Agreeing the deal posts nothing; its rate is what the Nikasi sale later bills at.
 *
 * **Shortfall.** A vyapari who promised 100 packets and lifted only 78 still owes for the other 22:
 * had he taken all 100 the cold would have collected for 100 and paid the kisan for 100, so the
 * cold pays the kisan for all 100 either way and the 22 become the vyapari's debt to the cold.
 * That is NOT automatic — `settleSauda` posts it when the accountant says so, because a deal can
 * also be renegotiated or dropped by mutual consent, and auto-posting would invent receivables
 * (and defaulter flags) out of deals nobody is claiming. Close-year only warns (`unsettled_sauda`).
 */
export type { SaudaInput, SaudaListRow, SettleSaudaResult } from '../../shared/contracts'

/** Lifted packets are matched to a deal by (vyapari, kisan, rate) — see `fills`. */
const dealKey = (vyapariAccountId: number, kisanAccountId: number, ratePaise: number): string =>
  `${vyapariAccountId}:${kisanAccountId}:${ratePaise}`

interface DealFill {
  liftedPackets: number
  shortfallPackets: number
  suggestedShortfallPaise: number | null
}

/**
 * Fill every deal of the year from what its vyapari actually lifted.
 *
 * Lifted packets attach to a deal by (vyapari, kisan, **rate**): the rate is the discriminator
 * because the nikasi line copied it off the deal, and it is already what nikasi.ts groups a gate
 * pass by (weighmentKey). Within one rate, deals fill oldest-first — two ₹900 deals of 3000 each
 * with 4000 lifted leaves the older delivered and the newer 2000 short.
 *
 * The shortfall's money comes from the packets he DID lift at that rate: the remaining 22 are worth
 * what the 78 were worth, per packet. That carries the real weighed weight of the same lot instead
 * of inventing a scale reading. Lifted nothing at all → no basis to price from → null, and the
 * accountant supplies the amount himself.
 *
 * ponytail: FIFO within a rate. The ceiling: two same-rate deals with one kisan, partly lifted,
 * can't say which deal the packets came off — the split between them is a convention, though the
 * pair's total shortfall and its money are right either way. Add a sauda_id to nikasi_line if that
 * split ever has to be exact.
 */
function fills(yearId: number): Map<number, DealFill> {
  const deals = db()
    .select({
      id: sauda.id,
      vyapariAccountId: sauda.vyapariAccountId,
      kisanAccountId: sauda.kisanAccountId,
      packets: sauda.packets,
      ratePaise: sauda.ratePaise
    })
    .from(sauda)
    .where(eq(sauda.yearId, yearId))
    .orderBy(asc(sauda.date), asc(sauda.id))
    .all()

  // What left the cold on each (vyapari, kisan, rate). Sales only — a self-withdrawal is the kisan
  // taking his own stock and settles no deal.
  const lifted = db()
    .select({
      vyapariAccountId: nikasi.deliveredToAccountId,
      kisanAccountId: nikasiLine.fromKisanAccountId,
      ratePaise: nikasiLine.ratePaise,
      packets: sql<number>`coalesce(sum(${nikasiLine.packets}), 0)`,
      amountPaise: sql<number>`coalesce(round(sum(coalesce(${nikasiLine.weightKg}, 0) * ${nikasiLine.ratePaise}) / 105.0), 0)`
    })
    .from(nikasiLine)
    .innerJoin(nikasi, eq(nikasiLine.nikasiId, nikasi.id))
    .where(and(eq(nikasi.yearId, yearId), eq(nikasi.deliveredToType, 'vyapari')))
    .groupBy(nikasi.deliveredToAccountId, nikasiLine.fromKisanAccountId, nikasiLine.ratePaise)
    .all()
  const liftedByKey = new Map(
    lifted.map((l) => [dealKey(l.vyapariAccountId, l.kisanAccountId, l.ratePaise), l])
  )

  const pools = new Map<string, number>()
  const out = new Map<number, DealFill>()
  for (const d of deals) {
    const key = dealKey(d.vyapariAccountId, d.kisanAccountId, d.ratePaise)
    const l = liftedByKey.get(key)
    const pool = pools.get(key) ?? l?.packets ?? 0
    const liftedPackets = Math.min(pool, d.packets)
    pools.set(key, pool - liftedPackets)
    const shortfallPackets = d.packets - liftedPackets
    const perPacket = l && l.packets > 0 ? l.amountPaise / l.packets : null
    out.set(d.id, {
      liftedPackets,
      shortfallPackets,
      suggestedShortfallPaise:
        shortfallPackets > 0 && perPacket !== null ? Math.round(perPacket * shortfallPackets) : null
    })
  }
  return out
}

/** Each deal's live settlement voucher (the vyapari's Dr), keyed by sauda id. */
function settlements(yearId: number): Map<number, { voucherId: number; amountPaise: number }> {
  const rows = db()
    .select({ saudaId: voucher.sourceId, voucherId: voucher.id, amountPaise: voucherEntry.drPaise })
    .from(voucher)
    .innerJoin(voucherEntry, eq(voucherEntry.voucherId, voucher.id))
    .where(
      and(
        eq(voucher.yearId, yearId),
        eq(voucher.sourceModule, 'sauda'),
        isNull(voucher.voidedAt),
        gt(voucherEntry.drPaise, 0)
      )
    )
    .all()
  return new Map(
    rows
      .filter((r) => r.saudaId !== null)
      .map((r) => [r.saudaId as number, { voucherId: r.voucherId, amountPaise: r.amountPaise }])
  )
}

export function createSauda(yearId: number, input: SaudaInput, userId?: number): number {
  if (input.packets <= 0) throw new Error('Sauda packets must be positive')
  if (input.ratePaise < 0) throw new Error('Rate cannot be negative')
  const row = db()
    .insert(sauda)
    .values({
      yearId,
      date: input.date,
      vyapariAccountId: input.vyapariAccountId,
      kisanAccountId: input.kisanAccountId,
      aamadId: input.aamadId ?? null,
      packets: input.packets,
      ratePaise: input.ratePaise
    })
    .returning({ id: sauda.id })
    .get()
  writeAudit({ userId, action: 'create', entity: 'sauda', entityId: row.id, after: input })
  return row.id
}

/**
 * Delete a sauda (deal record). Agreeing a deal posts nothing, so this is a leaf delete that simply
 * withdraws the agreed rate — EXCEPT when its shortfall was settled, which did post: that voucher
 * is voided first (no hard ledger deletes) so the charge reverses out of both parties' balances.
 * Scoped to the year so a stale id from another year can't be removed. The change is audited.
 */
export function deleteSauda(yearId: number, id: number, userId?: number): void {
  const row = db()
    .select()
    .from(sauda)
    .where(and(eq(sauda.id, id), eq(sauda.yearId, yearId)))
    .get()
  if (!row) throw new Error(`Sauda ${id} not found`)
  const s = settlements(yearId).get(id)
  if (s) voidVoucher(s.voucherId, `Sauda #${id} deleted`, userId)
  db().delete(sauda).where(eq(sauda.id, id)).run()
  writeAudit({ userId, action: 'delete', entity: 'sauda', entityId: id, before: row })
}

export function listSauda(yearId: number): SaudaListRow[] {
  const vyapari = aliasedTable(account, 'vyapari')
  const kisan = aliasedTable(account, 'kisan')
  const vyapariPerson = aliasedTable(person, 'vyapari_person')
  const kisanPerson = aliasedTable(person, 'kisan_person')
  const rows = db()
    .select({
      id: sauda.id,
      date: sauda.date,
      vyapariAccountId: sauda.vyapariAccountId,
      vyapariName: vyapari.name,
      vyapariSonOf: vyapariPerson.sonOf,
      kisanAccountId: sauda.kisanAccountId,
      kisanName: kisan.name,
      kisanSonOf: kisanPerson.sonOf,
      aamadId: sauda.aamadId,
      aamadNo: aamad.no,
      totalPackets: aamad.totalPackets,
      packets: sauda.packets,
      ratePaise: sauda.ratePaise
    })
    .from(sauda)
    .innerJoin(vyapari, eq(sauda.vyapariAccountId, vyapari.id))
    .innerJoin(kisan, eq(sauda.kisanAccountId, kisan.id))
    .leftJoin(vyapariPerson, eq(vyapari.personId, vyapariPerson.id))
    .leftJoin(kisanPerson, eq(kisan.personId, kisanPerson.id))
    .leftJoin(aamad, eq(sauda.aamadId, aamad.id))
    .where(eq(sauda.yearId, yearId))
    .orderBy(desc(sauda.date), desc(sauda.id))
    .all()
  const fill = fills(yearId)
  const settled = settlements(yearId)
  return rows.map(({ aamadNo, totalPackets, ...r }) => {
    const f = fill.get(r.id)
    const s = settled.get(r.id)
    return {
      ...r,
      lotNo: aamadNo !== null && totalPackets !== null ? lotNoOf(aamadNo, totalPackets) : null,
      liftedPackets: f?.liftedPackets ?? 0,
      shortfallPackets: f?.shortfallPackets ?? 0,
      suggestedShortfallPaise: f?.suggestedShortfallPaise ?? null,
      settlementVoucherId: s?.voucherId ?? null,
      settlementPaise: s?.amountPaise ?? null
    }
  })
}

/**
 * Charge a vyapari for the packets he agreed to take and didn't (software.md §Sauda shortfall).
 * Posts the same entry a real lifting would have — Dr Vyapari / Cr Kisan, tag 'trade' — so the
 * kisan is paid for all 100 packets he sold and the vyapari carries the 22 he left behind as a
 * debt, which then carries forward (and can flag him a defaulter) like any other due.
 *
 * `amountPaise` is the accountant's, not ours: it defaults in the UI to what the lifted packets
 * were worth per packet but the two parties may have agreed something else. No stock moves — the
 * packets are still the kisan's and still accrue his rent, exactly as before.
 */
export function settleSauda(
  yearId: number,
  saudaId: number,
  input: { date: string; amountPaise: number },
  userId?: number
): SettleSaudaResult {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error('Settlement amount must be a positive whole number of paise')
  }
  const vyapari = aliasedTable(account, 'vyapari')
  const kisan = aliasedTable(account, 'kisan')
  const deal = db()
    .select({
      id: sauda.id,
      vyapariAccountId: sauda.vyapariAccountId,
      vyapariName: vyapari.name,
      kisanAccountId: sauda.kisanAccountId,
      kisanName: kisan.name,
      packets: sauda.packets,
      ratePaise: sauda.ratePaise,
      aamadNo: aamad.no,
      aamadTotalPackets: aamad.totalPackets
    })
    .from(sauda)
    .innerJoin(vyapari, eq(sauda.vyapariAccountId, vyapari.id))
    .innerJoin(kisan, eq(sauda.kisanAccountId, kisan.id))
    .leftJoin(aamad, eq(sauda.aamadId, aamad.id))
    .where(and(eq(sauda.id, saudaId), eq(sauda.yearId, yearId)))
    .get()
  if (!deal) throw new Error(`Sauda ${saudaId} not found`)
  if (settlements(yearId).has(saudaId)) {
    throw new Error(`This deal's shortfall is already settled — undo the settlement to change it`)
  }
  const shortfallPackets = fills(yearId).get(saudaId)?.shortfallPackets ?? 0
  if (shortfallPackets <= 0) {
    throw new Error(`${deal.vyapariName} lifted every packet of this deal — nothing to settle`)
  }

  const lot = deal.aamadNo ? ` · Lot ${lotNoOf(deal.aamadNo, deal.aamadTotalPackets ?? 0)}` : ''
  const result = db().transaction((tx) =>
    postCore(tx, {
      yearId,
      type: 'journal',
      date: input.date,
      // Both parties read this off their ledger, so it says which deal and why the money moved
      // with no packets behind it. The counterparty column names the other side.
      narration: `Sauda shortfall — ${deal.vyapariName}. ${shortfallPackets} of ${deal.packets} pkt undelivered @ ${formatINR(deal.ratePaise)} per ${NIKASI_RATE_UNIT_KG}kg${lot}`,
      accountantUserId: userId,
      sourceModule: 'sauda',
      sourceId: saudaId,
      isAuto: false,
      entries: [
        { accountId: deal.vyapariAccountId, drPaise: input.amountPaise, crPaise: 0, tag: 'trade' as const },
        { accountId: deal.kisanAccountId, drPaise: 0, crPaise: input.amountPaise, tag: 'trade' as const }
      ]
    })
  )
  writeAudit({
    userId,
    action: 'create',
    entity: 'sauda_settlement',
    entityId: saudaId,
    after: { ...input, shortfallPackets, voucherId: result.voucherId }
  })
  return { voucherId: result.voucherId, voucherNo: result.voucherNo, amountPaise: input.amountPaise }
}

/** Undo a shortfall settlement — voids its voucher (no hard ledger deletes), freeing a re-settle. */
export function unsettleSauda(yearId: number, saudaId: number, userId?: number): void {
  const s = settlements(yearId).get(saudaId)
  if (!s) throw new Error(`Sauda ${saudaId} has no settlement to undo`)
  voidVoucher(s.voucherId, `Sauda #${saudaId} shortfall settlement undone`, userId)
}

/**
 * Rate to bill a lifting at — pre-fills the Nikasi line rate (software.md §Sauda).
 *
 * The deal these packets will settle AGAINST, not merely the newest one: `fills` attributes lifted
 * packets to the oldest deal of the pair that still has packets outstanding, so that is the deal
 * whose rate the gate pass should carry. Prefilling the newest instead would put the packets on a
 * rate whose deal is already delivered, inventing a shortfall on the deal that is genuinely open
 * and another on the one that isn't.
 *
 * Every deal of the pair filled → he is lifting beyond what he agreed, and there is no open deal to
 * price it from; the latest rate is the best guess left, and the accountant can type over it.
 */
export function rateForLifting(
  yearId: number,
  vyapariAccountId: number,
  kisanAccountId: number
): number | null {
  const rows = db()
    .select({ id: sauda.id, ratePaise: sauda.ratePaise })
    .from(sauda)
    .where(
      and(
        eq(sauda.yearId, yearId),
        eq(sauda.vyapariAccountId, vyapariAccountId),
        eq(sauda.kisanAccountId, kisanAccountId)
      )
    )
    .orderBy(asc(sauda.date), asc(sauda.id))
    .all()
  if (rows.length === 0) return null
  const fill = fills(yearId)
  const open = rows.find((r) => (fill.get(r.id)?.shortfallPackets ?? 0) > 0)
  return (open ?? rows[rows.length - 1]).ratePaise
}
