import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { aamad, account, financialYear, nikasi, nikasiLine, person, voucher, voucherEntry } from '../data/schema'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import type {
  AccrueAllResult,
  AccrueResult,
  RentPaymentTurn,
  RentReport,
  StandingBhada
} from '../../shared/contracts'
import { post, voidVoucher } from '../services/posting'
import { writeAudit } from '../audit/audit'

/**
 * Bhada (rent) engine — architecture.md §7. Storage rent is a flat per-packet rate for the year
 * (financial_year.rent_rate_paise), charged Dr Kisan / Cr Rent Income (tag 'rent'). Recovery is NOT
 * a separate entry — the kisan's sale-proceeds credit nets against this rent debit in his running
 * balance (posting map).
 *
 * **When rent hits the ledger.** Rent accrues as the kisan's stock LEAVES: every nikasi (a vyapari
 * sale, a personal draw, or a self-withdrawal) re-prices his rent to `shipped packets × rate`, so
 * the ledger reflects rent piecemeal as he ships — not all at once at intake. At year-end close the
 * accrual switches to the STORED basis (`basis: 'stored'`), charging the full year's rent on every
 * packet he stored — including stock that never shipped — because the kisan owes rent no matter
 * what (the unpaid remainder then carries forward like any due).
 *
 * Re-running `accrueRent` is idempotent: it voids the prior accrual and re-posts at the current
 * quantity (after another nikasi ships, or when the year-end catch-up switches to the stored basis).
 * Settlement ordering ("rent deducted first") is a Bills concern; here standing bhada = the rent
 * still carried on the kisan's books.
 */
export type { AccrueAllResult, AccrueResult, StandingBhada } from '../../shared/contracts'

/** Total packets a kisan has stored this year (sum of his aamads). */
export function getStoredPackets(kisanAccountId: number, yearId: number): number {
  const row = db()
    .select({ n: sql<number>`coalesce(sum(${aamad.totalPackets}), 0)` })
    .from(aamad)
    .where(and(eq(aamad.kisanAccountId, kisanAccountId), eq(aamad.yearId, yearId)))
    .get()
  return row?.n ?? 0
}

/** Total packets that have LEFT the cold on this kisan's account this year (sum of his nikasi lines). */
export function getShippedPackets(kisanAccountId: number, yearId: number): number {
  const row = db()
    .select({ n: sql<number>`coalesce(sum(${nikasiLine.packets}), 0)` })
    .from(nikasiLine)
    .innerJoin(nikasi, eq(nikasiLine.nikasiId, nikasi.id))
    .where(and(eq(nikasiLine.fromKisanAccountId, kisanAccountId), eq(nikasi.yearId, yearId)))
    .get()
  return row?.n ?? 0
}

/** Distinct voucher ids of a kisan's prior (non-voided) bhada accruals for the year. */
function priorAccrualVoucherIds(kisanAccountId: number, yearId: number): number[] {
  const rows = db()
    .selectDistinct({ id: voucher.id })
    .from(voucher)
    .innerJoin(voucherEntry, eq(voucherEntry.voucherId, voucher.id))
    .where(
      and(
        eq(voucher.yearId, yearId),
        eq(voucher.sourceModule, 'bhada'),
        eq(voucherEntry.accountId, kisanAccountId),
        isNull(voucher.voidedAt)
      )
    )
    .all()
  return rows.map((r) => r.id)
}

/**
 * Accrue (or re-accrue) one kisan's storage rent. `basis` picks the quantity charged:
 *  - `'shipped'` (default) — packets that have LEFT via nikasi; called after each nikasi so rent
 *    hits the ledger piecemeal as he ships.
 *  - `'stored'` — every packet he stored; used by the year-end catch-up so unshipped stock is billed.
 * Idempotent (voids the prior accrual first). Returns null if rent is zero.
 */
export function accrueRent(
  kisanAccountId: number,
  yearId: number,
  date: string,
  userId?: number,
  basis: 'shipped' | 'stored' = 'shipped'
): AccrueResult | null {
  const yr = db().select().from(financialYear).where(eq(financialYear.id, yearId)).get()
  if (!yr) throw new Error(`Financial year ${yearId} not found`)

  for (const vid of priorAccrualVoucherIds(kisanAccountId, yearId)) {
    voidVoucher(vid, 'bhada re-accrued', userId)
  }

  const packets =
    basis === 'stored'
      ? getStoredPackets(kisanAccountId, yearId)
      : getShippedPackets(kisanAccountId, yearId)
  const amountPaise = packets * yr.rentRatePaise
  if (amountPaise <= 0) return null

  const rentIncome = getSystemAccountId(SYSTEM_ACCOUNTS.RENT_INCOME)
  const res = post({
    yearId,
    type: 'journal',
    date,
    narration: `Bhada (rent) — ${packets} packets @ ₹${yr.rentRatePaise / 100}/packet`,
    accountantUserId: userId,
    sourceModule: 'bhada',
    sourceId: kisanAccountId,
    isAuto: true,
    entries: [
      { accountId: kisanAccountId, drPaise: amountPaise, crPaise: 0, tag: 'rent' },
      { accountId: rentIncome, drPaise: 0, crPaise: amountPaise, tag: 'rent' }
    ]
  })
  return { voucherId: res.voucherId, packets, amountPaise }
}

/**
 * Change the year's per-packet rent rate mid-year and re-price the whole system. The rate can be
 * revised any time (e.g. decided in Feb/Mar, or changed from 100→120/packet in April): we update
 * the flat rate, then re-accrue every kisan, whose accrual is idempotent (voids the prior at the
 * old rate, re-posts at the new). Live views compute packets × rate off financial_year, so they
 * pick up the change automatically; only the ledger vouchers need this re-post.
 */
