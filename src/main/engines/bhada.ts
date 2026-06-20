import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../data/db'
import { aamad, account, financialYear, voucher, voucherEntry } from '../data/schema'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import type { AccrueAllResult, AccrueResult, StandingBhada } from '../../shared/contracts'
import { post, voidVoucher } from '../services/posting'

/**
 * Bhada (rent) engine — architecture.md §7. Storage rent is a flat per-packet rate for the year
 * (financial_year.rent_rate_paise). Once a kisan's stored quantity is known, the FULL-year rent
 * is accrued: Dr Kisan / Cr Rent Income (tag 'rent'). Recovery is NOT a separate entry — the
 * kisan's sale-proceeds credit nets against this rent debit in his running balance (posting map).
 *
 * Re-running `accrueRent` is idempotent: it voids the prior accrual and re-posts at the current
 * stored quantity (e.g. after more aamad is added). Settlement ordering ("rent deducted first")
 * is a Bills concern (Phase 5); here standing bhada = the rent still carried on the kisan's books.
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

/** Accrue (or re-accrue) one kisan's full-year storage rent. Returns null if rent is zero. */
export function accrueRent(
  kisanAccountId: number,
  yearId: number,
  date: string,
  userId?: number
): AccrueResult | null {
  const yr = db().select().from(financialYear).where(eq(financialYear.id, yearId)).get()
  if (!yr) throw new Error(`Financial year ${yearId} not found`)

  for (const vid of priorAccrualVoucherIds(kisanAccountId, yearId)) {
    voidVoucher(vid, 'bhada re-accrued', userId)
  }

  const packets = getStoredPackets(kisanAccountId, yearId)
  const amountPaise = packets * yr.rentRatePaise
  if (amountPaise <= 0) return null

  const rentIncome = getSystemAccountId(SYSTEM_ACCOUNTS.RENT_INCOME)
  const res = post({
    yearId,
    type: 'journal',
    date,
    narration: `Bhada — ${packets} packets @ ${yr.rentRatePaise} paise`,
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

/** Accrue rent for every kisan who stored stock this year. */
export function accrueAllRent(yearId: number, date: string, userId?: number): AccrueAllResult {
  const kisans = db()
    .selectDistinct({ id: aamad.kisanAccountId })
    .from(aamad)
    .where(eq(aamad.yearId, yearId))
    .all()
  let totalPaise = 0
  let count = 0
  for (const k of kisans) {
    const r = accrueRent(k.id, yearId, date, userId)
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