export function setRentRate(
  yearId: number,
  ratePaise: number,
  date: string,
  userId?: number
): AccrueAllResult {
  const yr = db().select().from(financialYear).where(eq(financialYear.id, yearId)).get()
  if (!yr) throw new Error(`Financial year ${yearId} not found`)
  db().update(financialYear).set({ rentRatePaise: ratePaise }).where(eq(financialYear.id, yearId)).run()
  writeAudit({
    userId,
    action: 'update',
    entity: 'financial_year',
    entityId: yearId,
    before: { rentRatePaise: yr.rentRatePaise },
    after: { rentRatePaise: ratePaise }
  })
  return accrueAllRent(yearId, date, userId)
}

/** Accrue rent for every kisan who stored stock this year (see `accrueRent` for `basis`). */
export function accrueAllRent(
  yearId: number,
  date: string,
  userId?: number,
  basis: 'shipped' | 'stored' = 'shipped'
): AccrueAllResult {
  const kisans = db()
    .selectDistinct({ id: aamad.kisanAccountId })
    .from(aamad)
    .where(eq(aamad.yearId, yearId))
    .all()
  let totalPaise = 0
  let count = 0
  for (const k of kisans) {
    const r = accrueRent(k.id, yearId, date, userId, basis)
    if (r) {
      totalPaise += r.amountPaise
      count++
    }
  }
  return { kisans: count, totalPaise }
}

/** Standing bhada = rent-tagged net still on the kisan's books for the year. */
export function getStandingBhada(kisanAccountId: number, yearId: number): StandingBhada {
  const yr = db().select().from(financialYear).where(eq(financialYear.id, yearId)).get()
  if (!yr) throw new Error(`Financial year ${yearId} not found`)
  const acct = db().select().from(account).where(eq(account.id, kisanAccountId)).get()

  const row = db()
    .select({
      net: sql<number>`coalesce(sum(${voucherEntry.drPaise}), 0) - coalesce(sum(${voucherEntry.crPaise}), 0)`
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .where(
      and(
        eq(voucherEntry.accountId, kisanAccountId),
        eq(voucherEntry.tag, 'rent'),
        eq(voucher.yearId, yearId),
        isNull(voucher.voidedAt)
      )
    )
    .get()
  const accruedRentPaise = row?.net ?? 0
  const packets = getStoredPackets(kisanAccountId, yearId)

  return {
    kisanAccountId,
    kisanName: acct?.name ?? `#${kisanAccountId}`,
    storedPackets: packets,
    ratePaise: yr.rentRatePaise,
    accruedRentPaise,
    standingPaise: accruedRentPaise
  }
}

/**
 * Year-wide rent report. Rent-tagged entries on party (non-system) accounts ARE the kisan rent
 * ledger: the accrual debits the kisan (billed), a rent receipt credits him (paid). So per kisan
 * billed = ΣDr, paid = ΣCr, due = the difference (= standing bhada). Totals sum across kisans; the
 * cold's total billed equals the Cr on Rent Income, total collected equals the rent cash received.
 */
export function getRentReport(yearId: number): RentReport {
  const rentParty = and(
    eq(voucher.yearId, yearId),
    eq(voucherEntry.tag, 'rent'),
    eq(account.isSystem, false),
    isNull(voucher.voidedAt)
  )

  const rows = db()
    .select({
      accountId: voucherEntry.accountId,
      name: account.name,
      sonOf: person.sonOf,
      billed: sql<number>`coalesce(sum(${voucherEntry.drPaise}), 0)`,
      paid: sql<number>`coalesce(sum(${voucherEntry.crPaise}), 0)`
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .innerJoin(account, eq(voucherEntry.accountId, account.id))
    .leftJoin(person, eq(account.personId, person.id))
    .where(rentParty)
    .groupBy(voucherEntry.accountId)
    .all()

  // Every rent-tagged credit on a kisan account is one payment "turn".
  const payRows = db()
    .select({
      accountId: voucherEntry.accountId,
      date: voucher.date,
      voucherNo: voucher.no,
      amountPaise: voucherEntry.crPaise
    })
    .from(voucherEntry)
    .innerJoin(voucher, eq(voucherEntry.voucherId, voucher.id))
    .innerJoin(account, eq(voucherEntry.accountId, account.id))
    .where(and(rentParty, gt(voucherEntry.crPaise, 0)))
    .orderBy(voucher.date)
    .all()

  const turns = new Map<number, RentPaymentTurn[]>()
  for (const p of payRows) {
    const list = turns.get(p.accountId) ?? []
    list.push({ date: p.date, voucherNo: p.voucherNo, amountPaise: p.amountPaise })
    turns.set(p.accountId, list)
  }

  const kisans = rows
    .map((r) => ({
      accountId: r.accountId,
      name: r.name,
      sonOf: r.sonOf,
      billedPaise: r.billed,
      paidPaise: r.paid,
      duePaise: r.billed - r.paid,
      payments: turns.get(r.accountId) ?? []
    }))
    .sort((a, b) => b.duePaise - a.duePaise)

  const totalBilledPaise = kisans.reduce((s, k) => s + k.billedPaise, 0)
  const totalCollectedPaise = kisans.reduce((s, k) => s + k.paidPaise, 0)
  return {
    yearId,
    totalBilledPaise,
    totalCollectedPaise,
    totalDuePaise: totalBilledPaise - totalCollectedPaise,
    kisans
  }
}
